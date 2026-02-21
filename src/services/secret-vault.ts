import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import * as dbModule from './db.js';
import type {
  SecretDiagnostics,
  SecretHealthReport,
  SecretLifecycleStatus,
  SecretMetadata,
  SecretRevokeInput,
  SecretRotateInput,
  SecretScope,
  SecretSetInput,
  SecretSource,
} from '../types/secret-vault.js';
import { getConfigValue, loadTwinClawJson } from '../config/config-loader.js';

const DEFAULT_ROTATION_WINDOW_HOURS = 24 * 30;
const DEFAULT_WARNING_WINDOW_HOURS = 24 * 3;
const DEFAULT_REQUIRED_SECRETS = ['API_SECRET'];
const MIN_REDACTION_VALUE_LENGTH = 6;

const SENSITIVE_ENV_NAME_PATTERN = /(api[_-]?key|token|secret|password)/i;

const ALLOWED_SCOPES: SecretScope[] = ['api', 'model', 'messaging', 'runtime', 'storage', 'integration'];
const ALLOWED_SOURCES: SecretSource[] = ['env', 'vault', 'runtime'];

interface SecretRegistryRow {
  name: string;
  scope: string;
  source: string;
  required: number;
  rotation_window_hours: number;
  warning_window_hours: number;
  status: string;
  last_rotated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface SecretPayloadRow extends SecretRegistryRow {
  ciphertext: string | null;
  iv: string | null;
  auth_tag: string | null;
}

interface SecretEncryptedValue {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface SecretVaultServiceOptions {
  masterKey?: string;
  requiredSecrets?: string[];
  now?: () => Date;
  database?: BetterSqlite3.Database | null;
}

function normalizeSecretName(name: string): string {
  const normalized = name.trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(normalized)) {
    throw new Error(`Secret name '${name}' is invalid. Use uppercase letters, numbers, and underscores only.`);
  }
  return normalized;
}

function normalizeSecretValue(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Secret value must be a non-empty string.');
  }
  return value;
}

function normalizeHours(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number') {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Rotation and warning windows must be positive numbers.');
  }
  return Math.floor(value);
}

function isSecretScope(value: string): value is SecretScope {
  return ALLOWED_SCOPES.includes(value as SecretScope);
}

function isSecretSource(value: string): value is SecretSource {
  return ALLOWED_SOURCES.includes(value as SecretSource);
}

function safeParseDate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveExpiryIso(nowMs: number, rotationWindowHours: number, explicitExpiry?: string | null): string | null {
  if (explicitExpiry === null) {
    return null;
  }
  if (typeof explicitExpiry === 'string') {
    const parsed = safeParseDate(explicitExpiry);
    if (parsed === null) {
      throw new Error(`Invalid expiresAt value '${explicitExpiry}'. Expected ISO-8601.`);
    }
    return new Date(parsed).toISOString();
  }
  return new Date(nowMs + rotationWindowHours * 60 * 60 * 1000).toISOString();
}

function deriveMasterKey(raw: string): Buffer {
  return createHash('sha256').update(raw).digest();
}

function splitRequiredSecrets(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeSecretName(item));
}

function resolveDatabaseFromModule(): BetterSqlite3.Database | null {
  const maybeDb = (dbModule as { db?: BetterSqlite3.Database }).db;
  if (!maybeDb || typeof maybeDb.prepare !== 'function') {
    return null;
  }
  return maybeDb;
}

export class SecretVaultService {
  private readonly now: () => Date;
  private readonly requiredSecrets: Set<string>;
  private readonly runtimeSecretValues: Map<string, string> = new Map();
  private readonly explicitMasterKey?: string;
  private readonly db: BetterSqlite3.Database | null;
  private cachedMasterKey: Buffer | null = null;
  private tablesReady = false;

  constructor(options: SecretVaultServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.explicitMasterKey = options.masterKey;
    this.db = options.database === undefined ? resolveDatabaseFromModule() : options.database;
    const configuredRequired = splitRequiredSecrets(getConfigValue('SECRET_VAULT_REQUIRED'));
    const combinedRequired = [
      ...(options.requiredSecrets ?? []),
      ...configuredRequired,
      ...DEFAULT_REQUIRED_SECRETS,
    ];
    this.requiredSecrets = new Set(combinedRequired.map((name) => normalizeSecretName(name)));
  }

  setSecret(input: SecretSetInput): SecretMetadata {
    const db = this.requireDatabase();
    this.ensureTables();

    const name = normalizeSecretName(input.name);
    const value = normalizeSecretValue(input.value);
    const nowMs = this.now().getTime();
    const nowIso = new Date(nowMs).toISOString();

    const scope = input.scope ?? 'runtime';
    const source = input.source ?? 'vault';
    if (!isSecretScope(scope)) {
      throw new Error(`Invalid secret scope '${scope}'.`);
    }
    if (!isSecretSource(source)) {
      throw new Error(`Invalid secret source '${source}'.`);
    }

    const rotationWindowHours = normalizeHours(
      input.rotationWindowHours,
      DEFAULT_ROTATION_WINDOW_HOURS,
    );
    const warningWindowHours = normalizeHours(
      input.warningWindowHours,
      Math.min(DEFAULT_WARNING_WINDOW_HOURS, rotationWindowHours),
    );
    const expiresAt = deriveExpiryIso(nowMs, rotationWindowHours, input.expiresAt);
    const encrypted = this.encrypt(value);

    const tx = db.transaction(() => {
      const previous = db
        .prepare(
          `SELECT version, ciphertext, iv, auth_tag
           FROM secret_vault_values
           WHERE secret_name = ?`,
        )
        .get(name) as
        | { version: number; ciphertext: string; iv: string; auth_tag: string }
        | undefined;

      if (previous) {
        db.prepare(
          `INSERT INTO secret_vault_versions (
            id, secret_name, version, ciphertext, iv, auth_tag, rotated_at, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          name,
          previous.version,
          previous.ciphertext,
          previous.iv,
          previous.auth_tag,
          nowIso,
          'set-overwrite',
        );
      }

      db.prepare(
        `INSERT INTO secret_vault_registry (
          name,
          scope,
          source,
          required,
          rotation_window_hours,
          warning_window_hours,
          status,
          last_rotated_at,
          expires_at,
          revoked_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          scope = excluded.scope,
          source = excluded.source,
          required = excluded.required,
          rotation_window_hours = excluded.rotation_window_hours,
          warning_window_hours = excluded.warning_window_hours,
          status = 'active',
          last_rotated_at = excluded.last_rotated_at,
          expires_at = excluded.expires_at,
          revoked_at = NULL,
          updated_at = excluded.updated_at`,
      ).run(
        name,
        scope,
        source,
        input.required ? 1 : 0,
        rotationWindowHours,
        warningWindowHours,
        nowIso,
        expiresAt,
        nowIso,
        nowIso,
      );

      db.prepare(
        `INSERT INTO secret_vault_values (
          secret_name,
          version,
          ciphertext,
          iv,
          auth_tag,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(secret_name) DO UPDATE SET
          version = excluded.version,
          ciphertext = excluded.ciphertext,
          iv = excluded.iv,
          auth_tag = excluded.auth_tag,
          updated_at = excluded.updated_at`,
      ).run(
        name,
        previous ? previous.version + 1 : 1,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        nowIso,
      );

      this.insertAuditEvent(db, name, 'set', 'success', 'Secret value updated.');
      return this.getMetadataByNameInternal(name, db);
    });

    const metadata = tx();
    if (!metadata) {
      throw new Error(`Failed to persist secret metadata for '${name}'.`);
    }
    this.runtimeSecretValues.set(name, value);
    return metadata;
  }

  rotateSecret(input: SecretRotateInput): SecretMetadata {
    const db = this.requireDatabase();
    this.ensureTables();

    const name = normalizeSecretName(input.name);
    const nextValue = normalizeSecretValue(input.nextValue);
    const nowMs = this.now().getTime();
    const nowIso = new Date(nowMs).toISOString();

    try {
      const tx = db.transaction(() => {
        const existingRow = db
          .prepare(
            `SELECT
              r.name,
              r.scope,
              r.source,
              r.required,
              r.rotation_window_hours,
              r.warning_window_hours,
              r.status,
              r.last_rotated_at,
              r.expires_at,
              r.revoked_at,
              r.created_at,
              r.updated_at,
              COALESCE(v.version, 0) AS version,
              v.ciphertext,
              v.iv,
              v.auth_tag
            FROM secret_vault_registry r
            LEFT JOIN secret_vault_values v ON v.secret_name = r.name
            WHERE r.name = ?`,
          )
          .get(name) as SecretPayloadRow | undefined;

        if (!existingRow) {
          throw new Error(`Secret '${name}' is not registered.`);
        }
        if (existingRow.status === 'revoked') {
          throw new Error(`Secret '${name}' is revoked and must be reset before rotation.`);
        }
        if (!existingRow.ciphertext || !existingRow.iv || !existingRow.auth_tag) {
          throw new Error(`Secret '${name}' has no stored value to rotate.`);
        }

        const nextRotationWindow = normalizeHours(
          input.rotationWindowHours,
          existingRow.rotation_window_hours || DEFAULT_ROTATION_WINDOW_HOURS,
        );
        const nextWarningWindow = normalizeHours(
          input.warningWindowHours,
          existingRow.warning_window_hours || DEFAULT_WARNING_WINDOW_HOURS,
        );
        const expiresAt = deriveExpiryIso(nowMs, nextRotationWindow, input.expiresAt);
        const encrypted = this.encrypt(nextValue);

        db.prepare(
          `INSERT INTO secret_vault_versions (
            id, secret_name, version, ciphertext, iv, auth_tag, rotated_at, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          name,
          existingRow.version,
          existingRow.ciphertext,
          existingRow.iv,
          existingRow.auth_tag,
          nowIso,
          input.reason ?? 'manual-rotation',
        );

        db.prepare(
          `UPDATE secret_vault_values
           SET version = ?,
               ciphertext = ?,
               iv = ?,
               auth_tag = ?,
               updated_at = ?
           WHERE secret_name = ?`,
        ).run(
          existingRow.version + 1,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          nowIso,
          name,
        );

        db.prepare(
          `UPDATE secret_vault_registry
           SET status = 'active',
               rotation_window_hours = ?,
               warning_window_hours = ?,
               last_rotated_at = ?,
               expires_at = ?,
               revoked_at = NULL,
               updated_at = ?
           WHERE name = ?`,
        ).run(
          nextRotationWindow,
          nextWarningWindow,
          nowIso,
          expiresAt,
          nowIso,
          name,
        );

        this.insertAuditEvent(
          db,
          name,
          'rotate',
          'success',
          `Secret rotated successfully. reason=${input.reason ?? 'manual-rotation'}`,
        );

        return this.getMetadataByNameInternal(name, db);
      });

      const metadata = tx();
      if (!metadata) {
        throw new Error(`Rotation completed but metadata for '${name}' was not found.`);
      }
      this.runtimeSecretValues.set(name, nextValue);
      return metadata;
    } catch (error) {
      this.insertAuditEventSafe(
        name,
        'rotate',
        'failure',
        `Rotation rolled back. ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(`Secret rotation failed for '${name}'. Previous value remains active.`);
    }
  }

  revokeSecret(input: SecretRevokeInput): SecretMetadata {
    const db = this.requireDatabase();
    this.ensureTables();

    const name = normalizeSecretName(input.name);
    const nowIso = this.now().toISOString();

    const tx = db.transaction(() => {
      const existing = this.getMetadataByNameInternal(name, db);
      if (!existing) {
        throw new Error(`Secret '${name}' is not registered.`);
      }

      db.prepare(
        `UPDATE secret_vault_registry
         SET status = 'revoked',
             revoked_at = ?,
             updated_at = ?
         WHERE name = ?`,
      ).run(nowIso, nowIso, name);

      this.insertAuditEvent(
        db,
        name,
        'revoke',
        'success',
        `Secret revoked. reason=${input.reason ?? 'manual-revoke'}`,
      );

      return this.getMetadataByNameInternal(name, db);
    });

    const metadata = tx();
    if (!metadata) {
      throw new Error(`Failed to revoke secret '${name}'.`);
    }
    this.runtimeSecretValues.delete(name);
    return metadata;
  }

  listSecrets(): SecretMetadata[] {
    if (!this.db) {
      return [];
    }
    this.ensureTables();

    const rows = this.db
      .prepare(
        `SELECT
          r.name,
          r.scope,
          r.source,
          r.required,
          r.rotation_window_hours,
          r.warning_window_hours,
          r.status,
          r.last_rotated_at,
          r.expires_at,
          r.revoked_at,
          r.created_at,
          r.updated_at,
          COALESCE(v.version, 0) AS version
        FROM secret_vault_registry r
        LEFT JOIN secret_vault_values v ON v.secret_name = r.name
        ORDER BY r.name ASC`,
      )
      .all() as SecretRegistryRow[];

    return rows.map((row) => this.toMetadata(row));
  }

  getMetadataByName(name: string): SecretMetadata | null {
    if (!this.db) {
      return null;
    }
    this.ensureTables();
    return this.getMetadataByNameInternal(normalizeSecretName(name), this.db);
  }

  /**
   * Centralized runtime secret read path.
   * Vault values take precedence over environment fallbacks.
   */
  readSecret(name: string): string | null {
    const normalized = normalizeSecretName(name);
    const runtimeValue = this.runtimeSecretValues.get(normalized);
    if (runtimeValue) {
      return runtimeValue;
    }

    const vaultValue = this.readVaultSecretValue(normalized);
    if (vaultValue) {
      return vaultValue;
    }

    const envValue = getConfigValue(normalized, true);
    if (typeof envValue === 'string' && envValue.length > 0) {
      return envValue;
    }

    return null;
  }

  getSecretHealth(requiredSecrets: string[] = []): SecretHealthReport {
    const metadata = this.listSecrets();
    const metadataByName = new Map(metadata.map((item) => [item.name, item]));
    const nowMs = this.now().getTime();

    const requiredNames = new Set<string>(this.requiredSecrets);
    for (const item of requiredSecrets) {
      requiredNames.add(normalizeSecretName(item));
    }
    for (const item of metadata) {
      if (item.required) {
        requiredNames.add(item.name);
      }
    }

    const missingRequired: string[] = [];
    const expired: string[] = [];

    for (const name of requiredNames) {
      const value = this.readSecret(name);
      if (!value) {
        missingRequired.push(name);
      }

      const row = metadataByName.get(name);
      if (row?.status === 'expired') {
        expired.push(name);
      }
    }

    const warnings: string[] = [];
    for (const row of metadata) {
      if (row.status !== 'active' || !row.expiresAt) {
        continue;
      }
      const expiresAtMs = safeParseDate(row.expiresAt);
      if (expiresAtMs === null) {
        continue;
      }
      const warningStartMs = expiresAtMs - row.warningWindowHours * 60 * 60 * 1000;
      if (nowMs >= warningStartMs && nowMs < expiresAtMs) {
        warnings.push(`${row.name} is nearing expiry (${row.expiresAt}).`);
      }
    }

    return {
      missingRequired: [...new Set(missingRequired)].sort(),
      expired: [...new Set(expired)].sort(),
      warnings,
      hasIssues: missingRequired.length > 0 || expired.length > 0,
    };
  }

  assertStartupPreflight(requiredSecrets: string[] = []): SecretHealthReport {
    const health = this.getSecretHealth(requiredSecrets);
    if (health.hasIssues) {
      const reasons: string[] = [];
      if (health.missingRequired.length > 0) {
        reasons.push(`missing: ${health.missingRequired.join(', ')}`);
      }
      if (health.expired.length > 0) {
        reasons.push(`expired: ${health.expired.join(', ')}`);
      }
      this.insertAuditEventSafe('*', 'preflight', 'failure', reasons.join(' | '));
      throw new Error(`Secret preflight failed (${reasons.join('; ')}).`);
    }

    this.insertAuditEventSafe('*', 'preflight', 'success', 'Startup preflight passed.');
    return health;
  }

  getDiagnostics(requiredSecrets: string[] = []): SecretDiagnostics {
    const metadata = this.listSecrets();
    const health = this.getSecretHealth(requiredSecrets);
    const nowMs = this.now().getTime();

    const dueForRotation = metadata
      .filter((item) => {
        if (item.status !== 'active' || !item.expiresAt) {
          return false;
        }
        const expiresAtMs = safeParseDate(item.expiresAt);
        if (expiresAtMs === null) {
          return false;
        }
        const warningStart = expiresAtMs - item.warningWindowHours * 60 * 60 * 1000;
        return nowMs >= warningStart && nowMs < expiresAtMs;
      })
      .map((item) => item.name);

    return {
      health,
      total: metadata.length,
      active: metadata.filter((item) => item.status === 'active').length,
      revoked: metadata.filter((item) => item.status === 'revoked').length,
      expired: metadata.filter((item) => item.status === 'expired').length,
      dueForRotation,
    };
  }

  redact(text: string): string {
    if (!text) {
      return text;
    }

    const values = this.collectRedactionValues();
    let redacted = text;
    for (const candidate of values) {
      redacted = redacted.split(candidate).join('[REDACTED]');
    }
    return redacted;
  }

  private ensureTables(): void {
    if (this.tablesReady || !this.db) {
      return;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secret_vault_registry (
        name TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        rotation_window_hours INTEGER NOT NULL,
        warning_window_hours INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_rotated_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS secret_vault_values (
        secret_name TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(secret_name) REFERENCES secret_vault_registry(name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS secret_vault_versions (
        id TEXT PRIMARY KEY,
        secret_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        rotated_at TEXT NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(secret_name) REFERENCES secret_vault_registry(name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS secret_vault_audit_events (
        id TEXT PRIMARY KEY,
        secret_name TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.tablesReady = true;
  }

  private requireDatabase(): BetterSqlite3.Database {
    if (!this.db) {
      throw new Error('Secret vault storage is unavailable in this runtime.');
    }
    return this.db;
  }

  private resolveMasterKey(): Buffer {
    if (this.cachedMasterKey) {
      return this.cachedMasterKey;
    }

    const source =
      this.explicitMasterKey ??
      getConfigValue('SECRET_VAULT_MASTER_KEY', true) ??
      getConfigValue('API_SECRET', true);
    if (!source) {
      throw new Error(
        'Missing SECRET_VAULT_MASTER_KEY (or API_SECRET fallback) for secret encryption.',
      );
    }

    this.cachedMasterKey = deriveMasterKey(source);
    return this.cachedMasterKey;
  }

  private encrypt(value: string): SecretEncryptedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.resolveMasterKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  private decrypt(payload: SecretEncryptedValue): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.resolveMasterKey(),
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }

  private readVaultSecretValue(name: string): string | null {
    if (!this.db) {
      return null;
    }
    this.ensureTables();

    const row = this.db
      .prepare(
        `SELECT
          r.name,
          r.scope,
          r.source,
          r.required,
          r.rotation_window_hours,
          r.warning_window_hours,
          r.status,
          r.last_rotated_at,
          r.expires_at,
          r.revoked_at,
          r.created_at,
          r.updated_at,
          COALESCE(v.version, 0) AS version,
          v.ciphertext,
          v.iv,
          v.auth_tag
        FROM secret_vault_registry r
        LEFT JOIN secret_vault_values v ON v.secret_name = r.name
        WHERE r.name = ?`,
      )
      .get(name) as SecretPayloadRow | undefined;

    if (!row || !row.ciphertext || !row.iv || !row.auth_tag) {
      return null;
    }

    const metadata = this.toMetadata(row);
    if (metadata.status !== 'active') {
      return null;
    }

    try {
      return this.decrypt({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[SecretVault] Failed to decrypt secret '${name}': ${message}`);
      return null;
    }
  }

  private getMetadataByNameInternal(name: string, db: BetterSqlite3.Database): SecretMetadata | null {
    const row = db
      .prepare(
        `SELECT
          r.name,
          r.scope,
          r.source,
          r.required,
          r.rotation_window_hours,
          r.warning_window_hours,
          r.status,
          r.last_rotated_at,
          r.expires_at,
          r.revoked_at,
          r.created_at,
          r.updated_at,
          COALESCE(v.version, 0) AS version
        FROM secret_vault_registry r
        LEFT JOIN secret_vault_values v ON v.secret_name = r.name
        WHERE r.name = ?`,
      )
      .get(name) as SecretRegistryRow | undefined;

    if (!row) {
      return null;
    }
    return this.toMetadata(row);
  }

  private resolveStatus(row: SecretRegistryRow): SecretLifecycleStatus {
    if (row.status === 'revoked') {
      return 'revoked';
    }
    const expiresAtMs = safeParseDate(row.expires_at);
    if (expiresAtMs !== null && expiresAtMs <= this.now().getTime()) {
      return 'expired';
    }
    return 'active';
  }

  private toMetadata(row: SecretRegistryRow): SecretMetadata {
    const scope = isSecretScope(row.scope) ? row.scope : 'runtime';
    const source = isSecretSource(row.source) ? row.source : 'vault';

    return {
      name: row.name,
      scope,
      source,
      required: row.required === 1,
      rotationWindowHours: row.rotation_window_hours,
      warningWindowHours: row.warning_window_hours,
      lastRotatedAt: row.last_rotated_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      status: this.resolveStatus(row),
      version: row.version ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private collectRedactionValues(): string[] {
    const values = new Set<string>();

    for (const value of this.runtimeSecretValues.values()) {
      if (value.length >= MIN_REDACTION_VALUE_LENGTH) {
        values.add(value);
      }
    }

    const twinClawConfig = loadTwinClawJson();
    for (const [name, value] of Object.entries(twinClawConfig)) {
      if (!value) {
        continue;
      }
      if (!SENSITIVE_ENV_NAME_PATTERN.test(name)) {
        continue;
      }
      if (value.length >= MIN_REDACTION_VALUE_LENGTH) {
        values.add(value);
      }
    }

    for (const [name, value] of Object.entries(process.env)) {
      if (!value) {
        continue;
      }
      if (!SENSITIVE_ENV_NAME_PATTERN.test(name)) {
        continue;
      }
      if (value.length >= MIN_REDACTION_VALUE_LENGTH) {
        values.add(value);
      }
    }

    if (this.db) {
      this.ensureTables();
      const rows = this.db
        .prepare(`SELECT name FROM secret_vault_registry WHERE status = 'active'`)
        .all() as Array<{ name: string }>;
      for (const row of rows) {
        const value = this.readVaultSecretValue(row.name);
        if (value && value.length >= MIN_REDACTION_VALUE_LENGTH) {
          values.add(value);
        }
      }
    }

    return [...values].sort((a, b) => b.length - a.length);
  }

  private insertAuditEvent(
    db: BetterSqlite3.Database,
    secretName: string,
    action: string,
    status: 'success' | 'failure',
    detail: string,
  ): void {
    db.prepare(
      `INSERT INTO secret_vault_audit_events (
        id,
        secret_name,
        action,
        status,
        detail,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), secretName, action, status, detail, this.now().toISOString());
  }

  private insertAuditEventSafe(
    secretName: string,
    action: string,
    status: 'success' | 'failure',
    detail: string,
  ): void {
    if (!this.db) {
      return;
    }

    try {
      this.ensureTables();
      this.insertAuditEvent(this.db, secretName, action, status, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[SecretVault] Failed to persist audit event (${action}): ${message}`);
    }
  }
}

let defaultSecretVaultService: SecretVaultService | null = null;

export function getSecretVaultService(): SecretVaultService {
  if (!defaultSecretVaultService) {
    defaultSecretVaultService = new SecretVaultService();
  }
  return defaultSecretVaultService;
}

export function resetSecretVaultServiceForTests(): void {
  defaultSecretVaultService = null;
}
