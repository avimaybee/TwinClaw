import WAWebJS from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = WAWebJS;

function printUsage(): void {
    console.log(`Channel commands:
  channels login whatsapp    Start interactive login for WhatsApp (QR Code)`);
}

async function runWhatsappLogin(): Promise<void> {
    console.log('[TwinClaw Channels] Starting WhatsApp login sequence...');
    console.log('Initializing secure browser environment...');

    const disableChromiumSandbox = process.env.WHATSAPP_DISABLE_CHROMIUM_SANDBOX === 'true';
    const clientConfig: WAWebJS.ClientOptions = {
        authStrategy: new LocalAuth({ dataPath: './memory/whatsapp_auth' }),
    };
    if (disableChromiumSandbox) {
        clientConfig.puppeteer = {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        };
    }
    const client = new Client(clientConfig);

    client.on('qr', (qr) => {
        console.log('\n[TwinClaw Channels] ══════════════════════════════════════════════════');
        console.log('[TwinClaw Channels] ACTION REQUIRED: SCAN TO LINK WHATSAPP');
        console.log('[TwinClaw Channels] 1. Open WhatsApp on your primary phone');
        console.log('[TwinClaw Channels] 2. Tap Menu (⋮) or Settings -> Linked Devices');
        console.log('[TwinClaw Channels] 3. Tap "Link a Device" and scan the code below:');
        qrcode.generate(qr, { small: true });
        console.log('[TwinClaw Channels] ══════════════════════════════════════════════════\n');
        console.log('Awaiting scan...');
    });

    client.on('ready', () => {
        console.log('\n[TwinClaw Channels] ✓ Login Successful!');
        console.log('[TwinClaw Channels] WhatsApp session is now explicitly linked.');
        console.log('[TwinClaw Channels] You may now close this setup screen.');
        console.log('\nNext Steps:');
        console.log('1. Run `node src/index.ts doctor` to verify channel readiness.');
        console.log('2. Ensure your number is authorized per DM Pairing Policy.');

        // Clean exit
        void client.destroy().then(() => {
            process.exit(0);
        });
    });

    client.on('authenticated', () => {
        console.log('[TwinClaw Channels] Authentication state captured. Finalizing session mapping...');
    });

    client.on('auth_failure', (msg) => {
        console.error(`\n[TwinClaw Channels] ✗ Authentication Failed: ${msg}`);
        console.error('[TwinClaw Channels] Remediation: Try deleting the ./memory/whatsapp_auth directory and run `channels login whatsapp` again.');
        process.exitCode = 1;
        void client.destroy().then(() => {
            process.exit(1);
        });
    });

    try {
        await client.initialize();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n[TwinClaw Channels] ✗ Client initialization failed: ${message}`);
        process.exitCode = 1;
    }
}

/**
 * Handle \`channels\` CLI commands.
 */
export async function handleChannelsCli(argv: string[]): Promise<boolean> {
    const topCommand = argv[0];
    if (topCommand !== 'channels') {
        return false;
    }

    const subcommand = argv[1];
    const target = argv[2];

    if (subcommand === 'login' && target === 'whatsapp') {
        // Fire and forget because runWhatsappLogin manages process.exit internally
        void runWhatsappLogin();
        return true;
    }

    printUsage();
    process.exitCode = 1;
    return true;
}
