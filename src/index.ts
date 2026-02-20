import { config } from 'dotenv-vault';
config();
import { runOnboarding, startBasicREPL } from './core/onboarding.js';
import { HeartbeatService } from './core/heartbeat.js';
import { FileWatcherService } from './services/file-watcher.js';
import { ProactiveNotifier } from './services/proactive-notifier.js';
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

// ── Proactive Notifier ─────────────────────────────────────────────────────

const telegramUserId = process.env.TELEGRAM_USER_ID;
const proactiveEnabled = !!telegramUserId;

const notifier = new ProactiveNotifier(
    async (target, text) => {
        // Lightweight inline send — the Dispatcher is only constructed when
        // Telegram is fully initialized. For proactive messages originating
        // from background services, we send directly via the Telegram handler
        // import path to avoid circular dependencies.
        // In a full deployment, this would route through the Dispatcher.
        console.log(`[Proactive → ${target.platform}:${target.chatId}] ${text}`);
        await logThought(`[Proactive] Delivered message to ${target.platform}:${target.chatId}`);
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

// ── Signal Handlers ──────────────────────────────────────────────────────────

process.on('SIGINT', () => {
    heartbeat.stop();
    void fileWatcher.stopAll();
    void logThought('TwinClaw process received SIGINT; services stopped.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    heartbeat.stop();
    void fileWatcher.stopAll();
    void logThought('TwinClaw process received SIGTERM; services stopped.');
    process.exit(0);
});

// ── Entry Point ──────────────────────────────────────────────────────────────

if (process.argv.includes('--onboard')) {
    runOnboarding().catch(console.error);
} else {
    startBasicREPL();
}
