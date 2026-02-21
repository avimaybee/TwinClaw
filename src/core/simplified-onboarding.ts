import * as readline from 'readline';
import { randomBytes } from 'node:crypto';
import type { Message } from './types.js';
import {
  getConfigPath,
  readConfig,
  writeConfig,
  type TwinClawConfig,
} from '../config/config-loader.js';
import { initializeWorkspace, getWorkspaceDir } from '../config/workspace.js';
import { ensureIdentityFiles } from '../config/identity-bootstrap.js';
import { createSession } from '../services/db.js';
import { ModelRouter } from '../services/model-router.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

type ChannelChoice = 'terminal' | 'telegram' | 'whatsapp' | 'both';

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function promptYesNo(question: string, defaultYes: boolean = false): Promise<boolean> {
  return new Promise(async (resolve) => {
    const defaultLabel = defaultYes ? '[Y/n]' : '[y/N]';
    while (true) {
      const answer = await prompt(`${question} ${defaultLabel}: `);
      if (answer === '') return defaultYes;
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') return true;
      if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') return false;
    }
  });
}

function promptChoice<T>(question: string, options: { label: string; value: T }[]): Promise<T> {
  return new Promise(async (resolve) => {
    console.log(`\n${question}`);
    console.log('─'.repeat(50));
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt.label}`);
    });
    console.log('');

    while (true) {
      const answer = await prompt('Enter number: ');
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx].value);
        return;
      }
      console.log('Invalid choice. Please enter a number from the list.');
    }
  });
}

async function runWhatsAppQRLogin(): Promise<boolean> {
  try {
    const WAWebJS = await import('whatsapp-web.js');
    const { Client, LocalAuth } = WAWebJS;
    const qrcode = await import('qrcode-terminal');

    return new Promise((resolve) => {
      console.log('\n📱 Starting WhatsApp QR Login...\n');

      const disableChromiumSandbox = process.env.WHATSAPP_DISABLE_CHROMIUM_SANDBOX === 'true';
      const clientOptions: {
        authStrategy: InstanceType<typeof LocalAuth>;
        puppeteer: {
          headless: boolean;
          args?: string[];
        };
      } = {
        authStrategy: new LocalAuth({ dataPath: './memory/whatsapp_auth' }),
        puppeteer: {
          headless: true,
        },
      };
      if (disableChromiumSandbox) {
        clientOptions.puppeteer.args = ['--no-sandbox', '--disable-setuid-sandbox'];
      }

      const client = new Client(clientOptions);

      client.on('qr', (qr: string) => {
        console.clear();
        console.log('╔═══════════════════════════════════════════════════════════╗');
        console.log('║            📱 SCAN TO LINK WHATSAPP                     ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Tap Menu (⋮) → Linked Devices');
        console.log('  3. Tap "Link a Device" and scan this QR code:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n  Waiting for scan...\n');
      });

      client.on('ready', () => {
        console.log('\n✅ WhatsApp linked successfully!\n');
        client.destroy();
        resolve(true);
      });

      client.on('auth_failure', (msg: string) => {
        console.error(`\n❌ WhatsApp authentication failed: ${msg}`);
        resolve(false);
      });

      client.on('disconnected', () => {
        console.log('\n⚠️ WhatsApp disconnected');
      });

      client.initialize();
    });
  } catch (error) {
    console.error('Failed to initialize WhatsApp client:', error);
    return false;
  }
}

export async function runSimplifiedOnboarding(): Promise<void> {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('              🎉 Welcome to TwinClaw Setup!               ');
  console.log('═══════════════════════════════════════════════════════════\n');

  await initializeWorkspace();
  const configPath = getConfigPath();
  let config = await readConfig();

  console.log(`📁 Workspace: ${getWorkspaceDir()}\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STEP 1: Choose Your Messaging Channel');
  console.log('═══════════════════════════════════════════════════════════\n');

  const channelChoice = await promptChoice('How would you like to connect with TwinClaw?', [
    { label: 'Terminal Only (Chat directly in terminal)', value: 'terminal' as ChannelChoice },
    { label: 'Telegram', value: 'telegram' as ChannelChoice },
    { label: 'WhatsApp', value: 'whatsapp' as ChannelChoice },
    { label: 'Both Telegram & WhatsApp', value: 'both' as ChannelChoice },
  ]);

  const useTelegram = channelChoice === 'telegram' || channelChoice === 'both';
  const useWhatsApp = channelChoice === 'whatsapp' || channelChoice === 'both';

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STEP 2: Security');
  console.log('═══════════════════════════════════════════════════════════\n');

  let apiSecret = config.runtime?.apiSecret;
  if (!apiSecret) {
    const generateSecret = await promptYesNo('Generate a secure API secret automatically?', true);
    if (generateSecret) {
      apiSecret = randomBytes(24).toString('hex');
      console.log('  ✅ API secret generated!\n');
    } else {
      apiSecret = await promptSecret('Enter your API secret: ');
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STEP 3: AI Models');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('You need at least one AI model API key.');
  console.log('Free keys available at:');
  console.log('  - OpenRouter: https://openrouter.ai/keys');
  console.log('  - Google AI: https://aistudio.google.com/app/apikey');
  console.log('  - Modal: https://modal.com\n');

  let openrouterKey = await promptSecret('OpenRouter API Key: ');
  const modalKey = await promptSecret('Modal API Key (optional, press Enter to skip): ');
  let geminiKey = await promptSecret('Google Gemini API Key (optional, press Enter to skip): ');

  while (!openrouterKey && !modalKey && !geminiKey) {
    console.log('\n⚠️  You need at least one AI model API key!\n');
    openrouterKey = await promptSecret('OpenRouter API Key (required): ');
    if (!openrouterKey) {
      geminiKey = await promptSecret('Google Gemini API Key (required if no OpenRouter): ');
    }
  }

  if (useTelegram) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  STEP 4: Telegram Setup');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('To get a Telegram Bot Token:');
    console.log('  1. Open Telegram → @BotFather');
    console.log('  2. Send /newbot');
    console.log('  3. Follow instructions and copy the token\n');

    const telegramToken = await promptSecret('Telegram Bot Token: ');
    const telegramUserId = await prompt('Telegram User ID (your account): ');

    config.messaging = config.messaging || {
      telegram: { enabled: false, botToken: '', userId: null },
      whatsapp: { enabled: false, phoneNumber: '' },
      voice: { groqApiKey: '' },
      inbound: { enabled: false, debounceMs: 0 },
      streaming: {
        blockStreamingDefault: false,
        blockStreamingBreak: 'paragraph',
        blockStreamingMinChars: 100,
        blockStreamingMaxChars: 2048,
        blockStreamingCoalesce: false,
        humanDelayMs: 0,
      },
    };
    config.messaging.telegram = {
      enabled: !!telegramToken,
      botToken: telegramToken,
      userId: telegramUserId ? parseInt(telegramUserId, 10) : null,
    };
  }

  if (useWhatsApp) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  STEP 5: WhatsApp Setup');
    console.log('═══════════════════════════════════════════════════════════\n');

    const startWhatsApp = await promptYesNo('Start WhatsApp QR code login now?', true);
    if (startWhatsApp) {
      const success = await runWhatsAppQRLogin();
      if (success) {
        config.messaging = config.messaging || {
          telegram: { enabled: false, botToken: '', userId: null },
          whatsapp: { enabled: false, phoneNumber: '' },
          voice: { groqApiKey: '' },
          inbound: { enabled: false, debounceMs: 0 },
          streaming: {
            blockStreamingDefault: false,
            blockStreamingBreak: 'paragraph',
            blockStreamingMinChars: 100,
            blockStreamingMaxChars: 2048,
            blockStreamingCoalesce: false,
            humanDelayMs: 0,
          },
        };
        config.messaging.whatsapp = {
          enabled: true,
          phoneNumber: '',
        };
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STEP 6: Voice (Optional)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const groqKey = await promptSecret('Groq API Key for voice/STT (optional, press Enter to skip): ');

  config = {
    ...config,
    runtime: {
      apiSecret: apiSecret || randomBytes(24).toString('hex'),
      apiPort: config.runtime?.apiPort || 3100,
      secretVaultRequired: config.runtime?.secretVaultRequired || [],
    },
    models: {
      openRouterApiKey: openrouterKey || '',
      modalApiKey: modalKey || '',
      geminiApiKey: geminiKey || '',
    },
    messaging: config.messaging || {
      telegram: { enabled: false, botToken: '', userId: null },
      whatsapp: { enabled: false, phoneNumber: '' },
      voice: { groqApiKey: '' },
      inbound: { enabled: false, debounceMs: 0 },
      streaming: {
        blockStreamingDefault: false,
        blockStreamingBreak: 'paragraph',
        blockStreamingMinChars: 100,
        blockStreamingMaxChars: 2048,
        blockStreamingCoalesce: false,
        humanDelayMs: 0,
      },
    },
    storage: config.storage || {
      embeddingDim: 1536,
    },
    integration: config.integration || {
      embeddingProvider: 'openai',
      embeddingApiKey: '',
      openaiApiKey: '',
      embeddingApiUrl: '',
      embeddingModel: '',
      ollamaBaseUrl: '',
      ollamaEmbeddingModel: '',
    },
    tools: config.tools || {
      allow: [],
      deny: [],
    },
  };

  if (groqKey) {
    config.messaging.voice = {
      groqApiKey: groqKey,
    };
  }

  await writeConfig(config);
  await ensureIdentityFiles();

  console.clear();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    ✅ Setup Complete!                     ');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📋 Quick Commands:');
  console.log('   twinclaw start        - Start TwinClaw with all channels');
  console.log('   twinclaw chat         - Open terminal chat mode');
  console.log('   twinclaw doctor       - Run health check');
  console.log('   twinclaw channels login whatsapp - Re-link WhatsApp\n');
  console.log(`📁 Config saved to: ${configPath}\n`);
  
  const startNow = await promptYesNo('Start TwinClaw now?', true);
  if (startNow) {
    rl.close();
    console.log('\n🚀 Starting TwinClaw...\n');
  }
}

export async function runTerminalChat(): Promise<void> {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           💬 TwinClaw Terminal Chat');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Type your messages and press Enter to chat.');
  console.log('Type /quit to exit.\n');

  await initializeWorkspace();
  const config = await readConfig();

  if (!config.runtime?.apiSecret) {
    console.log('❌ TwinClaw is not configured. Run `twinclaw onboard` first.\n');
    process.exit(1);
  }

  const sessionId = 'terminal_chat';
  createSession(sessionId);

  console.log('Initializing AI...');

  while (true) {
    const input = await prompt('\nYou: ');
    
    if (input.toLowerCase() === '/quit' || input.toLowerCase() === '/exit') {
      console.log('\n👋 Goodbye!');
      break;
    }

    if (!input.trim()) continue;

    try {
      const router = new ModelRouter();
      const messages: Message[] = [
        { role: 'system', content: 'You are TwinClaw, a helpful AI assistant. Be concise and friendly.' },
        { role: 'user', content: input },
      ];
      
      const response = await router.createChatCompletion(messages, undefined, { sessionId });
      console.log(`\nTwinClaw: ${response.content || 'No response'}`);
    } catch (error) {
      console.error('Error:', error);
    }
  }
}
