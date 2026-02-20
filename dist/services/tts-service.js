import Groq from 'groq-sdk';
const DEFAULT_MODEL_ID = 'canopylabs/orpheus-v1-english';
const DEFAULT_VOICE = 'autumn';
const DEFAULT_FORMAT = 'wav';
/**
 * Text-to-Speech service backed by the Groq Audio Speech API.
 *
 * Returns a raw WAV Buffer that can be sent directly as a Telegram voice message
 * or written to disk for further processing.
 */
export class TtsService {
    #client;
    #modelId;
    #voice;
    #outputFormat;
    /**
     * @param apiKey       - Groq API key (GROQ_API_KEY).
     * @param modelId      - Model to use for synthesis; defaults to `canopylabs/orpheus-v1-english`.
     * @param voice        - Voice preset to use; defaults to `autumn`.
     * @param outputFormat - Audio encoding; defaults to `wav`.
     */
    constructor(apiKey, modelId = DEFAULT_MODEL_ID, voice = DEFAULT_VOICE, outputFormat = DEFAULT_FORMAT) {
        this.#client = new Groq({ apiKey });
        this.#modelId = modelId;
        this.#voice = voice;
        this.#outputFormat = outputFormat;
    }
    /**
     * Convert text to a synthesized WAV audio buffer.
     *
     * @param text - The text to synthesize.
     * @returns A Buffer containing the full WAV audio.
     * @throws If the Groq API call fails.
     */
    async synthesize(text) {
        const wav = await this.#client.audio.speech.create({
            model: this.#modelId,
            voice: this.#voice,
            response_format: this.#outputFormat,
            input: text,
        });
        return Buffer.from(await wav.arrayBuffer());
    }
}
