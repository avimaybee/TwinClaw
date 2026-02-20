import WAWebJS from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { InboundMessage } from '../types/messaging.js';

const { Client, LocalAuth, MessageMedia } = WAWebJS;
type WAClient = InstanceType<typeof Client>;
type WAMessage = WAWebJS.Message;

const RATE_LIMIT_MS = 1500;

export class WhatsAppHandler {
    readonly #client: WAClient;
    readonly #allowedPhoneNumber: string;
    #lastMessageAt: number = 0;

    constructor(allowedPhoneNumber: string) {
        // Strip out common formatting characters just to be safe
        this.#allowedPhoneNumber = allowedPhoneNumber.replace(/[\s\+\-\(\)]/g, '');

        this.#client = new Client({
            authStrategy: new LocalAuth({ dataPath: './memory/whatsapp_auth' }),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            }
        });

        this.#registerListeners();
    }

    onMessage?: (message: InboundMessage) => Promise<void>;

    #isAuthorized(remoteId: string): boolean {
        // WhatsApp IDs usually look like '1234567890@c.us'
        const number = remoteId.split('@')[0];
        return number === this.#allowedPhoneNumber;
    }

    async #applyRateLimit(): Promise<void> {
        const elapsed = Date.now() - this.#lastMessageAt;
        if (elapsed < RATE_LIMIT_MS) {
            await new Promise<void>((resolve) =>
                setTimeout(resolve, RATE_LIMIT_MS - elapsed),
            );
        }
        this.#lastMessageAt = Date.now();
    }

    #registerListeners(): void {
        this.#client.on('qr', (qr: string) => {
            console.log('[WhatsAppHandler] Scan this QR code to authenticate:');
            qrcode.generate(qr, { small: true });
        });

        this.#client.on('ready', () => {
            console.log('[WhatsAppHandler] Client is ready!');
        });

        this.#client.on('message', async (msg: WAMessage) => {
            if (!this.#isAuthorized(msg.from)) {
                return;
            }

            await this.#applyRateLimit();

            const base: Omit<InboundMessage, 'audioFilePath'> = {
                platform: 'whatsapp',
                senderId: msg.from,
                chatId: msg.from,
                text: msg.body,
                rawPayload: msg,
            };

            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    // If it's audio (voice note or audio file)
                    if (media && media.mimetype.startsWith('audio/')) {
                        const tmpDir = os.tmpdir();
                        let ext = '.ogg'; // Default for voice notes
                        if (media.mimetype.includes('mp3')) ext = '.mp3';
                        else if (media.mimetype.includes('mp4')) ext = '.mp4';

                        const fileName = `wa_${randomUUID()}${ext}`;
                        const localPath = path.join(tmpDir, fileName);

                        const buffer = Buffer.from(media.data, 'base64');
                        await fs.writeFile(localPath, buffer);

                        const inbound: InboundMessage = {
                            ...base,
                            audioFilePath: localPath,
                        };
                        await this.onMessage?.(inbound);
                        return;
                    }
                } catch (err) {
                    console.error('[WhatsAppHandler] Failed to download media:', err);
                }
            }

            // Exclude empty bodies unless they were intercepted voice notes
            if (msg.body) {
                await this.onMessage?.(base as InboundMessage);
            }
        });

        this.#client.initialize().catch((err: unknown) => {
            console.error('[WhatsAppHandler] Failed to initialize client:', err);
        });
    }

    async sendText(chatId: string, text: string): Promise<void> {
        await this.#client.sendMessage(chatId, text);
    }

    async sendVoice(chatId: string, audio: Buffer): Promise<void> {
        const media = new MessageMedia('audio/wav', audio.toString('base64'), 'response.wav');
        await this.#client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    }

    stop(): void {
        this.#client.destroy().catch((err: unknown) => {
            console.error('[WhatsAppHandler] Failed to destroy client:', err);
        });
    }
}
