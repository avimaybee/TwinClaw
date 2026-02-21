import * as fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    getConfigPath as getWorkspaceConfigPath,
    hasLegacyConfig,
    migrateLegacyConfig,
    ensureWorkspaceDir,
} from './workspace.js';

export interface StreamingChunkingConfig {
    blockStreamingDefault: boolean;
    blockStreamingBreak: 'paragraph' | 'sentence';
    blockStreamingMinChars: number;
    blockStreamingMaxChars: number;
    blockStreamingCoalesce: boolean;
    humanDelayMs: number;
}

export interface InboundDebounceConfig {
    enabled: boolean;
    debounceMs: number;
}

export interface TwinClawConfig {
    runtime: {
        apiSecret: string;
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
        inbound: InboundDebounceConfig;
        streaming: StreamingChunkingConfig;
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
    tools: {
        allow: string[];
        deny: string[];
    };
}

export const DEFAULT_CONFIG: TwinClawConfig = {
    runtime: {
        apiSecret: '',
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
        inbound: {
            enabled: true,
            debounceMs: 1500,
        },
        streaming: {
            blockStreamingDefault: true,
            blockStreamingBreak: 'paragraph',
            blockStreamingMinChars: 50,
            blockStreamingMaxChars: 800,
            blockStreamingCoalesce: true,
            humanDelayMs: 800,
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
    tools: {
        allow: [],
        deny: [],
    },
};

export function getConfigPath(overridePath?: string): string {
    if (overridePath) return path.resolve(overridePath);
    if (process.env.TWINCLAW_CONFIG_PATH) {
        return path.resolve(process.env.TWINCLAW_CONFIG_PATH);
    }
    ensureWorkspaceDir();
    return getWorkspaceConfigPath();
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
    } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === 'ENOENT') return mergeWithDefaults({});
        throw new Error(`Failed to parse config file at ${targetPath}: ${fsError.message}`);
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
    } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        try { if (existsSync(tempPath)) await fs.unlink(tempPath); } catch (_) { }
        throw new Error(`Failed to save config to ${targetPath}: ${fsError.message}`);
    }
}

function mergeWithDefaults(loaded: unknown): TwinClawConfig {
    const loadedRecord = (typeof loaded === 'object' && loaded !== null
        ? loaded as Record<string, unknown>
        : {}) as Record<string, unknown>;
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as TwinClawConfig;
    if (!loadedRecord) return config;

    const runtime = loadedRecord.runtime as Partial<TwinClawConfig['runtime']> | undefined;
    const models = loadedRecord.models as Partial<TwinClawConfig['models']> | undefined;
    const messaging = loadedRecord.messaging as Partial<TwinClawConfig['messaging']> | undefined;
    const storage = loadedRecord.storage as Partial<TwinClawConfig['storage']> | undefined;
    const integration = loadedRecord.integration as Partial<TwinClawConfig['integration']> | undefined;
    const tools = loadedRecord.tools as Partial<TwinClawConfig['tools']> | undefined;

    if (runtime) config.runtime = { ...config.runtime, ...runtime };
    if (models) config.models = { ...config.models, ...models };
    if (messaging) {
        const telegram = messaging.telegram as Partial<TwinClawConfig['messaging']['telegram']> | undefined;
        const whatsapp = messaging.whatsapp as Partial<TwinClawConfig['messaging']['whatsapp']> | undefined;
        const voice = messaging.voice as Partial<TwinClawConfig['messaging']['voice']> | undefined;
        const inbound = messaging.inbound as Partial<TwinClawConfig['messaging']['inbound']> | undefined;
        const streaming = messaging.streaming as Partial<TwinClawConfig['messaging']['streaming']> | undefined;
        if (telegram) config.messaging.telegram = { ...config.messaging.telegram, ...telegram };
        if (whatsapp) config.messaging.whatsapp = { ...config.messaging.whatsapp, ...whatsapp };
        if (voice) config.messaging.voice = { ...config.messaging.voice, ...voice };
        if (inbound) config.messaging.inbound = { ...config.messaging.inbound, ...inbound };
        if (streaming) config.messaging.streaming = { ...config.messaging.streaming, ...streaming };
    }
    if (storage) config.storage = { ...config.storage, ...storage };
    if (integration) config.integration = { ...config.integration, ...integration };
    if (tools) {
        config.tools = {
            allow: Array.isArray(tools.allow)
                ? tools.allow.filter((value): value is string => typeof value === 'string')
                : config.tools.allow,
            deny: Array.isArray(tools.deny)
                ? tools.deny.filter((value): value is string => typeof value === 'string')
                : config.tools.deny,
        };
    }

    return config;
}

// ── Legacy Flat KV Adapter ──────────────────────────────────────────────────

let cachedConfig: TwinClawConfig | null = null;
const legacyWarningEmitted = new Set<string>();

export function clearConfigCacheForTests(): void {
    cachedConfig = null;
    legacyWarningEmitted.clear();
}

export function reloadConfigSync(): void {
    const configPath = getConfigPath();
    try {
        if (existsSync(configPath)) {
            const content = readFileSync(configPath, 'utf8');
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
    let jsonValue: unknown = undefined;

    switch (key) {
        case 'API_SECRET': jsonValue = config.runtime.apiSecret; break;
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
        case 'TOOLS_ALLOW': jsonValue = config.tools.allow?.join(','); break;
        case 'TOOLS_DENY': jsonValue = config.tools.deny?.join(','); break;

        case 'INBOUND_DEBOUNCE_ENABLED': jsonValue = config.messaging.inbound.enabled; break;
        case 'INBOUND_DEBOUNCE_MS': jsonValue = config.messaging.inbound.debounceMs; break;
        case 'BLOCK_STREAMING_DEFAULT': jsonValue = config.messaging.streaming.blockStreamingDefault; break;
        case 'BLOCK_STREAMING_BREAK': jsonValue = config.messaging.streaming.blockStreamingBreak; break;
        case 'BLOCK_STREAMING_MIN_CHARS': jsonValue = config.messaging.streaming.blockStreamingMinChars; break;
        case 'BLOCK_STREAMING_MAX_CHARS': jsonValue = config.messaging.streaming.blockStreamingMaxChars; break;
        case 'BLOCK_STREAMING_COALESCE': jsonValue = config.messaging.streaming.blockStreamingCoalesce; break;
        case 'HUMAN_DELAY_MS': jsonValue = config.messaging.streaming.humanDelayMs; break;
    }

    // 1. Process explicit environment variables that act as overrides
    if (isAllowedOverride(key) && process.env[key] !== undefined && String(process.env[key]).trim() !== '') {
        return String(process.env[key]);
    }

    // 2. Return the parsed config value (which merges twinclaw.json with defaults)
    if (jsonValue !== undefined && jsonValue !== null && String(jsonValue).trim() !== '') {
        return String(jsonValue);
    }

    // 3. Fallback to process.env for legacy non-overrides, emitting a deprecation warning
    const envValue = process.env[key];
    if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
        if (!sensitive && !legacyWarningEmitted.has(key)) {
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
        'TWINCLAW_PROFILE',
        'RUNTIME_BUDGET_DEFAULT_PROFILE',
        'RUNTIME_BUDGET_PREFER_LOCAL_MODEL',
        'RUNTIME_BUDGET_LOCAL_MODEL_ID',
        'API_PORT',
        'LOCAL_STATE_SNAPSHOT_CRON',
        'INCIDENT_POLL_CRON',
        'TOOLS_ALLOW',
        'TOOLS_DENY',
        'NODE_ENV',
        'SECRET_VAULT_MASTER_KEY',
        'API_SECRET',
        'MODEL_ROUTING_FALLBACK_MODE'
    ].includes(key);
}

// ── Workspace Migration ──────────────────────────────────────────────────────

export interface WorkspaceMigrationResult {
    migrated: boolean;
    sourcePath: string | null;
    targetPath: string | null;
    error?: string;
}

let migrationPerformed = false;

export function checkAndMigrateWorkspace(): WorkspaceMigrationResult {
    if (migrationPerformed) {
        return { migrated: false, sourcePath: null, targetPath: null };
    }
    
    migrationPerformed = true;
    
    if (hasLegacyConfig()) {
        console.log('[TwinClaw] Detected legacy ~/.twinclaw configuration. Migrating to workspace structure...');
        const result = migrateLegacyConfig();
        if (result.migrated) {
            console.log(`[TwinClaw] Successfully migrated config to ${result.targetPath}`);
        } else if (result.error) {
            console.error(`[TwinClaw] Migration failed: ${result.error}`);
        }
        return result;
    }
    
    return { migrated: false, sourcePath: null, targetPath: null };
}

export { hasLegacyConfig, migrateLegacyConfig };
