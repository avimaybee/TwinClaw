import { appendFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Skill } from './types.js';
import { executeShell } from './shell.js';
import { logToolCall } from '../utils/logger.js';

function resolveWorkspacePath(inputPath: string): string {
  const rootDir = process.env.TWINCLAW_SAFE_CWD ? path.resolve(process.env.TWINCLAW_SAFE_CWD) : process.cwd();
  const resolved = path.resolve(rootDir, inputPath);

  if (!resolved.startsWith(rootDir)) {
    throw new Error(`Access denied: Path '${inputPath}' resolves outside the allowed workspace.`);
  }

  return resolved;
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildReadFileSkill(): Skill {
  return {
    name: 'fs.read',
    group: 'group:fs',
    aliases: ['read_file'],
    description: 'Read a UTF-8 text file from disk.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
      },
      required: ['filePath'],
    },
    async execute(input) {
      const filePathValue = input.filePath;
      if (typeof filePathValue !== 'string' || filePathValue.trim().length === 0) {
        return { ok: false, output: 'filePath must be a non-empty string.' };
      }

      const absolutePath = resolveWorkspacePath(filePathValue);
      const content = await readFile(absolutePath, 'utf8');

      await logToolCall('fs.read', input, `Read ${content.length} chars from ${absolutePath}`);
      return { ok: true, output: content };
    },
  };
}

function buildListFilesSkill(): Skill {
  return {
    name: 'fs.list',
    group: 'group:fs',
    aliases: ['list_files'],
    description: 'List files and folders in a directory.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string' },
      },
      required: [],
    },
    async execute(input) {
      const dirPathValue = typeof input.dirPath === 'string' ? input.dirPath : '.';
      const absolutePath = resolveWorkspacePath(dirPathValue);

      const entries = await readdir(absolutePath, { withFileTypes: true });
      const output = entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .join('\n');

      await logToolCall('fs.list', input, `Listed ${entries.length} entries from ${absolutePath}`);
      return { ok: true, output };
    },
  };
}

function buildWriteFileSkill(): Skill {
  return {
    name: 'fs.write',
    group: 'group:fs',
    description: 'Write UTF-8 text content to a file path.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
      },
      required: ['filePath', 'content'],
    },
    async execute(input) {
      const filePathValue = input.filePath;
      if (typeof filePathValue !== 'string' || filePathValue.trim().length === 0) {
        return { ok: false, output: 'filePath must be a non-empty string.' };
      }

      const contentValue = input.content;
      if (typeof contentValue !== 'string') {
        return { ok: false, output: 'content must be a string.' };
      }

      const absolutePath = resolveWorkspacePath(filePathValue);
      if (input.append === true) {
        await appendFile(absolutePath, contentValue, 'utf8');
      } else {
        await writeFile(absolutePath, contentValue, 'utf8');
      }
      await logToolCall('fs.write', input, `Wrote ${contentValue.length} chars to ${absolutePath}`);
      return { ok: true, output: `Updated ${absolutePath}.` };
    },
  };
}

function buildApplyPatchSkill(): Skill {
  return {
    name: 'fs.apply_patch',
    group: 'group:fs',
    aliases: ['apply_patch'],
    description: 'Apply a unified diff patch to files in the current workspace using git apply.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string' },
      },
      required: ['patch'],
    },
    async execute(input) {
      const patchValue = input.patch;
      if (typeof patchValue !== 'string' || patchValue.trim().length === 0) {
        return { ok: false, output: 'patch must be a non-empty string.' };
      }

      const tempPatchPath = path.join(tmpdir(), `twinclaw-${randomUUID()}.patch`);
      try {
        await writeFile(tempPatchPath, patchValue, 'utf8');
        const result = await executeShell(
          `git apply --whitespace=nowarn ${quoteShellArg(tempPatchPath)}`,
          process.env.TWINCLAW_SAFE_CWD || process.cwd(),
          { timeoutMs: 20_000 },
        );
        if (!result.ok) {
          await logToolCall('fs.apply_patch', input, `Patch apply failed: ${result.output}`);
          return {
            ok: false,
            output: `Failed to apply patch: ${result.output || 'git apply returned a non-zero exit code.'}`,
          };
        }

        await logToolCall('fs.apply_patch', input, 'Patch applied successfully.');
        return { ok: true, output: 'Patch applied successfully.' };
      } finally {
        await rm(tempPatchPath, { force: true }).catch(() => undefined);
      }
    },
  };
}

function resolveShellOptions(input: Record<string, unknown>): { timeoutMs?: number; allowUnsafe?: boolean } {
  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
      ? Math.floor(input.timeoutMs)
      : undefined;
  const allowUnsafe = input.allowUnsafe === true;
  return { timeoutMs, allowUnsafe };
}

function buildRuntimeExecSkill(): Skill {
  return {
    name: 'runtime.exec',
    group: 'group:runtime',
    aliases: ['shell_execute'],
    description: 'Execute a shell command with timeout and safety checks.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
        allowUnsafe: { type: 'boolean' },
      },
      required: ['command'],
    },
    async execute(input) {
      const commandValue = input.command;
      if (typeof commandValue !== 'string' || commandValue.trim().length === 0) {
        return { ok: false, output: 'command must be a non-empty string.' };
      }
      const cwd = typeof input.cwd === 'string' ? resolveWorkspacePath(input.cwd) : undefined;
      const result = await executeShell(commandValue, cwd, resolveShellOptions(input));
      await logToolCall('runtime.exec', input, result.output || '(no output)');

      return {
        ok: result.ok,
        output: result.output,
      };
    },
  };
}

function buildRuntimePowerShellSkill(): Skill {
  return {
    name: 'runtime.powershell',
    group: 'group:runtime',
    description: 'Execute a script using Windows PowerShell with timeout and safety checks.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
        allowUnsafe: { type: 'boolean' },
      },
      required: ['script'],
    },
    async execute(input) {
      const scriptValue = input.script;
      if (typeof scriptValue !== 'string' || scriptValue.trim().length === 0) {
        return { ok: false, output: 'script must be a non-empty string.' };
      }
      const cwd = typeof input.cwd === 'string' ? resolveWorkspacePath(input.cwd) : undefined;
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command ${quoteShellArg(scriptValue)}`;
      const result = await executeShell(command, cwd, resolveShellOptions(input));
      await logToolCall('runtime.powershell', input, result.output || '(no output)');
      return {
        ok: result.ok,
        output: result.output,
      };
    },
  };
}

function buildRuntimeProcessSkill(): Skill {
  return {
    name: 'runtime.process',
    group: 'group:runtime',
    description: 'Execute an executable with argument array under shell safety constraints.',
    parameters: {
      type: 'object',
      properties: {
        executable: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
        allowUnsafe: { type: 'boolean' },
      },
      required: ['executable'],
    },
    async execute(input) {
      const executableValue = input.executable;
      if (typeof executableValue !== 'string' || executableValue.trim().length === 0) {
        return { ok: false, output: 'executable must be a non-empty string.' };
      }

      const argsValue = Array.isArray(input.args)
        ? input.args.filter((arg): arg is string => typeof arg === 'string')
        : [];
      const command = [quoteShellArg(executableValue), ...argsValue.map(quoteShellArg)].join(' ');
      const cwd = typeof input.cwd === 'string' ? resolveWorkspacePath(input.cwd) : undefined;
      const result = await executeShell(command, cwd, resolveShellOptions(input));
      await logToolCall('runtime.process', input, result.output || '(no output)');
      return {
        ok: result.ok,
        output: result.output,
      };
    },
  };
}

export function createBuiltinSkills(): Skill[] {
  return [
    buildReadFileSkill(),
    buildListFilesSkill(),
    buildWriteFileSkill(),
    buildApplyPatchSkill(),
    buildRuntimeExecSkill(),
    buildRuntimePowerShellSkill(),
    buildRuntimeProcessSkill(),
  ];
}
