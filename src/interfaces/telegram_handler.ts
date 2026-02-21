import TelegramBot from 'node-telegram-bot-api';
import os from 'node:os';
import path from 'node:path';
import type { InboundMessage } from '../types/messaging.js';

/** Minimum ms delay between processing successive messages (human-like pacing). */
const RATE_LIMIT_MS = 1500;

/**
 * Wraps the Telegram Bot API to provide:
 *   - Inbound message normalization for the dispatcher
 *   - Human-like rate limiting between messages
 *   - Normalized InboundMessage delivery including voice-note file paths
 */
export class TelegramHandler {
  readonly #bot: TelegramBot;
  #lastMessageAt: number = 0;

  /**
   * @param token          - Telegram Bot token from @BotFather (TELEGRAM_BOT_TOKEN).
   */
  constructor(token: string) {
    this.#bot = new TelegramBot(token, { polling: true });
    this.#registerListeners();
  }

  /** Callback invoked by the dispatcher for every authorized, normalized message. */
  onMessage?: (message: InboundMessage) => Promise<void>;

  // ── Private Helpers ──────────────────────────────────────────────────────────

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
    this.#bot.on('message', async (msg) => {
      if (!msg.from) return;

      await this.#applyRateLimit();

      const base: Omit<InboundMessage, 'audioFilePath'> = {
        platform: 'telegram',
        senderId: String(msg.from.id),
        chatId: msg.chat.id,
        text: msg.text,
        rawPayload: msg,
      };

      // Voice note: download to tmp dir, transcription happens in the dispatcher.
      if (msg.voice) {
        try {
          const tmpDir = os.tmpdir();
          const localPath = await this.#bot.downloadFile(
            msg.voice.file_id,
            tmpDir,
          );
          const inbound: InboundMessage = {
            ...base,
            audioFilePath: path.resolve(localPath),
          };
          await this.onMessage?.(inbound);
        } catch (err) {
          console.error('[TelegramHandler] Failed to download voice note:', err);
        }
        return;
      }

      await this.onMessage?.(base as InboundMessage);
    });

    this.#bot.on('polling_error', (err) => {
      console.error('[TelegramHandler] Polling error:', err.message);
    });
  }

  // ── Public Send Methods ───────────────────────────────────────────────────────

  /** Send a plain-text reply to a chat. */
  async sendText(chatId: number | string, text: string): Promise<void> {
    await this.#bot.sendMessage(Number(chatId), text);
  }

  /**
   * Send a synthesized voice reply as an audio/wav message.
   * @param audio - Raw WAV buffer produced by the TTS service.
   */
  async sendVoice(chatId: number | string, audio: Buffer): Promise<void> {
    await this.#bot.sendVoice(
      Number(chatId),
      audio,
      {},
      { contentType: 'audio/wav', filename: 'response.wav' },
    );
  }

  /** Gracefully stop the polling loop. */
  stop(): void {
    this.#bot.stopPolling();
  }
}
