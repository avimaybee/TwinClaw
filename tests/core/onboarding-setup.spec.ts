import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readDotEnv, persistDotEnv } from '../../src/core/onboarding.js';

// ── readDotEnv ───────────────────────────────────────────────────────────────

describe('readDotEnv', () => {
  const tmpFile = path.join(os.tmpdir(), `test-dot-env-${Date.now()}.env`);

  afterEach(async () => {
    try { await unlink(tmpFile); } catch { /* already gone */ }
  });

  it('returns an empty map for a non-existent file', async () => {
    const map = await readDotEnv('/tmp/does-not-exist-xyz.env');
    expect(map.size).toBe(0);
  });

  it('parses key=value pairs from a real .env file', async () => {
    await writeFile(tmpFile, 'FOO=bar\nBAZ=qux\n', 'utf8');
    const map = await readDotEnv(tmpFile);
    expect(map.get('FOO')).toBe('bar');
    expect(map.get('BAZ')).toBe('qux');
  });

  it('skips blank lines and comment lines', async () => {
    await writeFile(
      tmpFile,
      '# This is a comment\n\nFOO=bar\n   \n# Another comment\nBAZ=qux\n',
      'utf8',
    );
    const map = await readDotEnv(tmpFile);
    expect(map.size).toBe(2);
    expect(map.get('FOO')).toBe('bar');
  });

  it('handles values that contain equals signs', async () => {
    await writeFile(tmpFile, 'TOKEN=abc=def=ghi\n', 'utf8');
    const map = await readDotEnv(tmpFile);
    expect(map.get('TOKEN')).toBe('abc=def=ghi');
  });

  it('returns an empty map for an empty file', async () => {
    await writeFile(tmpFile, '', 'utf8');
    const map = await readDotEnv(tmpFile);
    expect(map.size).toBe(0);
  });
});

// ── persistDotEnv ────────────────────────────────────────────────────────────

describe('persistDotEnv', () => {
  const tmpFile = path.join(os.tmpdir(), `test-persist-env-${Date.now()}.env`);

  afterEach(async () => {
    try { await unlink(tmpFile); } catch { /* already gone */ }
  });

  it('writes new entries to a fresh file', async () => {
    const existing = new Map<string, string>();
    await persistDotEnv(tmpFile, existing, [
      { name: 'FOO', value: 'bar' },
      { name: 'BAZ', value: 'qux' },
    ]);

    const written = await readDotEnv(tmpFile);
    expect(written.get('FOO')).toBe('bar');
    expect(written.get('BAZ')).toBe('qux');
  });

  it('preserves existing entries (idempotent — existing keys kept)', async () => {
    const existing = new Map<string, string>([
      ['EXISTING_KEY', 'original-value'],
    ]);
    await persistDotEnv(tmpFile, existing, [
      { name: 'NEW_KEY', value: 'new-value' },
    ]);

    const written = await readDotEnv(tmpFile);
    expect(written.get('EXISTING_KEY')).toBe('original-value');
    expect(written.get('NEW_KEY')).toBe('new-value');
  });

  it('overwrites an existing key when a new value is provided for it', async () => {
    const existing = new Map<string, string>([['OVERWRITE_ME', 'old']]);
    await persistDotEnv(tmpFile, existing, [
      { name: 'OVERWRITE_ME', value: 'new' },
    ]);

    const written = await readDotEnv(tmpFile);
    expect(written.get('OVERWRITE_ME')).toBe('new');
  });

  it('ignores update entries with blank values', async () => {
    const existing = new Map<string, string>();
    await persistDotEnv(tmpFile, existing, [
      { name: 'EMPTY_VAL', value: '' },
      { name: 'BLANK_VAL', value: '   ' },
      { name: 'REAL_VAL', value: 'hello' },
    ]);

    const written = await readDotEnv(tmpFile);
    expect(written.has('EMPTY_VAL')).toBe(false);
    expect(written.has('BLANK_VAL')).toBe(false);
    expect(written.get('REAL_VAL')).toBe('hello');
  });

  it('does not corrupt the file on second call with same data (idempotent)', async () => {
    const existing = new Map<string, string>([['STABLE', 'value']]);
    await persistDotEnv(tmpFile, existing, []);
    await persistDotEnv(tmpFile, existing, []);

    const written = await readDotEnv(tmpFile);
    expect(written.get('STABLE')).toBe('value');
  });
});
