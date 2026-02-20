import Groq from 'groq-sdk';

/** Groq speech synthesis formats currently supported by this service. */
type SpeechResponseFormat = 'wav';

const DEFAULT_MODEL_ID = 'canopylabs/orpheus-v1-english';
const DEFAULT_VOICE = 'autumn';
const DEFAULT_FORMAT: SpeechResponseFormat = 'wav';

/**
 * Text-to-Speech service backed by the Groq Audio Speech API.
 *
 * Returns a raw WAV Buffer that can be sent directly as a Telegram voice message
 * or written to disk for further processing.
 */
export class TtsService {
  readonly #client: Groq;
  readonly #modelId: string;
  readonly #voice: string;
  readonly #outputFormat: SpeechResponseFormat;

  /**
   * @param apiKey       - Groq API key (GROQ_API_KEY).
   * @param modelId      - Model to use for synthesis; defaults to `canopylabs/orpheus-v1-english`.
   * @param voice        - Voice preset to use; defaults to `autumn`.
   * @param outputFormat - Audio encoding; defaults to `wav`.
   */
  constructor(
    apiKey: string,
    modelId: string = DEFAULT_MODEL_ID,
    voice: string = DEFAULT_VOICE,
    outputFormat: SpeechResponseFormat = DEFAULT_FORMAT,
  ) {
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
  async synthesize(text: string): Promise<Buffer> {
    const wav = await this.#client.audio.speech.create({
      model: this.#modelId,
      voice: this.#voice,
      response_format: this.#outputFormat,
      input: text,
    });

    return Buffer.from(await wav.arrayBuffer());
  }
}
