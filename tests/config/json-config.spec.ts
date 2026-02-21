import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readConfig, writeConfig, getConfigValue, DEFAULT_CONFIG, reloadConfigSync, TwinClawConfig } from '../../src/config/json-config.js';

describe('Config JSON Foundation', () => {
    const tempDir = path.join(os.tmpdir(), 'twinclaw-test-config', Date.now().toString());
    const tempConfigPath = path.join(tempDir, 'twinclaw.json');

    beforeEach(async () => {
        vi.stubEnv('TWINCLAW_CONFIG_PATH', tempConfigPath);
        if (!existsSync(tempDir)) {
            await fs.mkdir(tempDir, { recursive: true });
        }
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        if (existsSync(tempDir)) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('loads default config when file is missing', async () => {
        const config = await readConfig();
        expect(config.runtime.apiPort).toBe(3100);
        expect(config.integration.embeddingProvider).toBe('');
    });

    it('saves and reads structured config correctly', async () => {
        const customConfig: TwinClawConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        customConfig.runtime.apiPort = 9999;
        customConfig.messaging.telegram.enabled = true;
        customConfig.messaging.telegram.botToken = 'test-token';

        await writeConfig(customConfig);

        const loaded = await readConfig();
        expect(loaded.runtime.apiPort).toBe(9999);
        expect(loaded.messaging.telegram.botToken).toBe('test-token');
    });

    it('handles malformed JSON gracefully by throwing an error', async () => {
        await fs.writeFile(tempConfigPath, '{ malformed: true ', 'utf8');
        await expect(readConfig()).rejects.toThrow(/Failed to parse config file/);
    });

    it('sync maps flat getConfigValue correctly with fallbacks', () => {
        // Write structured
        const customConfig: TwinClawConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        customConfig.models.modalApiKey = 'struct-key';
        fs.writeFile(tempConfigPath, JSON.stringify(customConfig), 'utf8');

        reloadConfigSync();

        // Check mapping from JSON structure
        expect(getConfigValue('MODAL_API_KEY')).toBe('struct-key');

        // Fallback to Env for a property not in struct (or overridden)
        vi.stubEnv('OPENAI_API_KEY', 'env-key');
        expect(getConfigValue('OPENAI_API_KEY')).toBe('env-key');

        // Check fallback sets logging (could monitor console.warn if needed)
    });
});
