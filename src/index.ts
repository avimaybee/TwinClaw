import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
    require('dotenv-vault/config');
} catch (err) {
    // dotenv-vault is optional for development
}
import { runOnboarding, runSetupWizard, startBasicREPL } from './core/onboarding.js';
import { Gateway } from './core/gateway.js';
import { handleDoctorCli, handleHelpCli, handleUnknownCommand } from './core/cli.js';
import { HeartbeatService } from './core/heartbeat.js';
import { Dispatcher } from './interfaces/dispatcher.js';
import { TelegramHandler } from './interfaces/telegram_handler.js';
import { WhatsAppHandler } from './interfaces/whatsapp_handler.js';
import { FileWatcherService } from './services/file-watcher.js';
import { ProactiveNotifier } from './services/proactive-notifier.js';
import { SkillRegistry } from './services/skill-registry.js';
import { McpServerManager } from './services/mcp-server-manager.js';
import { createBuiltinSkills } from './skills/builtin.js';
import { SttService } from './services/stt-service.js';
import { TtsService } from './services/tts-service.js';
import { QueueService } from './services/queue-service.js';
import { ModelRouter } from './services/model-router.js';
import { IncidentManager } from './services/incident-manager.js';
import { RuntimeBudgetGovernor } from './services/runtime-budget-governor.js';
import { LocalStateBackupService } from './services/local-state-backup.js';
import { logThought } from './utils/logger.js';
import { PolicyEngine } from './services/policy-engine.js';
import { savePolicyAuditLog } from './services/db.js';
import { getSecretVaultService } from './services/secret-vault.js';
import { handleSecretVaultCli } from './core/secret-vault-cli.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const secretVault = getSecretVaultService();

// ── Early one-shot CLI commands (bypass service startup) ─────────────────────

if (handleHelpCli(process.argv.slice(2))) {
    process.exit(process.exitCode ?? 0);
}

if (handleDoctorCli(process.argv.slice(2))) {
    process.exit(process.exitCode ?? 0);
}

if (handleSecretVaultCli(process.argv.slice(2), secretVault)) {
    process.exit(process.exitCode ?? 0);
}

if (handleUnknownCommand(process.argv.slice(2))) {
    process.exit(process.exitCode ?? 1);
}

// setup bypasses secret preflight so first-run configuration works
const isSetupMode = process.argv[2] === 'setup';

if (!isSetupMode) {
    try {
        const preflight = secretVault.assertStartupPreflight(['API_SECRET']);
        if (preflight.warnings.length > 0) {
            const warningSummary = preflight.warnings.join(' | ');
            console.warn(`[TwinClaw] Secret preflight warnings: ${warningSummary}`);
            void logThought(`[SecretVault] ${warningSummary}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TwinClaw] Startup blocked by secret preflight: ${message}`);
        process.exit(1);
    }
}

console.log("TwinClaw Gateway Initialized.");

// ── Heartbeat & Job Scheduler ────────────────────────────────────────────────

const heartbeat = new HeartbeatService(async (message) => {
    console.log(`\n[TwinClaw Heartbeat] ${message}\n`);
});

heartbeat.start();
void logThought('TwinClaw process started and heartbeat initialized.');

// ── File Watcher ─────────────────────────────────────────────────────────────

const fileWatcher = new FileWatcherService();

const identityDir = path.resolve('identity');
fileWatcher.addTarget({
    id: 'identity',
    directory: identityDir,
    exclude: [],
});

const memoryDir = path.resolve('memory');
fileWatcher.addTarget({
    id: 'memory-logs',
    directory: memoryDir,
    exclude: ['**/*.db', '**/*.db-journal'],
});

// ── MCP Skill Registry & Server Manager ──────────────────────────────────────

const skillRegistry = new SkillRegistry();
skillRegistry.registerMany(createBuiltinSkills());

const mcpManager = new McpServerManager(skillRegistry);

void (async () => {
    try {
        await mcpManager.loadConfig();
        await mcpManager.connectAll();

        const summary = skillRegistry.summary();
        const servers = mcpManager.listServers();
        const connectedCount = servers.filter((s) => s.state === 'connected').length;

        console.log(
            `[TwinClaw MCP] ${connectedCount}/${servers.length} servers connected | ` +
            `${summary.builtin ?? 0} builtin + ${summary.mcp ?? 0} MCP skills registered.`,
        );
        await logThought(
            `[MCP] Initialized: ${connectedCount} servers, ${summary.mcp ?? 0} MCP tools, ${summary.builtin ?? 0} builtins.`,
        );
    } catch (err) {
        console.error('[TwinClaw MCP] Initialization failed:', err);
    }
})();

// ── Gateway & Interface Dispatcher ────────────────────────────────────────────

const policyEngine = new PolicyEngine();
policyEngine.onDecision = (sessionId, decision) => {
    savePolicyAuditLog(
        randomUUID(),
        sessionId,
        decision.skillName,
        decision.action,
        decision.reason,
        decision.profileId
    );
};

const runtimeBudgetGovernor = new RuntimeBudgetGovernor();
const modelRouter = new ModelRouter({ budgetGovernor: runtimeBudgetGovernor });
const gateway = new Gateway(skillRegistry, { policyEngine, router: modelRouter });
const telegramBotToken = secretVault.readSecret('TELEGRAM_BOT_TOKEN');
const telegramUserId = process.env.TELEGRAM_USER_ID;
const whatsappPhoneNumber = secretVault.readSecret('WHATSAPP_PHONE_NUMBER') ?? process.env.WHATSAPP_PHONE_NUMBER;
const groqApiKey = secretVault.readSecret('GROQ_API_KEY');

let dispatcher: Dispatcher | null = null;

if (
    (telegramBotToken && telegramUserId) || whatsappPhoneNumber
) {
    if (groqApiKey) {
        let telegramHandler: TelegramHandler | undefined;
        let whatsappHandler: WhatsAppHandler | undefined;

        if (telegramBotToken && telegramUserId) {
            const parsedTelegramUserId = Number(telegramUserId);
            if (!Number.isInteger(parsedTelegramUserId)) {
                console.error('[TwinClaw] TELEGRAM_USER_ID must be a valid integer.');
            } else {
                telegramHandler = new TelegramHandler(telegramBotToken, parsedTelegramUserId);
            }
        }

        if (whatsappPhoneNumber) {
            whatsappHandler = new WhatsAppHandler(whatsappPhoneNumber);
        }

        const sttService = new SttService(groqApiKey);
        const ttsService = new TtsService(groqApiKey);

        // Initialize persistent delivery queue
        const queueService = new QueueService(
            async (platform, chatId, text) => {
                switch (platform) {
                    case 'telegram':
                        if (!telegramHandler) throw new Error('Telegram handler not configured');
                        await telegramHandler.sendText(Number(chatId), text);
                        break;
                    case 'whatsapp':
                        if (!whatsappHandler) throw new Error('WhatsApp handler not configured');
                        await whatsappHandler.sendText(String(chatId), text);
                        break;
                    default:
                        throw new Error(`Unsupported platform in queue: ${platform}`);
                }
            },
            heartbeat.scheduler
        );
        queueService.start();

        dispatcher = new Dispatcher(telegramHandler, whatsappHandler, sttService, ttsService, gateway, queueService);
        void logThought('[TwinClaw] Messaging dispatcher and persistent queue initialized.');
    } else {
        console.warn('[TwinClaw] Dispatcher requires GROQ_API_KEY.');
    }
} else {
    console.log(
        '[TwinClaw] Messaging dispatcher not initialized (missing Telegram AND WhatsApp configs).',
    );
}

const incidentManager = new IncidentManager({
    gateway,
    router: modelRouter,
    queue: dispatcher?.queue,
    scheduler: heartbeat.scheduler,
});
incidentManager.start();
const localStateBackup = new LocalStateBackupService({
    scheduler: heartbeat.scheduler,
});
localStateBackup.start();
void logThought('[TwinClaw] Incident self-healing manager initialized.');
void logThought('[TwinClaw] Local-state backup automation initialized.');
void logThought('[TwinClaw] Runtime budget governor initialized.');

// ── Proactive Notifier ─────────────────────────────────────────────────────

const proactiveEnabled = !!telegramUserId;

const notifier = new ProactiveNotifier(
    async (target, text) => {
        if (dispatcher) {
            await dispatcher.sendProactive(target.platform, target.chatId, text);
            await logThought(`[Proactive] Delivered message to ${target.platform}:${target.chatId}`);
            return;
        }

        console.log(`[Proactive → ${target.platform}:${target.chatId}] ${text}`);
        await logThought(
            `[Proactive] Dispatcher unavailable; message logged for ${target.platform}:${target.chatId}`,
        );
    },
    {
        platform: 'telegram',
        chatId: telegramUserId ?? 'unknown',
    },
    proactiveEnabled,
);

// Wire scheduler events to the notifier
heartbeat.scheduler.on('job:error', (event) => {
    void notifier.onSchedulerEvent(event);
});

heartbeat.scheduler.on('job:done', (event) => {
    void notifier.onSchedulerEvent(event);
});

// Wire file watcher events to the notifier
fileWatcher.onEvent((event) => {
    void notifier.onFileEvent(event);
});

// Start file watchers
void fileWatcher.startAll().catch((err) => {
    console.error('[TwinClaw] Failed to start file watchers:', err);
});

// ── Control Plane HTTP API ───────────────────────────────────────────────────

import { startApiServer } from './api/router.js';

startApiServer({
    heartbeat,
    skillRegistry,
    mcpManager,
    gateway,
    dispatcher: dispatcher ?? undefined,
    incidentManager,
    budgetGovernor: runtimeBudgetGovernor,
    localStateBackup,
    modelRouter,
});

// ── Signal Handlers ──────────────────────────────────────────────────────────

process.on('SIGINT', () => {
    heartbeat.stop();
    incidentManager.stop();
    localStateBackup.stop();
    if (dispatcher) {
        dispatcher.queue.stop();
        dispatcher.shutdown();
    }
    void fileWatcher.stopAll();
    void mcpManager.disconnectAll();
    void logThought('TwinClaw process received SIGINT; services stopped.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    heartbeat.stop();
    incidentManager.stop();
    localStateBackup.stop();
    if (dispatcher) {
        dispatcher.queue.stop();
        dispatcher.shutdown();
    }
    void fileWatcher.stopAll();
    void mcpManager.disconnectAll();
    void logThought('TwinClaw process received SIGTERM; services stopped.');
    process.exit(0);
});

// ── Entry Point ──────────────────────────────────────────────────────────────

if (isSetupMode) {
    runSetupWizard().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[TwinClaw] Setup wizard failed: ${message}`);
        process.exit(1);
    });
} else if (process.argv.includes('--onboard')) {
    runOnboarding().catch(console.error);
} else {
    startBasicREPL(gateway);
}
