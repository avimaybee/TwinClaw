import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_FORMAT = 'mp3_44100_128';
/**
 * Text-to-Speech service backed by the ElevenLabs API.
 *
 * Returns a raw MP3 Buffer that can be sent directly as a Telegram voice message
 * or written to disk for further processing.
 */
export class TtsService {
    #client;
    #voiceId;
    #modelId;
    #outputFormat;
    /**
     * @param apiKey       - ElevenLabs API key (ELEVENLABS_API_KEY).
     * @param voiceId      - The ElevenLabs voice ID to use (ELEVENLABS_VOICE_ID).
     * @param modelId      - Model to use for synthesis; defaults to `eleven_multilingual_v2`.
     * @param outputFormat - Audio encoding; defaults to `mp3_44100_128`.
     */
    constructor(apiKey, voiceId, modelId = DEFAULT_MODEL_ID, outputFormat = DEFAULT_FORMAT) {
        this.#client = new ElevenLabsClient({ apiKey });
        this.#voiceId = voiceId;
        this.#modelId = modelId;
        this.#outputFormat = outputFormat;
    }
    /**
     * Convert text to a synthesized MP3 audio buffer.
     *
     * @param text - The text to synthesize.
     * @returns A Buffer containing the full MP3 audio.
     * @throws If the ElevenLabs API call fails.
     */
    async synthesize(text) {
        const response = await this.#client.textToSpeech.convert(this.#voiceId, {
            text,
            modelId: this.#modelId,
            outputFormat: this.#outputFormat,
        });
        // Collect the ReadableStream<Uint8Array> into a single Buffer.
        const chunks = [];
        for await (const chunk of response) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
}
