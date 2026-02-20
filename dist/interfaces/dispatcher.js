import fs from 'node:fs';
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
    #telegram;
    #stt;
    #tts;
    #gateway;
    constructor(telegram, stt, tts, gateway) {
        this.#telegram = telegram;
        this.#stt = stt;
        this.#tts = tts;
        this.#gateway = gateway;
        // Wire inbound message callbacks.
        this.#telegram.onMessage = (msg) => this.#handle(msg);
    }
    // ── Core Dispatch Loop ────────────────────────────────────────────────────────
    async #handle(message) {
        try {
            const normalized = await this.#resolveAudio(message);
            const responseText = await this.#gateway.processMessage(normalized);
            await this.#dispatch(normalized, responseText);
        }
        catch (err) {
            console.error('[Dispatcher] Unhandled error processing message:', err);
        }
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
     * Route the gateway's response back to the originating platform.
     * Extend this switch for each new platform adapter added.
     */
    async #dispatch(origin, responseText) {
        switch (origin.platform) {
            case 'telegram':
                await this.#telegram.sendText(origin.chatId, responseText);
                break;
            default:
                console.warn('[Dispatcher] No adapter registered for platform:', origin.platform);
        }
    }
    /** Tear down all active interface adapters cleanly. */
    shutdown() {
        this.#telegram.stop();
    }
}
