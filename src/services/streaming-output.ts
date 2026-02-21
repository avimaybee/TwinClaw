import type { QueueService } from './queue-service.js';
import { EmbeddedBlockChunker, type BlockChunkerOptions } from './block-chunker.js';
import type { StreamDelta } from './model-router.js';
import type { Platform } from '../types/messaging.js';

export interface StreamingOutputOptions {
    enabled: boolean;
    humanDelayMs: number;
    chunkerOptions: Partial<BlockChunkerOptions>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

interface StreamContext {
    platform: Platform;
    chatId: string | number;
    buffer: string;
    chunks: string[];
}

const DEFAULT_HUMAN_DELAY_MS = 800;

export class StreamingOutputService {
    readonly #enabled: boolean;
    readonly #humanDelayMs: number;
    readonly #chunker: EmbeddedBlockChunker;
    readonly #queue: QueueService;
    readonly #now: () => number;
    readonly #sleep: (ms: number) => Promise<void>;
    readonly #activeStreams: Map<string, StreamContext> = new Map();

    constructor(queue: QueueService, options: Partial<StreamingOutputOptions> = {}) {
        this.#queue = queue;
        this.#enabled = options.enabled ?? true;
        this.#humanDelayMs = Math.max(0, Math.floor(options.humanDelayMs ?? DEFAULT_HUMAN_DELAY_MS));
        this.#chunker = new EmbeddedBlockChunker(options.chunkerOptions);
        this.#now = options.now ?? (() => Date.now());
        this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    startStream(streamId: string, platform: Platform, chatId: string | number): void {
        this.#activeStreams.set(streamId, {
            platform,
            chatId,
            buffer: '',
            chunks: [],
        });
    }

    handleDelta(streamId: string, delta: StreamDelta): void {
        const context = this.#activeStreams.get(streamId);
        if (!context) return;

        if (delta.type === 'text_delta' && delta.content) {
            context.buffer += delta.content;
        }
    }

    async finalizeStream(streamId: string): Promise<void> {
        const context = this.#activeStreams.get(streamId);
        if (!context) return;

        this.#activeStreams.delete(streamId);

        const fullText = context.buffer.trim();
        if (!fullText) return;

        if (!this.#enabled) {
            this.#queue.enqueue(context.platform, context.chatId, fullText);
            return;
        }

        const chunks = this.#chunker.chunk(fullText);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const closedChunk = EmbeddedBlockChunker.ensureCodeFenceClosed(chunk);

            if (i > 0 && this.#humanDelayMs > 0) {
                await this.#sleep(this.#humanDelayMs);
            }

            this.#queue.enqueue(context.platform, context.chatId, closedChunk);
        }
    }

    async streamAndDispatch(
        streamId: string,
        platform: Platform,
        chatId: string | number,
        streamFn: (onDelta: (delta: StreamDelta) => void) => Promise<void>,
    ): Promise<void> {
        this.startStream(streamId, platform, chatId);

        try {
            await streamFn((delta) => this.handleDelta(streamId, delta));
        } finally {
            await this.finalizeStream(streamId);
        }
    }

    getActiveStreamCount(): number {
        return this.#activeStreams.size;
    }

    getChunker(): EmbeddedBlockChunker {
        return this.#chunker;
    }
}
