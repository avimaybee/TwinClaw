import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { logSystemCommand, scrubSensitiveText } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_LENGTH = 8_000;
const SHELL_OPERATOR_PATTERN = /[|&;<>`]/;
const DEFAULT_ALLOWED_EXECUTABLES = new Set([
  'git',
  'npm',
  'npx',
  'node',
  'tsx',
  'tsc',
  'vitest',
  'pnpm',
  'yarn',
  'python',
  'pip',
  'go',
]);
const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/\b/i, reason: 'destructive root delete' },
  { pattern: /\brm\s+-rf\s+\*/i, reason: 'destructive wildcard delete' },
  { pattern: /\bdel\s+\/[A-Za-z]*\s+\/[A-Za-z]*\s+[A-Za-z]:\\/i, reason: 'destructive windows delete' },
  { pattern: /\bformat\s+[A-Za-z]:/i, reason: 'disk format command' },
  { pattern: /\bshutdown\b/i, reason: 'system shutdown command' },
  { pattern: /\breboot\b/i, reason: 'system reboot command' },
  { pattern: /\bpoweroff\b/i, reason: 'system poweroff command' },
];

export interface ShellExecutionOptions {
  timeoutMs?: number;
  allowUnsafe?: boolean;
  enforceAllowlist?: boolean;
}

interface ExecError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }

  return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n...[truncated]`;
}

function resolveTimeout(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Math.floor(Number(timeoutMs));
  if (parsed < 1) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, parsed);
}

function detectBlockedCommand(command: string): string | null {
  for (const entry of BLOCKED_COMMAND_PATTERNS) {
    if (entry.pattern.test(command)) {
      return entry.reason;
    }
  }
  return null;
}

function parseAllowedExecutablesFromEnv(): Set<string> {
  const configured = (process.env.TWINCLAW_ALLOWED_EXECUTABLES ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : DEFAULT_ALLOWED_EXECUTABLES;
}

function normalizeExecutableName(value: string): string {
  const base = path.basename(value).trim().toLowerCase();
  if (!base) {
    return '';
  }
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '');
}

function isExecutableAllowed(executable: string): boolean {
  const normalized = normalizeExecutableName(executable);
  if (!normalized) {
    return false;
  }
  return parseAllowedExecutablesFromEnv().has(normalized);
}

function parseCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escapeNext = false;

  for (const char of command) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escapeNext || quote) {
    throw new Error('Command parsing failed: unterminated quote or escape sequence.');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function formatArgsForLog(executable: string, args: string[]): string {
  return [executable, ...args].join(' ').trim();
}

function blockExecution(commandPreview: string, reason: string): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const blockedOutput = `Blocked unsafe command (${reason}). Set allowUnsafe=true to override.`;
  return logSystemCommand(commandPreview, blockedOutput, 126).then(() => ({
    ok: false,
    output: blockedOutput,
    exitCode: 126,
  }));
}

export async function executeProgram(
  executable: string,
  args: string[] = [],
  cwd?: string,
  options: ShellExecutionOptions = {},
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const normalizedExecutable = executable.trim();
  if (normalizedExecutable.length === 0) {
    return {
      ok: false,
      output: 'executable must be a non-empty string.',
      exitCode: 1,
    };
  }

  const commandPreview = formatArgsForLog(normalizedExecutable, args);
  if (!options.allowUnsafe && options.enforceAllowlist !== false && !isExecutableAllowed(normalizedExecutable)) {
    return blockExecution(
      commandPreview,
      `executable '${normalizeExecutableName(normalizedExecutable)}' is not in allowlist`,
    );
  }

  const blockedReason = options.allowUnsafe ? null : detectBlockedCommand(commandPreview);
  if (blockedReason) {
    return blockExecution(commandPreview, blockedReason);
  }

  const timeout = resolveTimeout(options.timeoutMs);
  try {
    const { stdout, stderr } = await execFileAsync(normalizedExecutable, args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    const mergedOutput = truncateOutput(scrubSensitiveText(`${stdout ?? ''}${stderr ?? ''}`.trim()));
    await logSystemCommand(commandPreview, mergedOutput || '(no output)', 0);
    return {
      ok: true,
      output: mergedOutput,
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as ExecError;
    const mergedOutput = truncateOutput(
      scrubSensitiveText(`${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim()),
    );
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    await logSystemCommand(commandPreview, mergedOutput || '(no output)', exitCode);
    return {
      ok: false,
      output: mergedOutput,
      exitCode,
    };
  }
}

export async function executeShell(
  command: string,
  cwd?: string,
  options: ShellExecutionOptions = {},
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) {
    return {
      ok: false,
      output: 'Command must be a non-empty string.',
      exitCode: 1,
    };
  }

  if (!options.allowUnsafe && SHELL_OPERATOR_PATTERN.test(normalizedCommand)) {
    return blockExecution(normalizedCommand, 'shell operators are not allowed');
  }

  let parsed: string[];
  try {
    parsed = parseCommand(normalizedCommand);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = `Failed to parse command: ${message}`;
    await logSystemCommand(normalizedCommand, output, 1);
    return {
      ok: false,
      output,
      exitCode: 1,
    };
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      output: 'Command must contain an executable.',
      exitCode: 1,
    };
  }

  const [executable, ...args] = parsed;
  return executeProgram(executable, args, cwd, options);
}
