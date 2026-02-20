import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDoctorCli, handleHelpCli, handleUnknownCommand } from '../../src/core/cli.js';
import * as doctorModule from '../../src/core/doctor.js';
import type { DoctorReport } from '../../src/types/doctor.js';

// Capture console output during tests
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    consoleOutput.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleErrors.push(args.join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Reset exitCode before each test
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ── handleHelpCli ────────────────────────────────────────────────────────────

describe('handleHelpCli', () => {
  it('returns false when --help is not present', () => {
    expect(handleHelpCli([])).toBe(false);
    expect(handleHelpCli(['doctor'])).toBe(false);
    expect(handleHelpCli(['secret', 'list'])).toBe(false);
  });

  it('returns true and prints help when --help is present', () => {
    const result = handleHelpCli(['--help']);
    expect(result).toBe(true);
    expect(consoleOutput.join('\n')).toMatch(/usage/i);
    expect(process.exitCode).toBe(0);
  });

  it('returns true and prints help when -h is present', () => {
    const result = handleHelpCli(['-h']);
    expect(result).toBe(true);
    expect(consoleOutput.join('\n')).toMatch(/usage/i);
    expect(process.exitCode).toBe(0);
  });

  it('help output includes known commands', () => {
    handleHelpCli(['--help']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('doctor');
    expect(output).toContain('setup');
    expect(output).toContain('secret');
  });
});

// ── handleDoctorCli ──────────────────────────────────────────────────────────

describe('handleDoctorCli', () => {
  const makeReport = (status: DoctorReport['status']): DoctorReport => ({
    status,
    results: [],
    checkedAt: new Date().toISOString(),
    passed: status === 'ok' ? 1 : 0,
    failed: status === 'ok' ? 0 : 1,
  });

  it('returns false when doctor is not the first arg', () => {
    expect(handleDoctorCli([])).toBe(false);
    expect(handleDoctorCli(['setup'])).toBe(false);
    expect(handleDoctorCli(['secret', 'doctor'])).toBe(false);
  });

  it('returns true when doctor is the first arg', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('ok'));
    const result = handleDoctorCli(['doctor']);
    expect(result).toBe(true);
  });

  it('outputs human-readable report when --json is not present', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('ok'));
    handleDoctorCli(['doctor']);
    const output = consoleOutput.join('\n');
    expect(output).toContain('TwinClaw Doctor');
    expect(output).not.toContain('"status"');
  });

  it('outputs JSON report when --json flag is present', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('ok'));
    handleDoctorCli(['doctor', '--json']);
    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output) as { status: string };
    expect(parsed.status).toMatch(/^(ok|degraded|critical)$/);
  });

  it('sets exit code 0 when status is ok', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('ok'));
    handleDoctorCli(['doctor']);
    expect(process.exitCode).toBe(0);
  });

  it('sets exit code 1 when status is degraded', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('degraded'));
    handleDoctorCli(['doctor']);
    expect(process.exitCode).toBe(1);
  });

  it('sets exit code 2 when status is critical', () => {
    vi.spyOn(doctorModule, 'runDoctorChecks').mockReturnValueOnce(makeReport('critical'));
    handleDoctorCli(['doctor']);
    expect(process.exitCode).toBe(2);
  });
});

// ── handleUnknownCommand ─────────────────────────────────────────────────────

describe('handleUnknownCommand', () => {
  it('returns false for an empty argv', () => {
    expect(handleUnknownCommand([])).toBe(false);
  });

  it('returns false for known commands', () => {
    expect(handleUnknownCommand(['doctor'])).toBe(false);
    expect(handleUnknownCommand(['setup'])).toBe(false);
    expect(handleUnknownCommand(['secret', 'list'])).toBe(false);
    expect(handleUnknownCommand(['--onboard'])).toBe(false);
    expect(handleUnknownCommand(['--help'])).toBe(false);
    expect(handleUnknownCommand(['-h'])).toBe(false);
  });

  it('returns true and sets exit code 1 for an unknown command', () => {
    const result = handleUnknownCommand(['totally-unknown-cmd']);
    expect(result).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(consoleErrors.join(' ')).toMatch(/unknown command/i);
  });

  it('prints a helpful message pointing to --help', () => {
    handleUnknownCommand(['bogus-command']);
    const errorOutput = consoleErrors.join(' ');
    expect(errorOutput).toContain('--help');
  });
});

