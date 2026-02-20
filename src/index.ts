import { config } from 'dotenv-vault';
config();
import { runOnboarding, startBasicREPL } from './core/onboarding.js';
import { Gateway } from './core/gateway.js';
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
import { logThought } from './utils/logger.js';
import path from 'node:path';

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

const gateway = new Gateway(skillRegistry);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramUserId = process.env.TELEGRAM_USER_ID;
const whatsappPhoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
const groqApiKey = process.env.GROQ_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;

let dispatcher: Dispatcher | null = null;

if (
    (telegramBotToken && telegramUserId) || whatsappPhoneNumber
) {
    if (groqApiKey && elevenLabsApiKey && elevenLabsVoiceId) {
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
        const ttsService = new TtsService(elevenLabsApiKey, elevenLabsVoiceId);
        dispatcher = new Dispatcher(telegramHandler, whatsappHandler, sttService, ttsService, gateway);
        void logThought('[TwinClaw] Messaging dispatcher initialized.');
    } else {
        console.warn('[TwinClaw] Dispatcher requires GROQ_API_KEY, ELEVENLABS_API_KEY, and ELEVENLABS_VOICE_ID.');
    }
} else {
    console.log(
        '[TwinClaw] Messaging dispatcher not initialized (missing Telegram AND WhatsApp configs).',
    );
}

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
});

// ── Signal Handlers ──────────────────────────────────────────────────────────

process.on('SIGINT', () => {
    heartbeat.stop();
    dispatcher?.shutdown();
    void fileWatcher.stopAll();
    void mcpManager.disconnectAll();
    void logThought('TwinClaw process received SIGINT; services stopped.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    heartbeat.stop();
    dispatcher?.shutdown();
    void fileWatcher.stopAll();
    void mcpManager.disconnectAll();
    void logThought('TwinClaw process received SIGTERM; services stopped.');
    process.exit(0);
});

// ── Entry Point ──────────────────────────────────────────────────────────────

if (process.argv.includes('--onboard')) {
    runOnboarding().catch(console.error);
} else {
    startBasicREPL(gateway);
}
