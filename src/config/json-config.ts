import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TwinClawConfig {
    runtime: {
        apiPort: number;
        secretVaultRequired: string[];
        localStateSnapshotCron?: string;
        incidentPollCron?: string;
        heartbeatCron?: string;
        heartbeatMessage?: string;
    };
    models: {
        modalApiKey: string;
        openRouterApiKey: string;
        geminiApiKey: string;
    };
    messaging: {
        telegram: {
            enabled: boolean;
            botToken: string;
            userId: number | null;
        };
        whatsapp: {
            enabled: boolean;
            phoneNumber: string;
        };
        voice: {
            groqApiKey: string;
        };
    };
    storage: {
        embeddingDim: number;
    };
    integration: {
        embeddingProvider: 'openai' | 'ollama' | '';
        embeddingApiKey: string;
        openaiApiKey: string;
        embeddingApiUrl: string;
        embeddingModel: string;
        ollamaBaseUrl: string;
        ollamaEmbeddingModel: string;
    };
}

export const DEFAULT_CONFIG: TwinClawConfig = {
    runtime: {
        apiPort: 3100,
        secretVaultRequired: [],
    },
    models: {
        modalApiKey: '',
        openRouterApiKey: '',
        geminiApiKey: '',
    },
    messaging: {
        telegram: {
            enabled: false,
            botToken: '',
            userId: null,
        },
        whatsapp: {
            enabled: false,
            phoneNumber: '',
        },
        voice: {
            groqApiKey: '',
        },
    },
    storage: {
        embeddingDim: 1536,
    },
    integration: {
        embeddingProvider: '',
        embeddingApiKey: '',
        openaiApiKey: '',
        embeddingApiUrl: 'https://api.openai.com/v1/embeddings',
        embeddingModel: 'text-embedding-3-small',
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaEmbeddingModel: 'mxbai-embed-large',
    },
};

export function getConfigPath(overridePath?: string): string {
    if (overridePath) return path.resolve(overridePath);
    return process.env.TWINCLAW_CONFIG_PATH || path.join(os.homedir(), '.twinclaw', 'twinclaw.json');
}

export async function ensureConfigDir(configPath: string): Promise<void> {
    const dir = path.dirname(configPath);
    if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
    }
}

export async function readConfig(overridePath?: string): Promise<TwinClawConfig> {
    const targetPath = getConfigPath(overridePath);
    try {
        const rawData = await fs.readFile(targetPath, 'utf-8');
        const parsed = JSON.parse(rawData);
        return mergeWithDefaults(parsed);
    } catch (error: any) {
        if (error.code === 'ENOENT') return { ...DEFAULT_CONFIG };
        throw new Error(`Failed to parse config file at ${targetPath}: ${error.message}`);
    }
}

export async function writeConfig(config: TwinClawConfig, overridePath?: string): Promise<void> {
    const targetPath = getConfigPath(overridePath);
    await ensureConfigDir(targetPath);
    const tempPath = `${targetPath}.${Date.now()}.tmp`;
    try {
        const serialized = JSON.stringify(config, null, 2);
        await fs.writeFile(tempPath, serialized, { encoding: 'utf-8', mode: 0o600 });
        await fs.rename(tempPath, targetPath);
    } catch (error: any) {
        try { if (existsSync(tempPath)) await fs.unlink(tempPath); } catch (_) { }
        throw new Error(`Failed to save config to ${targetPath}: ${error.message}`);
    }
}

function mergeWithDefaults(loaded: any): TwinClawConfig {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as TwinClawConfig;
    if (!loaded) return config;

    if (loaded.runtime) config.runtime = { ...config.runtime, ...loaded.runtime };
    if (loaded.models) config.models = { ...config.models, ...loaded.models };
    if (loaded.messaging) {
        if (loaded.messaging.telegram) config.messaging.telegram = { ...config.messaging.telegram, ...loaded.messaging.telegram };
        if (loaded.messaging.whatsapp) config.messaging.whatsapp = { ...config.messaging.whatsapp, ...loaded.messaging.whatsapp };
        if (loaded.messaging.voice) config.messaging.voice = { ...config.messaging.voice, ...loaded.messaging.voice };
    }
    if (loaded.storage) config.storage = { ...config.storage, ...loaded.storage };
    if (loaded.integration) config.integration = { ...config.integration, ...loaded.integration };

    return config;
}

// ── Legacy Flat KV Adapter ──────────────────────────────────────────────────

let cachedConfig: TwinClawConfig | null = null;
const legacyWarningEmitted = new Set<string>();

export function reloadConfigSync(): void {
    const configPath = getConfigPath();
    try {
        const fsSync = require('fs');
        if (fsSync.existsSync(configPath)) {
            const content = fsSync.readFileSync(configPath, 'utf8');
            cachedConfig = mergeWithDefaults(JSON.parse(content));
            return;
        }
    } catch (error) {
        console.error(`[TwinClaw Config] Failed to parse JSON config at ${configPath}:`, error);
    }
    cachedConfig = mergeWithDefaults({});
}

/**
 * Gets a configured value either from `twinclaw.json` (mapped) or `process.env`.
 */
export function getConfigValue(key: string, sensitive: boolean = false): string | undefined {
    if (cachedConfig === null) {
        reloadConfigSync();
    }
    const config = cachedConfig!;
    let jsonValue: any = undefined;

    switch (key) {
        case 'API_PORT': jsonValue = config.runtime.apiPort; break;
        case 'SECRET_VAULT_REQUIRED': jsonValue = config.runtime.secretVaultRequired?.join(','); break;
        case 'LOCAL_STATE_SNAPSHOT_CRON': jsonValue = config.runtime.localStateSnapshotCron; break;
        case 'INCIDENT_POLL_CRON': jsonValue = config.runtime.incidentPollCron; break;
        case 'HEARTBEAT_CRON': jsonValue = config.runtime.heartbeatCron; break;
        case 'HEARTBEAT_MESSAGE': jsonValue = config.runtime.heartbeatMessage; break;

        case 'MODAL_API_KEY': jsonValue = config.models.modalApiKey; break;
        case 'OPENROUTER_API_KEY': jsonValue = config.models.openRouterApiKey; break;
        case 'GEMINI_API_KEY': jsonValue = config.models.geminiApiKey; break;

        case 'TELEGRAM_BOT_TOKEN': jsonValue = config.messaging.telegram.botToken; break;
        case 'TELEGRAM_USER_ID': jsonValue = config.messaging.telegram.userId; break;
        case 'WHATSAPP_PHONE_NUMBER': jsonValue = config.messaging.whatsapp.phoneNumber; break;
        case 'GROQ_API_KEY': jsonValue = config.messaging.voice.groqApiKey; break;

        case 'MEMORY_EMBEDDING_DIM': jsonValue = config.storage.embeddingDim; break;
        case 'EMBEDDING_PROVIDER': jsonValue = config.integration.embeddingProvider; break;
        case 'EMBEDDING_API_KEY': jsonValue = config.integration.embeddingApiKey; break;
        case 'OPENAI_API_KEY': jsonValue = config.integration.openaiApiKey; break;
        case 'EMBEDDING_API_URL': jsonValue = config.integration.embeddingApiUrl; break;
        case 'EMBEDDING_MODEL': jsonValue = config.integration.embeddingModel; break;
        case 'OLLAMA_BASE_URL': jsonValue = config.integration.ollamaBaseUrl; break;
        case 'OLLAMA_EMBEDDING_MODEL': jsonValue = config.integration.ollamaEmbeddingModel; break;
    }

    if (jsonValue !== undefined && jsonValue !== null && String(jsonValue).trim() !== '') {
        return String(jsonValue);
    }

    // Fallback to process.env
    const envValue = process.env[key];
    if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
        if (!sensitive && !isAllowedOverride(key) && !legacyWarningEmitted.has(key)) {
            console.warn(`[TwinClaw Config Migration] Deprecation Warning: Loaded configuration key '${key}' from process.env (or .env). Please re-run 'twinclaw onboard' or generate a twinclaw.json file.`);
            legacyWarningEmitted.add(key);
        }
        return String(envValue);
    }

    return undefined;
}

function isAllowedOverride(key: string): boolean {
    return [
        'TWINCLAW_CONFIG_PATH',
        'RUNTIME_BUDGET_DEFAULT_PROFILE',
        'RUNTIME_BUDGET_PREFER_LOCAL_MODEL',
        'RUNTIME_BUDGET_LOCAL_MODEL_ID',
        'API_PORT',
        'LOCAL_STATE_SNAPSHOT_CRON',
        'INCIDENT_POLL_CRON',
        'NODE_ENV',
        'SECRET_VAULT_MASTER_KEY',
        'API_SECRET',
        'MODEL_ROUTING_FALLBACK_MODE'
    ].includes(key);
}
