import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  OnboardingCancelledError,
  parseOnboardArgs,
  runSetupWizard,
  type SetupPrompter,
} from '../../src/core/onboarding.js';

class CancelPrompter implements SetupPrompter {
  async prompt(_question: string): Promise<string> {
    throw new OnboardingCancelledError();
  }

  close(): void {
    // no-op
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('runSetupWizard', () => {
  let tempDir = '';
  let configPath = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-onboard-'));
    configPath = path.join(tempDir, 'twinclaw.json');
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('writes first-run config in non-interactive mode', async () => {
    const result = await runSetupWizard({
      nonInteractive: true,
      configPathOverride: configPath,
      providedValues: {
        API_SECRET: 'top-secret',
        OPENROUTER_API_KEY: 'openrouter-key',
      },
    });

    expect(result.status).toBe('success');
    const config = await readJson(configPath);
    const runtime = config['runtime'] as Record<string, unknown>;
    const models = config['models'] as Record<string, unknown>;
    expect(runtime['apiSecret']).toBe('top-secret');
    expect(models['openRouterApiKey']).toBe('openrouter-key');
  });

  it('supports rerun updates without corrupting existing config', async () => {
    await runSetupWizard({
      nonInteractive: true,
      configPathOverride: configPath,
      providedValues: {
        API_SECRET: 'initial-secret',
        OPENROUTER_API_KEY: 'old-openrouter-key',
      },
    });

    const rerun = await runSetupWizard({
      nonInteractive: true,
      configPathOverride: configPath,
      providedValues: {
        OPENROUTER_API_KEY: 'new-openrouter-key',
        API_PORT: '4567',
      },
    });

    expect(rerun.status).toBe('success');
    const config = await readJson(configPath);
    const runtime = config['runtime'] as Record<string, unknown>;
    const models = config['models'] as Record<string, unknown>;
    expect(runtime['apiSecret']).toBe('initial-secret');
    expect(runtime['apiPort']).toBe(4567);
    expect(models['openRouterApiKey']).toBe('new-openrouter-key');
  });

  it('returns validation_error and avoids writes on invalid non-interactive input', async () => {
    const result = await runSetupWizard({
      nonInteractive: true,
      configPathOverride: configPath,
      providedValues: {
        API_PORT: '99999',
      },
    });

    expect(result.status).toBe('validation_error');
    await expect(readFile(configPath, 'utf8')).rejects.toBeDefined();
  });

  it('returns cancelled and avoids writes when prompting is interrupted', async () => {
    const result = await runSetupWizard({
      configPathOverride: configPath,
      prompter: new CancelPrompter(),
    });

    expect(result.status).toBe('cancelled');
    await expect(readFile(configPath, 'utf8')).rejects.toBeDefined();
  });

  it('does not leak secret values in onboarding output', async () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...args) => output.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => output.push(args.join(' ')));

    const secret = 'super-sensitive-secret-xyz';
    const result = await runSetupWizard({
      nonInteractive: true,
      configPathOverride: configPath,
      providedValues: {
        API_SECRET: secret,
        OPENROUTER_API_KEY: 'openrouter-key',
      },
    });

    expect(result.status).toBe('success');
    expect(output.join('\n')).not.toContain(secret);
  });
});

describe('parseOnboardArgs', () => {
  it('parses non-interactive flags', () => {
    const parsed = parseOnboardArgs([
      '--non-interactive',
      '--api-secret',
      'abc123',
      '--openrouter-api-key',
      'router',
      '--config',
      'C:\\tmp\\twinclaw.json',
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.nonInteractive).toBe(true);
    expect(parsed.values.API_SECRET).toBe('abc123');
    expect(parsed.values.OPENROUTER_API_KEY).toBe('router');
    expect(parsed.configPathOverride).toContain('twinclaw.json');
  });

  it('returns error for unknown options', () => {
    const parsed = parseOnboardArgs(['--non-interactive', '--bogus']);
    expect(parsed.error).toMatch(/unknown option/i);
  });

  it('returns error for missing option values', () => {
    const parsed = parseOnboardArgs(['--api-secret']);
    expect(parsed.error).toMatch(/missing value/i);
  });
});
