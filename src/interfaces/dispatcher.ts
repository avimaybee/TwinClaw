import fs from 'node:fs';
import type { InboundMessage, GatewayHandler } from '../types/messaging.js';
import type { TelegramHandler } from './telegram_handler.js';
import type { WhatsAppHandler } from './whatsapp_handler.js';
import type { SttService } from '../services/stt-service.js';
import type { TtsService } from '../services/tts-service.js';
import { logThought } from '../utils/logger.js';
import type { QueueService } from '../services/queue-service.js';

/**
 * Unified Interface Dispatcher
 *
 * Connects all active interface adapters (Telegram, WhatsApp, …) to the core gateway.
 * Responsibilities:
 *   1. Register as the message callback on each adapter.
 *   2. Transcribe voice notes via the STT service before forwarding to the gateway.
 *   3. Route the normalized InboundMessage to the gateway for processing.
 *   4. Send the gateway's text response back to the originating platform
 *      with retry/backoff and delivery tracking.
 *   5. Clean up ephemeral audio files after transcription.
 *
 * Adding a new interface adapter in the future only requires registering it here.
 */
export class Dispatcher {
  readonly #telegram?: TelegramHandler;
  readonly #whatsapp?: WhatsAppHandler;
  readonly #stt: SttService;
  readonly #tts: TtsService;
  readonly #gateway: GatewayHandler;
  readonly #queue: QueueService;

  constructor(
    telegram: TelegramHandler | undefined,
    whatsapp: WhatsAppHandler | undefined,
    stt: SttService,
    tts: TtsService,
    gateway: GatewayHandler,
    queue: QueueService,
  ) {
    this.#telegram = telegram;
    this.#whatsapp = whatsapp;
    this.#stt = stt;
    this.#tts = tts;
    this.#gateway = gateway;
    this.#queue = queue;

    // Wire inbound message callbacks.
    if (this.#telegram) this.#telegram.onMessage = (msg) => this.#handle(msg);
    if (this.#whatsapp) this.#whatsapp.onMessage = (msg) => this.#handle(msg);
  }

  /** Expose the queue service for reliability and dead-letter controls. */
  get queue(): QueueService {
    return this.#queue;
  }

  // ── Core Dispatch Loop ────────────────────────────────────────────────────────

  async #handle(message: InboundMessage): Promise<void> {
    try {
      const normalized = await this.#resolveAudio(message);
      const responseText = await this.#gateway.processMessage(normalized);
      await this.#dispatch(normalized, responseText);
    } catch (err) {
      console.error('[Dispatcher] Unhandled error processing message:', err);
      await logThought(
        `[Dispatcher] Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      );
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
   * Route the gateway's response back to the originating platform
   * via the persistent delivery queue.
   */
  async #dispatch(origin: InboundMessage, responseText: string): Promise<void> {
    this.#queue.enqueue(origin.platform, origin.chatId, responseText);
  }

  /**
   * Send a proactive (agent-initiated) message to a specific platform target
   * via the persistent delivery queue.
   */
  async sendProactive(platform: string, chatId: string | number, text: string): Promise<void> {
    this.#queue.enqueue(platform, chatId, text);
  }

  /** Tear down all active interface adapters cleanly. */
  shutdown(): void {
    this.#telegram?.stop();
    this.#whatsapp?.stop();
  }
}
