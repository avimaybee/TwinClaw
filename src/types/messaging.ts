/** Supported messaging platforms. */
export type Platform = 'telegram' | 'whatsapp';

/** A normalized inbound message from any supported platform. */
export interface InboundMessage {
  platform: Platform;
  /** The sender's user ID as a string (platform-specific). */
  senderId: string;
  /** The destination chat/channel ID used for reply routing. */
  chatId: string | number;
  /** Transcribed or raw text content of the message. */
  text?: string;
  /** Absolute path to a downloaded audio file, if the message is a voice note. */
  audioFilePath?: string;
  /** Original platform payload, kept for platform-specific extensions. */
  rawPayload: unknown;
}

/** A normalized outbound response to be sent back to the user. */
export interface OutboundMessage {
  platform: Platform;
  chatId: string | number;
  /** Plain-text response. */
  text?: string;
  /** Encoded audio buffer for a voice reply (mp3). */
  audioBuffer?: Buffer;
}

/**
 * Contract for the core gateway that processes normalized messages.
 * Implemented by the core_persona track; imported here as a dependency boundary.
 */
export interface GatewayHandler {
  processMessage(message: InboundMessage): Promise<string>;
}
