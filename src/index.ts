import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import { handleOnboardCli, runOnboarding, runSetupWizard, startBasicREPL } from './core/onboarding.js';
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
import { getConfigValue, checkAndMigrateWorkspace } from './config/config-loader.js';
import { getIdentityDir, getWorkspaceSubdir } from './config/workspace.js';
import { handleSecretVaultCli } from './core/secret-vault-cli.js';
import { handlePairingCli } from './core/pairing-cli.js';
import { handleChannelsCli } from './core/channels-cli.js';
import { handleGatewayCli } from './core/gateway-cli.js';
import { handleLogsCli } from './core/logs-cli.js';
import { getDmPairingService } from './services/dm-pairing.js';
import { randomUUID } from 'node:crypto';

const secretVault = getSecretVaultService();
const pairingService = getDmPairingService();

function assertWindowsOnlyRuntime(): void {
    if (process.platform === 'win32') {
        return;
    }
    console.error(`[TwinClaw] Windows-only runtime: detected unsupported platform '${process.platform}'.`);
    process.exit(1);
}

assertWindowsOnlyRuntime();

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

if (handlePairingCli(process.argv.slice(2), pairingService)) {
    process.exit(process.exitCode ?? 0);
}

const onboardCliHandled = await handleOnboardCli(process.argv.slice(2));
if (onboardCliHandled) {
    process.exit(process.exitCode ?? 0);
}

const logsCliHandled = await handleLogsCli(process.argv.slice(2));
if (logsCliHandled) {
    if (process.argv.includes('--follow') || process.argv.includes('-f')) {
        await new Promise(() => { }); // Block event loop for watcher
    } else {
        process.exit(process.exitCode ?? 0);
    }
}

const gatewayCliHandled = await handleGatewayCli(process.argv.slice(2));
if (gatewayCliHandled) {
    process.exit(process.exitCode ?? 0);
}

const channelsCliHandled = await handleChannelsCli(process.argv.slice(2));
if (channelsCliHandled) {
    if (process.exitCode !== undefined) {
        process.exit(process.exitCode);
    }
    // Hang the main thread so async tasks (like WhatsApp login) can complete
    await new Promise(() => { });
}

if (handleUnknownCommand(process.argv.slice(2))) {
    process.exit(process.exitCode ?? 1);
}

// Check for setup mode or missing critical configuration
const isSetupMode = process.argv[2] === 'setup';
const onboardFlag = process.argv.includes('--onboard');

if (onboardFlag) {
    await runOnboarding();
    process.exit(0);
}

checkAndMigrateWorkspace();

// ── Auto-Setup Trigger (If critical config missing) ──────────────────────────

async function tryAutoSetup() {
    try {
        secretVault.assertStartupPreflight(['API_SECRET']);
    } catch (error) {
        console.log("\n[TwinClaw] Welcome! Critical configuration missing.");
        console.log("Starting the interactive setup wizard to configure your agent.\n");
        const result = await runSetupWizard();
        if (result.status !== 'success') {
            const exitCode = result.status === 'cancelled' ? 130 : 1;
            process.exit(exitCode);
        }
        console.log("\n[TwinClaw] Setup complete. Initializing Gateway...\n");
    }
}

if (!isSetupMode) {
    await tryAutoSetup();
} else {
    const result = await runSetupWizard();
    if (result.status === 'success') {
        process.exit(0);
    }
    if (result.status === 'cancelled') {
        process.exit(130);
    }
    process.exit(1);
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

fileWatcher.addTarget({
    id: 'identity',
    directory: getIdentityDir(),
    exclude: [],
});

fileWatcher.addTarget({
    id: 'memory-logs',
    directory: getWorkspaceSubdir('memory'),
    exclude: ['**/*.db', '**/*.db-journal', '**/*.sqlite', '**/*.sqlite-journal'],
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

function parseToolSelectors(rawValue: string | undefined): string[] {
    if (!rawValue) {
        return [];
    }
    return rawValue
        .split(',')
        .map((value) => value.trim())
        .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}

const runtimeBudgetGovernor = new RuntimeBudgetGovernor();
const modelRouter = new ModelRouter({ budgetGovernor: runtimeBudgetGovernor });
const gateway = new Gateway(skillRegistry, {
    policyEngine,
    router: modelRouter,
    toolPolicy: {
        allow: parseToolSelectors(getConfigValue('TOOLS_ALLOW')),
        deny: parseToolSelectors(getConfigValue('TOOLS_DENY')),
    },
});
const telegramBotToken = secretVault.readSecret('TELEGRAM_BOT_TOKEN');
const telegramUserId = getConfigValue('TELEGRAM_USER_ID')?.trim();
const whatsappPhoneNumber = secretVault.readSecret('WHATSAPP_PHONE_NUMBER') ?? getConfigValue('WHATSAPP_PHONE_NUMBER');
const groqApiKey = secretVault.readSecret('GROQ_API_KEY');

let dispatcher: Dispatcher | null = null;

if (
    telegramBotToken || whatsappPhoneNumber
) {
    if (groqApiKey) {
        let telegramHandler: TelegramHandler | undefined;
        let whatsappHandler: WhatsAppHandler | undefined;
        const telegramAllowFrom: string[] = [];
        const whatsappAllowFrom: string[] = [];

        if (telegramBotToken) {
            telegramHandler = new TelegramHandler(telegramBotToken);

            if (telegramUserId) {
                const parsedTelegramUserId = Number(telegramUserId);
                if (!Number.isInteger(parsedTelegramUserId) || parsedTelegramUserId <= 0) {
                    console.error('[TwinClaw] TELEGRAM_USER_ID must be a positive integer when provided.');
                } else {
                    telegramAllowFrom.push(String(parsedTelegramUserId));
                }
            }
        }

        if (whatsappPhoneNumber) {
            whatsappHandler = new WhatsAppHandler();
            whatsappAllowFrom.push(whatsappPhoneNumber);
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

        dispatcher = new Dispatcher(telegramHandler, whatsappHandler, sttService, ttsService, gateway, queueService, {
            pairingService,
            telegram: {
                dmPolicy: 'pairing',
                allowFrom: telegramAllowFrom,
            },
            whatsapp: {
                dmPolicy: 'pairing',
                allowFrom: whatsappAllowFrom,
            },
        });
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
import { WsHub } from './api/websocket-hub.js';
import { RuntimeEventProducer } from './api/runtime-event-producer.js';

const wsHub = new WsHub();
const runtimeEventProducer = new RuntimeEventProducer({
    hub: wsHub,
    incidentManager,
    budgetGovernor: runtimeBudgetGovernor,
    dispatcher: dispatcher ?? undefined,
    modelRouter,
});

const apiPort = Number(getConfigValue('API_PORT')) || 18789;

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
    wsHub,
});

runtimeEventProducer.start();

async function waitForStartupHealthProbe(
    port: number,
    timeoutMs: number = 30_000,
    intervalMs: number = 500,
): Promise<boolean> {
    const healthUrl = `http://localhost:${port}/health`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch(healthUrl, {
                method: 'GET',
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(2_000),
            });

            if (response.ok) {
                const body = await response.json() as { data?: { status?: string } };
                if (body.data?.status === 'ok' || body.data?.status === 'degraded') {
                    return true;
                }
            }
        } catch {
            // Server not ready yet, continue polling
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
}

void (async () => {
    const healthOk = await waitForStartupHealthProbe(apiPort);
    if (healthOk) {
        console.log('[TwinClaw] Startup health probe passed. Gateway is ready.');
        void logThought('[TwinClaw] Startup health probe passed.');
    } else {
        console.error('[TwinClaw] Startup health probe failed within timeout. Gateway may not be healthy.');
        void logThought('[TwinClaw] Startup health probe FAILED.');
    }
})();

// ── Signal Handlers ──────────────────────────────────────────────────────────

process.on('SIGINT', () => {
    heartbeat.stop();
    incidentManager.stop();
    localStateBackup.stop();
    runtimeEventProducer.stop();
    wsHub.stop();
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
    runtimeEventProducer.stop();
    wsHub.stop();
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
