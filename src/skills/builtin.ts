import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Skill } from './types.js';
import { executeShell } from './shell.js';
import { logToolCall } from '../utils/logger.js';

function resolveWorkspacePath(inputPath: string): string {
  return path.resolve(process.cwd(), inputPath);
}

function buildReadFileSkill(): Skill {
  return {
    name: 'read_file',
    description: 'Read a UTF-8 text file from disk.',
    async execute(input) {
      const filePathValue = input.filePath;
      if (typeof filePathValue !== 'string' || filePathValue.trim().length === 0) {
        return { ok: false, output: 'filePath must be a non-empty string.' };
      }

      const absolutePath = resolveWorkspacePath(filePathValue);
      const content = await readFile(absolutePath, 'utf8');

      await logToolCall('read_file', input, `Read ${content.length} chars from ${absolutePath}`);
      return { ok: true, output: content };
    },
  };
}

function buildListFilesSkill(): Skill {
  return {
    name: 'list_files',
    description: 'List files and folders in a directory.',
    async execute(input) {
      const dirPathValue = typeof input.dirPath === 'string' ? input.dirPath : '.';
      const absolutePath = resolveWorkspacePath(dirPathValue);

      const entries = await readdir(absolutePath, { withFileTypes: true });
      const output = entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .join('\n');

      await logToolCall('list_files', input, `Listed ${entries.length} entries from ${absolutePath}`);
      return { ok: true, output };
    },
  };
}

function buildShellExecuteSkill(): Skill {
  return {
    name: 'shell_execute',
    description: 'Execute a shell command with transcript logging and sanitization.',
    async execute(input) {
      const commandValue = input.command;
      if (typeof commandValue !== 'string' || commandValue.trim().length === 0) {
        return { ok: false, output: 'command must be a non-empty string.' };
      }

      const cwd = typeof input.cwd === 'string' ? resolveWorkspacePath(input.cwd) : undefined;
      const result = await executeShell(commandValue, cwd);
      await logToolCall('shell_execute', input, result.output || '(no output)');

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
    buildShellExecuteSkill(),
  ];
}