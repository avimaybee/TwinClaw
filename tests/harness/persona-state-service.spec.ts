import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm, stat, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PersonaStateService, type PersonaStateFsAdapter } from '../../src/services/persona-state.js';

describe('PersonaStateService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) {
        continue;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists updates and returns noop when no documents changed', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-persona-service-'));
    tempDirs.push(tempDir);

    const service = new PersonaStateService({
      identityDir: tempDir,
      auditLogger: vi.fn(),
    });

    const initial = await service.getState();
    const update = await service.updateState({
      expectedRevision: initial.revision,
      soul: 'soul-line',
      identity: 'identity-line',
      user: 'user-line',
    });

    expect(update.diagnostics.outcome).toBe('updated');
    expect(update.diagnostics.changedDocuments).toEqual(['soul', 'identity', 'user']);
    expect(update.state.soul).toBe('soul-line');

    const noop = await service.updateState({
      expectedRevision: update.state.revision,
      soul: 'soul-line',
      identity: 'identity-line',
      user: 'user-line',
    });
    expect(noop.diagnostics.outcome).toBe('noop');
    expect(noop.diagnostics.changedDocuments).toEqual([]);
  });

  it('rolls back already-applied files when a write operation fails mid-update', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-persona-rollback-'));
    tempDirs.push(tempDir);

    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'soul.md'), 'old-soul', 'utf8');
    await writeFile(path.join(tempDir, 'identity.md'), 'old-identity', 'utf8');
    await writeFile(path.join(tempDir, 'user.md'), 'old-user', 'utf8');

    const failingFs = createFailingFsAdapter(2);
    const service = new PersonaStateService({
      identityDir: tempDir,
      fsAdapter: failingFs,
      auditLogger: vi.fn(),
    });
    const initial = await service.getState();

    await expect(
      service.updateState({
        expectedRevision: initial.revision,
        soul: 'new-soul',
        identity: 'new-identity',
        user: 'old-user',
      }),
    ).rejects.toThrow('rollback applied');

    const [soul, identity, user] = await Promise.all([
      readFile(path.join(tempDir, 'soul.md'), 'utf8'),
      readFile(path.join(tempDir, 'identity.md'), 'utf8'),
      readFile(path.join(tempDir, 'user.md'), 'utf8'),
    ]);

    expect(soul).toBe('old-soul');
    expect(identity).toBe('old-identity');
    expect(user).toBe('old-user');
  });
});

function createFailingFsAdapter(failOnRenameCall: number): PersonaStateFsAdapter {
  let renameCallCount = 0;

  return {
    access,
    copyFile,
    mkdir,
    readFile,
    rename: async (oldPath: string, newPath: string) => {
      renameCallCount += 1;
      if (renameCallCount === failOnRenameCall) {
        throw new Error('Injected rename failure');
      }
      await rename(oldPath, newPath);
    },
    rm: async (targetPath: string, options?: { force?: boolean }) => {
      await rm(targetPath, { force: options?.force ?? false });
    },
    stat: async (targetPath: string) => stat(targetPath),
    writeFile,
  };
}
