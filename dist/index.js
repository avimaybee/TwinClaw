import { config } from 'dotenv-vault';
config();
import { runOnboarding, startBasicREPL } from './core/onboarding.js';
import { HeartbeatService } from './core/heartbeat.js';
import { logThought } from './utils/logger.js';
console.log("TwinClaw Gateway Initialized.");
const heartbeat = new HeartbeatService(async (message) => {
    console.log(`\n[TwinClaw Heartbeat] ${message}\n`);
});
heartbeat.start();
void logThought('TwinClaw process started and heartbeat initialized.');
process.on('SIGINT', () => {
    heartbeat.stop();
    void logThought('TwinClaw process received SIGINT; heartbeat stopped.');
    process.exit(0);
});
process.on('SIGTERM', () => {
    heartbeat.stop();
    void logThought('TwinClaw process received SIGTERM; heartbeat stopped.');
    process.exit(0);
});
if (process.argv.includes('--tui')) {
    import('./interfaces/tui-dashboard.js').then(({ startTUI }) => {
        startTUI();
    }).catch(err => {
        console.error("Failed to start TUI:", err);
    });
}
else if (process.argv.includes('--onboard')) {
    runOnboarding().catch(console.error);
}
else {
    startBasicREPL();
}
