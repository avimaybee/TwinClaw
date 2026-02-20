import { assembleContext } from './context-assembly.js';
import { ModelRouter } from '../services/model-router.js';
import { createSession, saveMessage } from '../services/db.js';
import { indexConversationTurn, retrieveMemoryContext } from '../services/semantic-memory.js';
import { Gateway } from './gateway.js';
import * as readline from 'readline';
import { logThought } from '../utils/logger.js';

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
