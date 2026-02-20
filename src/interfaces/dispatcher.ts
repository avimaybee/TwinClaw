import fs from 'node:fs';
import type { InboundMessage, GatewayHandler } from '../types/messaging.js';
import type { TelegramHandler } from './telegram_handler.js';
import type { SttService } from '../services/stt-service.js';
import type { TtsService } from '../services/tts-service.js';

/**
 * Unified Interface Dispatcher
 *
 * Connects all active interface adapters (Telegram, …) to the core gateway.
 * Responsibilities:
 *   1. Register as the message callback on each adapter.
 *   2. Transcribe voice notes via the STT service before forwarding to the gateway.
 *   3. Route the normalized InboundMessage to the gateway for processing.
 *   4. Send the gateway's text response back to the originating platform.
 *   5. Clean up ephemeral audio files after transcription.
 *
 * Adding a new interface adapter in the future only requires registering it here.
 */
export class Dispatcher {
  readonly #telegram: TelegramHandler;
  readonly #stt: SttService;
  readonly #tts: TtsService;
  readonly #gateway: GatewayHandler;

  constructor(
    telegram: TelegramHandler,
    stt: SttService,
    tts: TtsService,
    gateway: GatewayHandler,
  ) {
    this.#telegram = telegram;
    this.#stt = stt;
    this.#tts = tts;
    this.#gateway = gateway;

    // Wire inbound message callbacks.
    this.#telegram.onMessage = (msg) => this.#handle(msg);
  }

  // ── Core Dispatch Loop ────────────────────────────────────────────────────────

  async #handle(message: InboundMessage): Promise<void> {
    try {
      const normalized = await this.#resolveAudio(message);
      const responseText = await this.#gateway.processMessage(normalized);
      await this.#dispatch(normalized, responseText);
    } catch (err) {
      console.error('[Dispatcher] Unhandled error processing message:', err);
    }
  }

  /**
   * If the message contains an audio file, transcribe it and substitute the
   * result as `text`. The temp file is deleted after transcription regardless
   * of the outcome (best-effort cleanup).
   */
  async #resolveAudio(message: InboundMessage): Promise<InboundMessage> {
    if (!message.audioFilePath) return message;

    const filePath = message.audioFilePath;
    let transcribedText: string | undefined;

    try {
      transcribedText = await this.#stt.transcribeFile(filePath);
    } finally {
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.warn('[Dispatcher] Could not delete temp audio file:', unlinkErr.message);
        }
      });
    }

    return { ...message, audioFilePath: undefined, text: transcribedText };
  }

  /**
   * Route the gateway's response back to the originating platform.
   * Extend this switch for each new platform adapter added.
   */
  async #dispatch(origin: InboundMessage, responseText: string): Promise<void> {
    switch (origin.platform) {
      case 'telegram':
        await this.#telegram.sendText(origin.chatId, responseText);
        break;
      default:
        console.warn('[Dispatcher] No adapter registered for platform:', origin.platform);
    }
  }

  /**
   * Send a proactive (agent-initiated) message to a specific platform target.
   * Used by the ProactiveNotifier for outbound alerts that aren't in response to
   * an inbound user message.
   */
  async sendProactive(platform: string, chatId: string | number, text: string): Promise<void> {
    switch (platform) {
      case 'telegram':
        await this.#telegram.sendText(chatId, text);
        break;
      default:
        console.warn('[Dispatcher] No adapter registered for proactive platform:', platform);
    }
  }

  /** Tear down all active interface adapters cleanly. */
  shutdown(): void {
    this.#telegram.stop();
  }
}
