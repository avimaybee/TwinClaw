import { assembleContext } from './context-assembly.js';
import { ModelRouter } from '../services/model-router.js';
import { createSession, saveMessage } from '../services/db.js';
import { indexConversationTurn, retrieveMemoryContext } from '../services/semantic-memory.js';
import { Gateway } from './gateway.js';
import * as readline from 'readline';
import { logThought } from '../utils/logger.js';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { runDoctorChecks, formatDoctorReport } from './doctor.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

export async function runOnboarding() {
    console.log("Welcome to TwinClaw Setup. I will ask you a few questions to build my persona and your preferences.");
    await logThought('Onboarding flow started.');

    const router = new ModelRouter();
    const sessionId = 'onboarding_' + Date.now();
    createSession(sessionId);

    const onboardingInstructions = 'This is the onboarding session. Ask the user 3 questions, one at a time, to establish their goals, routines, and how they want you to behave.';
    const context = await assembleContext(onboardingInstructions);

    const messages: any[] = [
        { role: 'system', content: context }
    ];

    const askModel = async () => {
        const responseMessage = await router.createChatCompletion(messages, undefined, { sessionId });
        messages.push({ role: 'assistant', content: responseMessage.content });
        saveMessage(Date.now().toString(), sessionId, 'assistant', responseMessage.content);
        await indexConversationTurn(sessionId, 'assistant', responseMessage.content);

        console.log(`\nTwinClaw: ${responseMessage.content}`);

        rl.question('\nYou: ', async (answer) => {
            const memoryContext = await retrieveMemoryContext(sessionId, answer);
            messages[0] = {
                role: 'system',
                content: await assembleContext(`${onboardingInstructions}${memoryContext ? `\n\n${memoryContext}` : ''}`),
            };
            messages.push({ role: 'user', content: answer });
            saveMessage(Date.now().toString(), sessionId, 'user', answer);
            await indexConversationTurn(sessionId, 'user', answer);
            await logThought(`Onboarding user response captured (${answer.length} chars).`);
            await askModel();
        });
    };

    await askModel();
}

export function startBasicREPL(gateway: Gateway) {
    console.log("TwinClaw basic REPL started.");
    void logThought('Basic REPL started.');
    const sessionId = 'default_repl';
    createSession(sessionId);

    rl.on('line', async (line) => {
        await logThought(`REPL input received (${line.length} chars).`);

        try {
            const responseText = await gateway.processText(sessionId, line);
            console.log(`\nTwinClaw: ${responseText}\n`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("Error generating response:", message);
        }
    });
}

// ── Setup Wizard ─────────────────────────────────────────────────────────────

/** A collected key/value pair from the setup wizard. */
export interface SetupEntry {
    name: string;
    value: string;
}

/**
 * Placeholder pattern used in .env.example values.
 * Any value matching this (or blank) is treated as unconfigured.
 */
const PLACEHOLDER_PATTERN = /^your_.+_here$/i;

/** Required keys gathered during setup, in prompt order. */
const SETUP_FIELDS: Array<{ name: string; label: string; hint: string }> = [
    {
        name: 'GROQ_API_KEY',
        label: 'Groq API Key',
        hint: 'Get one free at https://console.groq.com',
    },
    {
        name: 'TELEGRAM_BOT_TOKEN',
        label: 'Telegram Bot Token',
        hint: 'Create via @BotFather on Telegram (press Enter to skip)',
    },
    {
        name: 'TELEGRAM_USER_ID',
        label: 'Telegram User ID',
        hint: 'Find via @userinfobot on Telegram (press Enter to skip)',
    },
    {
        name: 'API_SECRET',
        label: 'API Secret',
        hint: 'Any strong random string. Generate with: openssl rand -hex 32',
    },
];

/** Read and parse an existing .env file into a key→value map. */
export async function readDotEnv(filePath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        await access(filePath);
        const content = await readFile(filePath, 'utf8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (key) map.set(key, value);
        }
    } catch {
        // File does not exist or is unreadable — start fresh
    }
    return map;
}

/**
 * Merge new entries into an existing .env map and write to disk.
 * Existing keys with real values are never overwritten (idempotent).
 */
export async function persistDotEnv(
    filePath: string,
    existing: Map<string, string>,
    updates: SetupEntry[],
): Promise<void> {
    const merged = new Map(existing);
    for (const { name, value } of updates) {
        if (value.trim().length > 0) {
            merged.set(name, value);
        }
    }

    const lines: string[] = [];
    for (const [key, value] of merged) {
        lines.push(`${key}=${value}`);
    }
    await writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

/** Return true when a value is blank or still a placeholder from .env.example. */
function isUnconfigured(value: string | undefined): boolean {
    if (!value || value.trim().length === 0) return true;
    return PLACEHOLDER_PATTERN.test(value.trim());
}

/**
 * Prompt a single question and return the trimmed answer.
 * An empty answer is returned as-is (callers decide whether to accept it).
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

/**
 * Run the guided setup wizard.
 *
 * - Reads existing .env to skip already-configured keys (idempotent).
 * - Prompts the user for each unconfigured key with a hint.
 * - Validates required inputs; re-prompts on empty answers for critical fields.
 * - Persists collected values to .env.
 * - Runs doctor checks as a preflight and surfaces actionable remediation.
 */
export async function runSetupWizard(): Promise<void> {
    const envPath = path.resolve('.env');
    const existing = await readDotEnv(envPath);

    // Also fold in current process.env so live env vars are respected
    for (const [key, value] of Object.entries(process.env)) {
        if (key && value && !existing.has(key)) {
            existing.set(key, value);
        }
    }

    console.log('\nTwinClaw Setup Wizard');
    console.log('─'.repeat(50));
    console.log('I will guide you through configuring the required integrations.');
    console.log('Press Enter to skip optional fields.\n');

    await logThought('Setup wizard started.');

    const wizardRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const collected: SetupEntry[] = [];

    try {
        for (const field of SETUP_FIELDS) {
            const current = existing.get(field.name);

            if (!isUnconfigured(current)) {
                const masked =
                    current && current.length > 8
                        ? `${current.slice(0, 4)}****`
                        : '****';
                console.log(`  ✓ ${field.label} already set (${masked}). Skipping.`);
                continue;
            }

            const isOptional = field.name === 'TELEGRAM_BOT_TOKEN' || field.name === 'TELEGRAM_USER_ID';
            const question = `  ${field.label}\n  ${field.hint}\n  ${field.name}: `;

            let value = '';
            while (true) {
                value = await prompt(wizardRl, question);
                if (value.length > 0) break;
                if (isOptional) {
                    console.log(`  Skipped.\n`);
                    break;
                }
                console.log(`  This field is required. Please enter a value.\n`);
            }

            if (value.length > 0) {
                collected.push({ name: field.name, value });
                console.log(`  ✓ ${field.label} saved.\n`);
            }
        }
    } finally {
        wizardRl.close();
    }

    if (collected.length > 0) {
        await persistDotEnv(envPath, existing, collected);
        console.log(`\nConfiguration saved to ${envPath}.`);
        await logThought(`Setup wizard persisted ${collected.length} config entries.`);
    } else {
        console.log('\nNo new configuration entries to save.');
    }

    // Doctor preflight
    console.log('\nRunning preflight checks…\n');
    const report = runDoctorChecks();
    console.log(formatDoctorReport(report));

    if (report.status === 'critical') {
        console.error('\nSetup incomplete. Fix the critical issues above and re-run: node src/index.ts setup');
        process.exitCode = 2;
    } else if (report.status === 'degraded') {
        console.warn('\nSetup finished with warnings. TwinClaw may run with limited functionality.');
    } else {
        console.log('\nSetup complete! You can now run TwinClaw.');
    }

    await logThought(`Setup wizard completed. Doctor status: ${report.status}.`);
}
