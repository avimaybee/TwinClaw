import Groq from 'groq-sdk';
import { createReadStream } from 'node:fs';

/** Groq model IDs supported for audio transcription. */
type WhisperModel = 'whisper-large-v3' | 'whisper-large-v3-turbo';

const DEFAULT_MODEL: WhisperModel = 'whisper-large-v3-turbo';

/**
 * Speech-to-Text service backed by Groq's hosted Whisper API (free tier).
 *
 * Multimodal queuing contract: transcription is fully awaited before the
 * caller receives the text, ensuring audio processing completes before any
 * downstream text handling begins.
 */
export class SttService {
  readonly #client: Groq;
  readonly #model: WhisperModel;

  /**
   * @param apiKey - Groq API key (GROQ_API_KEY).
   * @param model  - Whisper model variant; defaults to `whisper-large-v3-turbo`.
   */
  constructor(apiKey: string, model: WhisperModel = DEFAULT_MODEL) {
    this.#client = new Groq({ apiKey });
    this.#model = model;
  }

  /**
   * Transcribe a local audio file to text.
   *
   * @param filePath - Absolute path to a supported audio file
   *                   (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm).
   * @returns The transcribed text string.
   * @throws If the Groq API call fails or the file cannot be read.
   */
  async transcribeFile(filePath: string): Promise<string> {
    const audioStream = createReadStream(filePath);

    const result = await this.#client.audio.transcriptions.create({
      file: audioStream,
      model: this.#model,
      response_format: 'json',
    });

    return result.text;
  }
}
