import fs from 'node:fs';
import { logThought } from '../utils/logger.js';
import { getDmPairingService, normalizePairingSenderId, } from '../services/dm-pairing.js';
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
        // Wire inbound message callbacks.
        if (this.#telegram)
            this.#telegram.onMessage = (msg) => this.#handle(msg);
        if (this.#whatsapp)
            this.#whatsapp.onMessage = (msg) => this.#handle(msg);
    }
    /** Expose the queue service for reliability and dead-letter controls. */
    get queue() {
        return this.#queue;
    }
    // ── Core Dispatch Loop ────────────────────────────────────────────────────────
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
     * via the persistent delivery queue.
     */
    async #dispatch(origin, responseText) {
        this.#queue.enqueue(origin.platform, origin.chatId, responseText);
    }
    /**
     * Send a proactive (agent-initiated) message to a specific platform target
     * via the persistent delivery queue.
     */
    async sendProactive(platform, chatId, text) {
        this.#queue.enqueue(platform, chatId, text);
    }
    /** Tear down all active interface adapters cleanly. */
    shutdown() {
        this.#telegram?.stop();
        this.#whatsapp?.stop();
    }
}
