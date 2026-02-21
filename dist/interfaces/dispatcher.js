import fs from 'node:fs';
import { logThought } from '../utils/logger.js';
import { getDmPairingService, normalizePairingSenderId, } from '../services/dm-pairing.js';
import { InboundDebounceService } from '../services/inbound-debounce.js';
import { EmbeddedBlockChunker } from '../services/block-chunker.js';
import { getConfigValue } from '../config/config-loader.js';
const DEFAULT_ACCESS_CONFIG = {
    dmPolicy: 'pairing',
    allowFrom: [],
};
function buildPairingChallenge(channel, code) {
    return (`[TwinClaw] Pairing required before I can process your messages on ${channel}.\n` +
        `Run: twinclaw pairing approve ${channel} ${code}`);
}
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
    #telegram;
    #whatsapp;
    #stt;
    #tts;
    #gateway;
    #queue;
    #pairingService;
    #accessConfig;
    #debounce;
    #chunker;
    #humanDelayMs;
    constructor(telegram, whatsapp, stt, tts, gateway, queue, options = {}) {
        this.#telegram = telegram;
        this.#whatsapp = whatsapp;
        this.#stt = stt;
        this.#tts = tts;
        this.#gateway = gateway;
        this.#queue = queue;
        this.#pairingService = options.pairingService ?? getDmPairingService();
        this.#accessConfig = {
            telegram: this.#resolveAccessConfig('telegram', options.telegram),
            whatsapp: this.#resolveAccessConfig('whatsapp', options.whatsapp),
        };
        this.#debounce = new InboundDebounceService(options.debounce);
        const streamingEnabled = getConfigValue('BLOCK_STREAMING_DEFAULT') === 'true';
        if (streamingEnabled) {
            this.#chunker = new EmbeddedBlockChunker({
                minChars: Number(getConfigValue('BLOCK_STREAMING_MIN_CHARS')) || 50,
                maxChars: Number(getConfigValue('BLOCK_STREAMING_MAX_CHARS')) || 800,
                breakOn: getConfigValue('BLOCK_STREAMING_BREAK') || 'paragraph',
                coalesce: getConfigValue('BLOCK_STREAMING_COALESCE') !== 'false',
            });
            this.#humanDelayMs = Number(getConfigValue('HUMAN_DELAY_MS')) || 800;
        }
        else {
            this.#chunker = new EmbeddedBlockChunker({
                minChars: options.streaming?.minChars ?? 50,
                maxChars: options.streaming?.maxChars ?? 800,
                breakOn: options.streaming?.breakOn ?? 'paragraph',
                coalesce: options.streaming?.coalesce ?? true,
            });
            this.#humanDelayMs = options.streaming?.humanDelayMs ?? 0;
        }
        // Wire inbound message callbacks through debounce layer.
        if (this.#telegram)
            this.#telegram.onMessage = (msg) => this.#handleDebounced(msg);
        if (this.#whatsapp)
            this.#whatsapp.onMessage = (msg) => this.#handleDebounced(msg);
    }
    /** Expose the queue service for reliability and dead-letter controls. */
    get queue() {
        return this.#queue;
    }
    get debounceService() {
        return this.#debounce;
    }
    // ── Core Dispatch Loop ────────────────────────────────────────────────────────
    async #handleDebounced(message) {
        try {
            const debounced = await this.#debounce.debounce(message);
            await this.#handle(debounced);
        }
        catch (err) {
            console.error('[Dispatcher] Unhandled error in debounce handling:', err);
            await logThought(`[Dispatcher] Debounce error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async #handle(message) {
        try {
            const access = this.#authorizeSender(message);
            if (!access.allowed) {
                if (access.challengeText) {
                    this.#queue.enqueue(message.platform, message.chatId, access.challengeText);
                }
                return;
            }
            const normalized = await this.#resolveAudio(message);
            const responseText = await this.#gateway.processMessage(normalized);
            await this.#dispatch(normalized, responseText);
        }
        catch (err) {
            console.error('[Dispatcher] Unhandled error processing message:', err);
            await logThought(`[Dispatcher] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    #resolveAccessConfig(channel, config) {
        const dmPolicy = config?.dmPolicy === 'allowlist' ? 'allowlist' : 'pairing';
        const allowFrom = [...new Set((config?.allowFrom ?? DEFAULT_ACCESS_CONFIG.allowFrom)
                .map((senderId) => normalizePairingSenderId(channel, senderId))
                .filter((senderId) => senderId.length > 0))];
        this.#pairingService.seedAllowFrom(channel, allowFrom);
        return { dmPolicy, allowFrom };
    }
    #authorizeSender(message) {
        const channel = message.platform;
        const normalizedSenderId = normalizePairingSenderId(channel, message.senderId);
        if (!normalizedSenderId) {
            return { allowed: false };
        }
        const config = this.#accessConfig[message.platform];
        const allowlist = new Set(config.allowFrom);
        if (allowlist.has(normalizedSenderId) || this.#pairingService.isApproved(channel, normalizedSenderId)) {
            return { allowed: true };
        }
        if (config.dmPolicy !== 'pairing') {
            return { allowed: false };
        }
        const request = this.#pairingService.requestPairing(channel, normalizedSenderId);
        if (request.status === 'created' && request.request) {
            return {
                allowed: false,
                challengeText: buildPairingChallenge(channel, request.request.code),
            };
        }
        return { allowed: false };
    }
    /**
     * If the message contains an audio file, transcribe it and substitute the
     * result as `text`. The temp file is deleted after transcription regardless
     * of the outcome (best-effort cleanup).
     */
    async #resolveAudio(message) {
        if (!message.audioFilePath)
            return message;
        const filePath = message.audioFilePath;
        let transcribedText;
        try {
            transcribedText = await this.#stt.transcribeFile(filePath);
        }
        finally {
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
     * via the persistent delivery queue. Chunks text if block streaming is enabled.
     */
    async #dispatch(origin, responseText) {
        const safeText = EmbeddedBlockChunker.ensureCodeFenceClosed(responseText);
        const chunks = this.#chunker.chunk(safeText);
        if (chunks.length <= 1) {
            this.#queue.enqueue(origin.platform, origin.chatId, responseText);
            return;
        }
        for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            const chunk = chunks[i];
            this.#queue.enqueue(origin.platform, origin.chatId, chunk);
            if (!isLast && this.#humanDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.#humanDelayMs));
            }
        }
    }
    /**
     * Send a proactive (agent-initiated) message to a specific platform target
     * via the persistent delivery queue. Uses chunking if enabled.
     */
    async sendProactive(platform, chatId, text) {
        const safeText = EmbeddedBlockChunker.ensureCodeFenceClosed(text);
        const chunks = this.#chunker.chunk(safeText);
        if (chunks.length <= 1) {
            this.#queue.enqueue(platform, chatId, text);
            return;
        }
        for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            const chunk = chunks[i];
            this.#queue.enqueue(platform, chatId, chunk);
            if (!isLast && this.#humanDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.#humanDelayMs));
            }
        }
    }
    /** Tear down all active interface adapters cleanly. */
    shutdown() {
        this.#debounce.clear();
        this.#telegram?.stop();
        this.#whatsapp?.stop();
    }
}
