import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleLogsCli } from '../../src/core/logs-cli.js';

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('handleLogsCli', () => {
  let tempDir = '';
  let previousCwd = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-logs-cli-'));
    previousCwd = process.cwd();
    process.chdir(tempDir);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints current daily logs when available', async () => {
    await mkdir(path.join(tempDir, 'memory'), { recursive: true });
    const logBody = '## Thought @ 2026-01-01T00:00:00.000Z\nhello from daemon';
    await writeFile(path.join(tempDir, 'memory', `${currentDateIso()}.md`), logBody, 'utf8');

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const handled = await handleLogsCli(['logs']);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(writes.join('')).toContain('hello from daemon');
  });

  it('returns failure when no log file exists for today', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));

    const handled = await handleLogsCli(['logs']);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('No logs found');
  });

  it('starts follow mode without crashing when log file exists', async () => {
    await mkdir(path.join(tempDir, 'memory'), { recursive: true });
    await writeFile(path.join(tempDir, 'memory', `${currentDateIso()}.md`), '', 'utf8');

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(fs, 'watch').mockImplementation(() => ({ close: () => undefined }) as fs.FSWatcher);

    const handled = await handleLogsCli(['logs', '--follow']);
    expect(handled).toBe(true);
    expect(logs.join('\n')).toContain('Following logs');
  });
});
