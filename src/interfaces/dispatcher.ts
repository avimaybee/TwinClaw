import fs from 'node:fs';
import type { InboundMessage, GatewayHandler } from '../types/messaging.js';
import type { TelegramHandler } from './telegram_handler.js';
import type { WhatsAppHandler } from './whatsapp_handler.js';
import type { SttService } from '../services/stt-service.js';
import type { TtsService } from '../services/tts-service.js';
import { DeliveryTracker } from '../services/delivery-tracker.js';
import { withRetry } from '../utils/retry.js';
import { logThought } from '../utils/logger.js';

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
  readonly #tracker: DeliveryTracker;

  constructor(
    telegram: TelegramHandler | undefined,
    whatsapp: WhatsAppHandler | undefined,
    stt: SttService,
    tts: TtsService,
    gateway: GatewayHandler,
  ) {
    this.#telegram = telegram;
    this.#whatsapp = whatsapp;
    this.#stt = stt;
    this.#tts = tts;
    this.#gateway = gateway;
    this.#tracker = new DeliveryTracker();

    // Wire inbound message callbacks.
    if (this.#telegram) this.#telegram.onMessage = (msg) => this.#handle(msg);
    if (this.#whatsapp) this.#whatsapp.onMessage = (msg) => this.#handle(msg);
  }

  /** Expose the delivery tracker for reliability telemetry. */
  get deliveryTracker(): DeliveryTracker {
    return this.#tracker;
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
   * with retry/backoff and delivery tracking.
   */
  async #dispatch(origin: InboundMessage, responseText: string): Promise<void> {
    const recordId = this.#tracker.createRecord(origin.platform, origin.chatId);

    const result = await withRetry(
      async () => {
        this.#tracker.recordAttemptStart(recordId);

        switch (origin.platform) {
          case 'telegram':
            await this.#telegram?.sendText(origin.chatId, responseText);
            break;
          case 'whatsapp':
            await this.#whatsapp?.sendText(String(origin.chatId), responseText);
            break;
          default:
            throw new Error(`No adapter registered for platform: ${origin.platform}`);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        backoffFactor: 2,
        label: `${origin.platform}:sendText`,
      },
    );

    if (result.ok) {
      this.#tracker.recordSuccess(recordId);
    } else {
      this.#tracker.recordFailure(recordId, result.error ?? 'unknown');
      this.#tracker.markFailed(recordId);
      console.error(
        `[Dispatcher] Failed to deliver to ${origin.platform}:${origin.chatId} after ${result.attempts} attempt(s): ${result.error}`,
      );
    }
  }

  /**
   * Send a proactive (agent-initiated) message to a specific platform target
   * with retry/backoff and delivery tracking.
   */
  async sendProactive(platform: string, chatId: string | number, text: string): Promise<void> {
    const recordId = this.#tracker.createRecord(platform, chatId);

    const result = await withRetry(
      async () => {
        this.#tracker.recordAttemptStart(recordId);

        switch (platform) {
          case 'telegram':
            await this.#telegram?.sendText(chatId, text);
            break;
          case 'whatsapp':
            await this.#whatsapp?.sendText(String(chatId), text);
            break;
          default:
            throw new Error(`No adapter registered for proactive platform: ${platform}`);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        backoffFactor: 2,
        label: `${platform}:proactive`,
      },
    );

    if (result.ok) {
      this.#tracker.recordSuccess(recordId);
    } else {
      this.#tracker.recordFailure(recordId, result.error ?? 'unknown');
      this.#tracker.markFailed(recordId);
      console.error(
        `[Dispatcher] Proactive send failed to ${platform}:${chatId} after ${result.attempts} attempt(s): ${result.error}`,
      );
    }
  }

  /** Tear down all active interface adapters cleanly. */
  shutdown(): void {
    this.#telegram?.stop();
    this.#whatsapp?.stop();
  }
}
