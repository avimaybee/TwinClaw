import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

type SnapshotRow = {
  snapshot_id: string;
  trigger_type: 'manual' | 'scheduled';
  status: 'ready' | 'failed' | 'pruned';
  scopes_json: string;
  entry_count: number;
  manifest_path: string;
  checksum: string | null;
  detail: string | null;
  created_at: string;
  updated_at: string;
};

type RestoreRow = {
  id: string;
  snapshot_id: string | null;
  outcome: 'dry-run' | 'restored' | 'failed';
  dry_run: number;
  scopes_json: string;
  restored_paths_json: string;
  skipped_paths_json: string;
  validation_errors_json: string;
  rollback_applied: number;
  detail: string | null;
  created_at: string;
};

const snapshotRows = new Map<string, SnapshotRow>();
const restoreRows: RestoreRow[] = [];

type SnapshotInput = {
  snapshotId: string;
  triggerType: 'manual' | 'scheduled';
  status: 'ready' | 'failed' | 'pruned';
  scopes: string[];
  entryCount: number;
  manifestPath: string;
  checksum: string | null;
  detail?: string | null;
  createdAt?: string;
};

type RestoreInput = {
  id: string;
  snapshotId: string | null;
  outcome: 'dry-run' | 'restored' | 'failed';
  dryRun: boolean;
  scopes: string[];
  restoredPaths: string[];
  skippedPaths: string[];
  validationErrors: string[];
  rollbackApplied: boolean;
  detail?: string | null;
  createdAt?: string;
};

vi.mock('../../src/services/db.js', () => ({
  upsertLocalStateSnapshotRecord: vi.fn((input: SnapshotInput) => {
    const createdAt = input.createdAt ?? new Date().toISOString();
    snapshotRows.set(input.snapshotId, {
      snapshot_id: input.snapshotId,
      trigger_type: input.triggerType,
      status: input.status,
      scopes_json: JSON.stringify(input.scopes),
      entry_count: input.entryCount,
      manifest_path: input.manifestPath,
      checksum: input.checksum ?? null,
      detail: input.detail ?? null,
      created_at: snapshotRows.get(input.snapshotId)?.created_at ?? createdAt,
      updated_at: createdAt,
    });
  }),
  listLocalStateSnapshotRecords: vi.fn((limit = 40) =>
    [...snapshotRows.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit),
  ),
  removeLocalStateSnapshotRecords: vi.fn((snapshotIds: string[]) => {
    for (const snapshotId of snapshotIds) {
      snapshotRows.delete(snapshotId);
    }
  }),
  saveLocalStateRestoreEvent: vi.fn((input: RestoreInput) => {
    restoreRows.push({
      id: input.id,
      snapshot_id: input.snapshotId,
      outcome: input.outcome,
      dry_run: input.dryRun ? 1 : 0,
      scopes_json: JSON.stringify(input.scopes),
      restored_paths_json: JSON.stringify(input.restoredPaths),
      skipped_paths_json: JSON.stringify(input.skippedPaths),
      validation_errors_json: JSON.stringify(input.validationErrors),
      rollback_applied: input.rollbackApplied ? 1 : 0,
      detail: input.detail ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
    });
  }),
  listLocalStateRestoreEvents: vi.fn((limit = 50) =>
    [...restoreRows]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit),
  ),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn(async () => undefined),
  scrubSensitiveText: (value: string) => value,
}));

import { LocalStateBackupService } from '../../src/services/local-state-backup.js';

describe('LocalStateBackupService', () => {
  const workspaces: string[] = [];

  beforeEach(() => {
    snapshotRows.clear();
    restoreRows.splice(0, restoreRows.length);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })),
    );
  });

  it('creates deterministic snapshot manifests and prunes stale snapshots', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    let tick = 0;
    const service = new LocalStateBackupService({
      workspaceRoot: workspace,
      now: () => new Date(Date.UTC(2026, 1, 20, 16, 0, tick++)),
      retentionLimit: 2,
    });

    const snapshot1 = await service.createSnapshot({ trigger: 'manual' });
    const snapshot2 = await service.createSnapshot({ trigger: 'manual' });
    const snapshot3 = await service.createSnapshot({ trigger: 'scheduled' });

    const identityChecksum1 = snapshot1.entries.find((entry) => entry.id === 'identity-dir')?.checksum;
    const identityChecksum2 = snapshot2.entries.find((entry) => entry.id === 'identity-dir')?.checksum;

    expect(identityChecksum1).toBeTruthy();
    expect(identityChecksum1).toBe(identityChecksum2);
    expect(snapshot3.trigger).toBe('scheduled');

    const snapshotDir = path.join(workspace, '.twinclaw', 'state-backups', 'snapshots');
    const snapshotFolders = (await readdir(snapshotDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(snapshotFolders).toHaveLength(2);
    expect(snapshotFolders).toContain(snapshot2.snapshotId);
    expect(snapshotFolders).toContain(snapshot3.snapshotId);
    expect(snapshotFolders).not.toContain(snapshot1.snapshotId);
  });

  it('supports dry-run validation for scoped restore without mutating files', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new LocalStateBackupService({ workspaceRoot: workspace });
    const snapshot = await service.createSnapshot({ trigger: 'manual' });
    const identityPath = path.join(workspace, 'identity', 'identity.md');
    await writeFile(identityPath, 'identity-mutated', 'utf8');

    const result = await service.restoreSnapshot({
      snapshotId: snapshot.snapshotId,
      dryRun: true,
      scopes: ['identity'],
    });

    expect(result.status).toBe('dry-run');
    expect(result.restoredPaths).toEqual(['identity']);
    expect(await readFile(identityPath, 'utf8')).toBe('identity-mutated');
  });

  it('restores snapshot state idempotently for repeated restore calls', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new LocalStateBackupService({ workspaceRoot: workspace });
    const snapshot = await service.createSnapshot({ trigger: 'manual' });
    const identityPath = path.join(workspace, 'identity', 'identity.md');
    await writeFile(identityPath, 'identity-mutated', 'utf8');

    const firstRestore = await service.restoreSnapshot({
      snapshotId: snapshot.snapshotId,
      scopes: ['identity'],
    });
    const secondRestore = await service.restoreSnapshot({
      snapshotId: snapshot.snapshotId,
      scopes: ['identity'],
    });

    expect(firstRestore.status).toBe('restored');
    expect(secondRestore.status).toBe('restored');
    expect(await readFile(identityPath, 'utf8')).toBe('identity-baseline');
  });

  it('rolls back partial restore operations when apply phase fails', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new LocalStateBackupService({
      workspaceRoot: workspace,
      beforeRestoreApplyForTest: (entry) => {
        if (entry.id === 'mcp-config') {
          throw new Error('forced apply failure');
        }
      },
    });
    const snapshot = await service.createSnapshot({ trigger: 'manual' });
    const identityPath = path.join(workspace, 'identity', 'identity.md');
    const mcpConfigPath = path.join(workspace, 'mcp-servers.json');

    await writeFile(identityPath, 'identity-mutated', 'utf8');
    await writeFile(mcpConfigPath, '{"servers":[{"id":"mutated"}]}', 'utf8');

    const result = await service.restoreSnapshot({
      snapshotId: snapshot.snapshotId,
      scopes: ['identity', 'mcp-config'],
    });

    expect(result.status).toBe('failed');
    expect(result.rollbackApplied).toBe(true);
    expect(await readFile(identityPath, 'utf8')).toBe('identity-mutated');
    expect(await readFile(mcpConfigPath, 'utf8')).toContain('mutated');
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-local-state-'));

  await mkdir(path.join(workspace, 'identity'), { recursive: true });
  await mkdir(path.join(workspace, 'memory'), { recursive: true });

  await writeFile(path.join(workspace, 'identity', 'identity.md'), 'identity-baseline', 'utf8');
  await writeFile(path.join(workspace, 'memory', 'user.md'), 'memory-baseline', 'utf8');
  await writeFile(path.join(workspace, 'memory', 'twinclaw.db'), 'sqlite-baseline', 'utf8');
  await writeFile(path.join(workspace, 'mcp-servers.json'), '{"servers":[]}', 'utf8');
  await writeFile(path.join(workspace, 'skill-packages.json'), '{"packages":[]}', 'utf8');
  await writeFile(
    path.join(workspace, 'skill-packages.lock.json'),
    '{"version":1,"generatedAt":"1970-01-01T00:00:00.000Z","packages":{}}',
    'utf8',
  );

  return workspace;
}

