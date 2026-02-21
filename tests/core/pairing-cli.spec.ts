import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { handlePairingCli } from '../../src/core/pairing-cli.js';
import { DmPairingService } from '../../src/services/dm-pairing.js';

describe('handlePairingCli', () => {
  let tempDir: string;
  let service: DmPairingService;
  const output: string[] = [];
  const errors: string[] = [];

  beforeEach(async () => {
    output.length = 0;
    errors.length = 0;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-pairing-cli-'));
    service = new DmPairingService({ credentialsDir: tempDir });
    process.exitCode = undefined;

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns false when command is not pairing', () => {
    expect(handlePairingCli(['doctor'], service)).toBe(false);
  });

  it('lists pending requests for a channel', () => {
    const created = service.requestPairing('telegram', '12345');
    expect(created.status).toBe('created');

    const handled = handlePairingCli(['pairing', 'list', 'telegram'], service);
    expect(handled).toBe(true);
    expect(output.join('\n')).toContain(`code=${created.request?.code}`);
  });

  it('approves a valid pairing code', () => {
    const created = service.requestPairing('telegram', '12345');
    expect(created.status).toBe('created');
    const code = created.request?.code;
    expect(code).toBeDefined();

    const handled = handlePairingCli(['pairing', 'approve', 'telegram', String(code)], service);
    expect(handled).toBe(true);
    expect(output.join('\n')).toContain('Approved sender');
  });

  it('sets a failing exit code on invalid channel', () => {
    const handled = handlePairingCli(['pairing', 'list', 'discord'], service);
    expect(handled).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Unsupported channel');
  });
});
