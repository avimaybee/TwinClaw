import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logSystemCommand, scrubSensitiveText } from '../utils/logger.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_LENGTH = 8_000;
const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/\s*/i, reason: 'destructive root delete' },
  { pattern: /\brm\s+-rf\s+\*/i, reason: 'destructive wildcard delete' },
  { pattern: /\bdel\s+\/[A-Za-z]*\s+\/[A-Za-z]*\s+[A-Za-z]:\\/i, reason: 'destructive windows delete' },
  { pattern: /\bformat\s+[A-Za-z]:/i, reason: 'disk format command' },
  { pattern: /\bshutdown\b/i, reason: 'system shutdown command' },
  { pattern: /\breboot\b/i, reason: 'system reboot command' },
  { pattern: /\bpoweroff\b/i, reason: 'system poweroff command' },
  { pattern: /\bcurl\b.*\|\s*(bash|sh|zsh|python|perl|node|php)\b/i, reason: 'curl pipe to shell' },
  { pattern: /\bwget\b.*\|\s*(bash|sh|zsh|python|perl|node|php)\b/i, reason: 'wget pipe to shell' },
  { pattern: /\bnc\b.*\s+-e\b/i, reason: 'reverse shell (netcat)' },
  { pattern: /\bsh\s+-i\b/i, reason: 'interactive shell' },
  { pattern: /\bbash\s+-i\b/i, reason: 'interactive shell' },
];

export interface ShellExecutionOptions {
  timeoutMs?: number;
  allowUnsafe?: boolean;
  shell?: boolean;
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

export async function executeShell(
  command: string,
  args: string[] = [],
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

  const loggedCommand = args.length > 0 ? `${normalizedCommand} ${args.join(' ')}` : normalizedCommand;
  const blockedReason = options.allowUnsafe ? null : detectBlockedCommand(loggedCommand);
  if (blockedReason) {
    const blockedOutput = `Blocked unsafe command (${blockedReason}). Set allowUnsafe=true to override.`;
    await logSystemCommand(loggedCommand, blockedOutput, 126);
    return {
      ok: false,
      output: blockedOutput,
      exitCode: 126,
    };
  }

  const timeout = resolveTimeout(options.timeoutMs);

  try {
    const { stdout, stderr } = options.shell
      ? await execAsync(loggedCommand, {
          cwd,
          timeout,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        })
      : await execFileAsync(normalizedCommand, args, {
          cwd,
          timeout,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });

    const mergedOutput = truncateOutput(scrubSensitiveText(`${stdout}${stderr}`.trim()));
    await logSystemCommand(loggedCommand, mergedOutput || '(no output)', 0);

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
    await logSystemCommand(loggedCommand, mergedOutput || '(no output)', exitCode);

    return {
      ok: false,
      output: mergedOutput,
      exitCode,
    };
  }
}
