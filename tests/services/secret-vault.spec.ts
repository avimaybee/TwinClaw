import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { SecretVaultService } from '../../src/services/secret-vault.js';

describe('SecretVaultService', () => {
  let db: Database;
  let currentTime: Date;
  let service: SecretVaultService;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    currentTime = new Date('2026-02-20T00:00:00.000Z');
    service = new SecretVaultService({
      database: db,
      masterKey: 'vault-test-master-key',
      now: () => currentTime,
      requiredSecrets: ['API_SECRET'],
    });
  });

  afterEach(() => {
    db.close();
  });

  it('stores non-plaintext values and returns typed metadata', () => {
    const rawValue = 'super-secret-value-123456789';
    const metadata = service.setSecret({
      name: 'API_SECRET',
      value: rawValue,
      scope: 'api',
      required: true,
      rotationWindowHours: 24,
      warningWindowHours: 6,
    });

    expect(metadata.name).toBe('API_SECRET');
    expect(metadata.scope).toBe('api');
    expect(metadata.source).toBe('vault');
    expect(metadata.required).toBe(true);
    expect(metadata.lastRotatedAt).toBe('2026-02-20T00:00:00.000Z');

    const stored = db
      .prepare('SELECT ciphertext FROM secret_vault_values WHERE secret_name = ?')
      .get('API_SECRET') as { ciphertext: string } | undefined;
    expect(stored).toBeDefined();
    expect(stored?.ciphertext).not.toContain(rawValue);
    expect(service.readSecret('API_SECRET')).toBe(rawValue);
  });

  it('persists a unique PBKDF2 salt in vault metadata', () => {
    service.setSecret({
      name: 'API_SECRET',
      value: 'salt-check-secret-value',
      scope: 'api',
      required: true,
      rotationWindowHours: 24,
      warningWindowHours: 6,
    });

    const meta = db
      .prepare('SELECT value FROM secret_vault_meta WHERE key = ?')
      .get('master_key_salt') as { value: string } | undefined;

    expect(meta).toBeDefined();
    expect(Buffer.from(meta!.value, 'base64').length).toBeGreaterThanOrEqual(16);
  });

  it('keeps previous value active when rotation fails mid-transaction', () => {
    service.setSecret({
      name: 'API_SECRET',
      value: 'initial-secret-value-123',
      scope: 'api',
      required: true,
      rotationWindowHours: 24,
      warningWindowHours: 6,
    });

    db.exec(`
      CREATE TRIGGER fail_secret_rotation_update
      BEFORE UPDATE ON secret_vault_values
      BEGIN
        SELECT RAISE(ABORT, 'forced rotation failure');
      END;
    `);

    expect(() =>
      service.rotateSecret({
        name: 'API_SECRET',
        nextValue: 'next-secret-value-456',
      }),
    ).toThrow(/Previous value remains active/i);

    expect(service.readSecret('API_SECRET')).toBe('initial-secret-value-123');
    const versionCount = db
      .prepare('SELECT COUNT(*) AS count FROM secret_vault_versions WHERE secret_name = ?')
      .get('API_SECRET') as { count: number };
    expect(versionCount.count).toBe(0);
  });

  it('fails preflight when required secrets are missing or expired', () => {
    expect(() => service.assertStartupPreflight(['API_SECRET'])).toThrow(/missing/i);

    service.setSecret({
      name: 'API_SECRET',
      value: 'temporary-secret-abc',
      scope: 'api',
      required: true,
      rotationWindowHours: 1,
      warningWindowHours: 1,
    });

    currentTime = new Date('2026-02-20T02:30:00.000Z');
    expect(() => service.assertStartupPreflight(['API_SECRET'])).toThrow(/expired/i);
  });

  it('redacts registered secret values from arbitrary traces', () => {
    const secretValue = 'raw-model-token-987654321';
    service.setSecret({
      name: 'OPENROUTER_API_KEY',
      value: secretValue,
      scope: 'model',
      rotationWindowHours: 48,
      warningWindowHours: 8,
    });

    const redacted = service.redact(
      `Outbound payload included token fragment: ${secretValue}. This must not be logged.`,
    );

    expect(redacted).not.toContain(secretValue);
    expect(redacted).toContain('[REDACTED]');
  });
});
