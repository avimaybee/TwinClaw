import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { SkillPackageManager } from '../../src/services/skill-package-manager.js';
import type { SkillPackageCatalog } from '../../src/types/skill-packages.js';

const makeServer = (id: string) => ({
    id,
    name: `${id} server`,
    description: `${id} integration`,
    transport: 'stdio' as const,
    command: 'node',
    args: [`${id}.js`],
    enabled: true,
});

describe('SkillPackageManager', () => {
    let tempDir: string;
    let catalogPath: string;
    let lockPath: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-skill-packages-'));
        catalogPath = path.join(tempDir, 'catalog.json');
        lockPath = path.join(tempDir, 'lock.json');
        await writeFile(catalogPath, JSON.stringify({ packages: [] }, null, 2), 'utf8');
        await writeFile(
            lockPath,
            JSON.stringify(
                { version: 1, generatedAt: '1970-01-01T00:00:00.000Z', packages: {} },
                null,
                2,
            ),
            'utf8',
        );
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    const writeCatalog = async (catalog: SkillPackageCatalog) => {
        await writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    };

    const createManager = () =>
        new SkillPackageManager({
            catalogPath,
            lockPath,
            runtimeApiVersion: '1.0.0',
        });

    it('writes deterministic lockfiles and keeps reinstall idempotent', async () => {
        await writeCatalog({
            packages: [
                {
                    name: 'alpha',
                    version: '1.0.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: { beta: '^1.0.0' },
                    server: makeServer('alpha-v1'),
                },
                {
                    name: 'alpha',
                    version: '1.1.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: { beta: '^1.0.0' },
                    server: makeServer('alpha-v11'),
                },
                {
                    name: 'beta',
                    version: '1.0.0',
                    metadata: { displayName: 'beta', description: 'beta package' },
                    dependencies: {},
                    server: makeServer('beta-v1'),
                },
                {
                    name: 'beta',
                    version: '1.2.0',
                    metadata: { displayName: 'beta', description: 'beta package' },
                    dependencies: {},
                    server: makeServer('beta-v12'),
                },
            ],
        });

        const manager = createManager();
        const firstInstall = await manager.installPackage('alpha', '^1.0.0');
        const firstLock = await readFile(lockPath, 'utf8');
        const secondInstall = await manager.installPackage('alpha');
        const secondLock = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(secondLock) as {
            packages: Record<string, { version: string }>;
        };

        expect(firstInstall.version).toBe('1.1.0');
        expect(secondInstall.changed).toBe(false);
        expect(firstLock).toBe(secondLock);
        expect(Object.keys(parsed.packages)).toEqual(['alpha', 'beta']);
        expect(parsed.packages.alpha.version).toBe('1.1.0');
        expect(parsed.packages.beta.version).toBe('1.2.0');
    });

    it('detects version conflicts during resolution', async () => {
        await writeCatalog({
            packages: [
                {
                    name: 'alpha',
                    version: '1.0.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: { beta: '^1.0.0' },
                    server: makeServer('alpha'),
                },
                {
                    name: 'beta',
                    version: '1.2.0',
                    metadata: { displayName: 'beta', description: 'beta package' },
                    dependencies: {},
                    server: makeServer('beta-v12'),
                },
                {
                    name: 'beta',
                    version: '2.0.0',
                    metadata: { displayName: 'beta', description: 'beta package' },
                    dependencies: {},
                    server: makeServer('beta-v2'),
                },
                {
                    name: 'gamma',
                    version: '1.0.0',
                    metadata: { displayName: 'gamma', description: 'gamma package' },
                    dependencies: { beta: '^2.0.0' },
                    server: makeServer('gamma'),
                },
            ],
        });

        const manager = createManager();
        await manager.installPackage('alpha', '^1.0.0');

        await expect(manager.installPackage('gamma', '^1.0.0')).rejects.toThrow(
            /No compatible version found/,
        );
    });

    it('rolls back lockfile changes when upgrade compatibility checks fail', async () => {
        await writeCatalog({
            packages: [
                {
                    name: 'alpha',
                    version: '1.0.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: {},
                    server: makeServer('alpha-v1'),
                },
                {
                    name: 'alpha',
                    version: '2.0.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: {},
                    compatibility: { node: '>=99.0.0' },
                    server: makeServer('alpha-v2'),
                },
            ],
        });

        const manager = createManager();
        await manager.installPackage('alpha', '=1.0.0');
        const beforeUpgrade = await readFile(lockPath, 'utf8');

        await expect(manager.upgradePackage('alpha', '>=2.0.0')).rejects.toThrow(
            /Compatibility gate blocked activation/,
        );

        const afterUpgrade = await readFile(lockPath, 'utf8');
        expect(afterUpgrade).toBe(beforeUpgrade);
    });

    it('supports deterministic downgrades via pinned install ranges', async () => {
        await writeCatalog({
            packages: [
                {
                    name: 'alpha',
                    version: '1.0.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: {},
                    server: makeServer('alpha-v1'),
                },
                {
                    name: 'alpha',
                    version: '1.2.0',
                    metadata: { displayName: 'alpha', description: 'alpha package' },
                    dependencies: {},
                    server: makeServer('alpha-v12'),
                },
            ],
        });

        const manager = createManager();
        await manager.upgradePackage('alpha');
        const downgradeResult = await manager.installPackage('alpha', '=1.0.0');

        expect(downgradeResult.version).toBe('1.0.0');
        expect(
            downgradeResult.diagnostics.installed.find((entry) => entry.name === 'alpha')?.version,
        ).toBe('1.0.0');
    });

    it('reports diagnostics for lock entries missing from catalog', async () => {
        const ghostLock = {
            version: 1,
            generatedAt: new Date().toISOString(),
            packages: {
                ghost: {
                    name: 'ghost',
                    version: '1.0.0',
                    dependencies: {},
                    checksum: 'abc',
                    integrity: 'sha256-abc',
                    installedAt: new Date().toISOString(),
                },
            },
        };
        await writeFile(lockPath, JSON.stringify(ghostLock, null, 2), 'utf8');

        const manager = createManager();
        const diagnostics = await manager.getDiagnostics();

        expect(diagnostics.violations.some((item) => item.code === 'missing-manifest')).toBe(true);
        expect(diagnostics.blockedPackageCount).toBe(1);
    });
});

