import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

const mockFs = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    cpSync: vi.fn(),
    copyFileSync: vi.fn(),
    statSync: vi.fn(),
};

vi.mock('fs', () => mockFs);

const {
    getProfileName,
    getWorkspaceDir,
    getWorkspaceSubdir,
    getConfigPath,
    getDatabasePath,
    getIdentityDir,
    getSecretsVaultPath,
    getTranscriptsDir,
    ensureWorkspaceDir,
    ensureWorkspaceSubdirs,
    hasLegacyConfig,
    getLegacyConfigPath,
    initializeWorkspaceGitignore,
    getWorkspaceSummary,
} = await import('../../src/config/workspace.js');

describe('workspace profile isolation', () => {
    const homeDir = os.homedir();
    const twinclawHome = '.twinclaw';

    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
        mockFs.existsSync.mockReset();
        mockFs.mkdirSync.mockReset();
        mockFs.writeFileSync.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('getProfileName', () => {
        it('returns "default" when TWINCLAW_PROFILE is not set', () => {
            delete process.env.TWINCLAW_PROFILE;
            expect(getProfileName()).toBe('default');
        });

        it('returns "default" when TWINCLAW_PROFILE is empty string', () => {
            vi.stubEnv('TWINCLAW_PROFILE', '');
            expect(getProfileName()).toBe('default');
        });

        it('returns profile name when TWINCLAW_PROFILE is set', () => {
            vi.stubEnv('TWINCLAW_PROFILE', 'test');
            expect(getProfileName()).toBe('test');
        });

        it('returns profile name when TWINCLAW_PROFILE has whitespace', () => {
            vi.stubEnv('TWINCLAW_PROFILE', '  production  ');
            expect(getProfileName()).toBe('production');
        });
    });

    describe('getWorkspaceDir', () => {
        it('returns ~/.twinclaw/workspace for default profile', () => {
            delete process.env.TWINCLAW_PROFILE;
            const expected = path.join(homeDir, twinclawHome, 'workspace');
            expect(getWorkspaceDir()).toBe(expected);
        });

        it('returns ~/.twinclaw/workspace-{profile} for custom profile', () => {
            vi.stubEnv('TWINCLAW_PROFILE', 'test');
            const expected = path.join(homeDir, twinclawHome, 'workspace-test');
            expect(getWorkspaceDir()).toBe(expected);
        });

        it('sanitizes profile name with special characters', () => {
            vi.stubEnv('TWINCLAW_PROFILE', 'test@profile#123');
            const expected = path.join(homeDir, twinclawHome, 'workspace-test_profile_123');
            expect(getWorkspaceDir()).toBe(expected);
        });
    });

    describe('profile isolation', () => {
        it('default and test profiles resolve to different workspace directories', () => {
            delete process.env.TWINCLAW_PROFILE;
            const defaultDir = getWorkspaceDir();

            vi.stubEnv('TWINCLAW_PROFILE', 'test');
            const testDir = getWorkspaceDir();

            expect(defaultDir).not.toBe(testDir);
            expect(defaultDir).toContain('workspace');
            expect(testDir).toContain('workspace-test');
        });

        it('config paths are isolated per profile', () => {
            delete process.env.TWINCLAW_PROFILE;
            const defaultConfigPath = getConfigPath();

            vi.stubEnv('TWINCLAW_PROFILE', 'production');
            const prodConfigPath = getConfigPath();

            expect(defaultConfigPath).not.toBe(prodConfigPath);
            expect(defaultConfigPath).toContain('workspace');
            expect(defaultConfigPath).toContain('twinclaw.json');
            expect(prodConfigPath).toContain('workspace-production');
        });

        it('database paths are isolated per profile', () => {
            delete process.env.TWINCLAW_PROFILE;
            const defaultDbPath = getDatabasePath();

            vi.stubEnv('TWINCLAW_PROFILE', 'staging');
            const stagingDbPath = getDatabasePath();

            expect(defaultDbPath).not.toBe(stagingDbPath);
            expect(defaultDbPath).toContain('workspace');
            expect(defaultDbPath).toContain('memory');
            expect(defaultDbPath).toContain('twinclaw.db');
            expect(stagingDbPath).toContain('workspace-staging');
        });

        it('identity directories are isolated per profile', () => {
            delete process.env.TWINCLAW_PROFILE;
            const defaultIdentityDir = getIdentityDir();

            vi.stubEnv('TWINCLAW_PROFILE', 'dev');
            const devIdentityDir = getIdentityDir();

            expect(defaultIdentityDir).not.toBe(devIdentityDir);
            expect(defaultIdentityDir).toContain('workspace');
            expect(defaultIdentityDir).toContain('identity');
            expect(devIdentityDir).toContain('workspace-dev');
        });

        it('secrets vault paths are isolated per profile', () => {
            delete process.env.TWINCLAW_PROFILE;
            const defaultVaultPath = getSecretsVaultPath();

            vi.stubEnv('TWINCLAW_PROFILE', 'secure');
            const secureVaultPath = getSecretsVaultPath();

            expect(defaultVaultPath).not.toBe(secureVaultPath);
            expect(defaultVaultPath).toContain('workspace');
            expect(defaultVaultPath).toContain('secrets.sqlite');
            expect(secureVaultPath).toContain('workspace-secure');
        });
    });

    describe('getWorkspaceSubdir', () => {
        it('returns correct subdirectory path within workspace', () => {
            delete process.env.TWINCLAW_PROFILE;
            const memoryDir = getWorkspaceSubdir('memory');
            expect(memoryDir).toContain('workspace');
            expect(memoryDir).toContain('memory');
        });
    });

    describe('getTranscriptsDir', () => {
        it('returns transcripts directory within workspace', () => {
            delete process.env.TWINCLAW_PROFILE;
            const transcriptsDir = getTranscriptsDir();
            expect(transcriptsDir).toContain('workspace');
            expect(transcriptsDir).toContain('transcripts');
        });
    });

    describe('ensureWorkspaceDir', () => {
        it('creates workspace directory if it does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            ensureWorkspaceDir();
            expect(mockFs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('workspace'),
                { recursive: true }
            );
        });

        it('does not create directory if it already exists', () => {
            mockFs.existsSync.mockReturnValue(true);
            ensureWorkspaceDir();
            expect(mockFs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('ensureWorkspaceSubdirs', () => {
        it('creates all required subdirectories', () => {
            mockFs.existsSync.mockReturnValue(false);
            ensureWorkspaceSubdirs();
            
            const calls = mockFs.mkdirSync.mock.calls;
            const createdPaths = calls.map(call => call[0]);
            
            expect(createdPaths.some(p => String(p).includes('memory'))).toBe(true);
            expect(createdPaths.some(p => String(p).includes('identity'))).toBe(true);
            expect(createdPaths.some(p => String(p).includes('transcripts'))).toBe(true);
        });
    });

    describe('legacy config detection', () => {
        it('detects legacy config when flat config exists and workspace config does not', () => {
            mockFs.existsSync.mockImplementation((p: string) => {
                if (p.includes('twinclaw.json') && !p.includes('workspace')) {
                    return true;
                }
                return false;
            });

            expect(hasLegacyConfig()).toBe(true);
        });

        it('does not detect legacy when workspace config already exists', () => {
            mockFs.existsSync.mockReturnValue(true);
            expect(hasLegacyConfig()).toBe(false);
        });

        it('does not detect legacy when no config exists', () => {
            mockFs.existsSync.mockReturnValue(false);
            expect(hasLegacyConfig()).toBe(false);
        });
    });

    describe('getLegacyConfigPath', () => {
        it('returns path to legacy flat config location', () => {
            const legacyPath = getLegacyConfigPath();
            expect(legacyPath).toBe(path.join(homeDir, twinclawHome, 'twinclaw.json'));
        });
    });

    describe('initializeWorkspaceGitignore', () => {
        it('creates .gitignore if it does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            const result = initializeWorkspaceGitignore();
            expect(result).toBe(true);
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.gitignore'),
                expect.stringContaining('*.sqlite'),
                { encoding: 'utf-8' }
            );
        });

        it('does not overwrite existing .gitignore', () => {
            mockFs.existsSync.mockReturnValue(true);
            const result = initializeWorkspaceGitignore();
            expect(result).toBe(false);
            expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('getWorkspaceSummary', () => {
        it('returns complete workspace information', () => {
            mockFs.existsSync.mockReturnValue(true);
            delete process.env.TWINCLAW_PROFILE;
            
            const summary = getWorkspaceSummary();
            
            expect(summary.profileName).toBe('default');
            expect(summary.exists).toBe(true);
            expect(summary.workspaceDir).toContain('workspace');
            expect(summary.configPath).toContain('twinclaw.json');
            expect(summary.databasePath).toContain('twinclaw.db');
            expect(summary.identityDir).toContain('identity');
            expect(summary.secretsVaultPath).toContain('secrets.sqlite');
            expect(summary.transcriptsDir).toContain('transcripts');
        });
    });
});
