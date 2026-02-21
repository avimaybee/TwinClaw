import type { InboundMessage } from '../types/messaging.js';

export interface InboundDebounceOptions {
    enabled: boolean;
    debounceMs: number;
    now?: () => number;
}

interface PendingMessage {
    message: InboundMessage;
    timer: NodeJS.Timeout;
    resolvers: ((message: InboundMessage) => void)[];
    texts: string[];
}

const DEFAULT_DEBOUNCE_MS = 1500;

export class InboundDebounceService {
    readonly #enabled: boolean;
    readonly #debounceMs: number;
    readonly #now: () => number;
    readonly #pending: Map<string, PendingMessage> = new Map();

    constructor(options: Partial<InboundDebounceOptions> = {}) {
        this.#enabled = options.enabled ?? true;
        this.#debounceMs = Math.max(0, Math.floor(options.debounceMs ?? DEFAULT_DEBOUNCE_MS));
        this.#now = options.now ?? (() => Date.now());
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    get debounceMs(): number {
        return this.#debounceMs;
    }

    debounce(message: InboundMessage): Promise<InboundMessage> {
        if (!this.#enabled || this.#debounceMs <= 0) {
            return Promise.resolve(message);
        }

        const key = this.#buildKey(message);

        return new Promise((resolve) => {
            const existing = this.#pending.get(key);

            if (existing) {
                clearTimeout(existing.timer);
                if (message.text) {
                    existing.texts.push(message.text);
                }
                existing.resolvers.push(resolve);
                existing.timer = this.#scheduleFlush(key);
            } else {
                const texts = message.text ? [message.text] : [];
                const pending: PendingMessage = {
                    message,
                    timer: this.#scheduleFlush(key),
                    resolvers: [resolve],
                    texts,
                };
                this.#pending.set(key, pending);
            }
        });
    }

    flushAll(): InboundMessage[] {
        const messages: InboundMessage[] = [];
        for (const [key, pending] of this.#pending) {
            clearTimeout(pending.timer);
            const merged = this.#mergeMessages(pending);
            messages.push(merged);
            this.#pending.delete(key);
            for (const resolve of pending.resolvers) {
                resolve(merged);
            }
        }
        return messages;
    }

    clear(): void {
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
        }
        this.#pending.clear();
    }

    getPendingCount(): number {
        return this.#pending.size;
    }

    #buildKey(message: InboundMessage): string {
        return `${message.platform}:${message.chatId}`;
    }

    #scheduleFlush(key: string): NodeJS.Timeout {
        return setTimeout(() => {
            this.#flush(key);
        }, this.#debounceMs);
    }

    #flush(key: string): void {
        const pending = this.#pending.get(key);
        if (!pending) return;

        this.#pending.delete(key);
        const merged = this.#mergeMessages(pending);
        for (const resolve of pending.resolvers) {
            resolve(merged);
        }
    }

    #mergeMessages(pending: PendingMessage): InboundMessage {
        const base = pending.message;
        const texts = pending.texts.filter(Boolean);

        if (texts.length === 0) {
            return base;
        }

        if (texts.length === 1) {
            return { ...base, text: texts[0] };
        }

        const mergedText = texts.join('\n');
        return { ...base, text: mergedText };
    }
}
