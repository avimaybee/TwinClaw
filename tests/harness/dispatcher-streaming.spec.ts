import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/config-loader.js', () => ({
  getConfigValue: vi.fn((key: string) => {
    const defaults: Record<string, string> = {
      BLOCK_STREAMING_DEFAULT: 'false',
      BLOCK_STREAMING_MIN_CHARS: '50',
      BLOCK_STREAMING_MAX_CHARS: '800',
      BLOCK_STREAMING_BREAK: 'paragraph',
      BLOCK_STREAMING_COALESCE: 'true',
      HUMAN_DELAY_MS: '0',
    };
    return defaults[key] ?? undefined;
  }),
}));

import { Dispatcher } from '../../src/interfaces/dispatcher.js';
import type { TelegramHandler } from '../../src/interfaces/telegram_handler.js';
import type { SttService } from '../../src/services/stt-service.js';
import type { TtsService } from '../../src/services/tts-service.js';
import type { GatewayHandler } from '../../src/types/messaging.js';
import type { QueueService } from '../../src/services/queue-service.js';

describe('Dispatcher streaming chunking integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('block streaming disabled (default)', () => {
    it('sends full response without chunking when streaming options not provided', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher();

      await dispatcher.sendProactive('telegram', 123, 'Hello world');

      expect(queueEnqueue).toHaveBeenCalledTimes(1);
      expect(queueEnqueue).toHaveBeenCalledWith('telegram', 123, 'Hello world');
    });
  });

  describe('block streaming via constructor options', () => {
    it('chunks long text by paragraph boundaries when humanDelayMs > 0', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher({
        streaming: {
          minChars: 20,
          maxChars: 100,
          breakOn: 'paragraph',
          coalesce: true,
          humanDelayMs: 10,
        },
      });

      const longText = `This is the first paragraph that contains enough characters to be a chunk.

This is the second paragraph that also contains enough characters to form another chunk.

And this is the third paragraph to complete the test.`;

      await dispatcher.sendProactive('telegram', 123, longText);

      expect(queueEnqueue).toHaveBeenCalledTimes(3);
      expect(queueEnqueue).toHaveBeenNthCalledWith(1, 'telegram', 123, expect.stringContaining('first paragraph'));
      expect(queueEnqueue).toHaveBeenNthCalledWith(2, 'telegram', 123, expect.stringContaining('second paragraph'));
      expect(queueEnqueue).toHaveBeenNthCalledWith(3, 'telegram', 123, expect.stringContaining('third paragraph'));
    });

    it('chunks long text by sentence boundaries when breakOn is sentence', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher({
        streaming: {
          minChars: 20,
          maxChars: 80,
          breakOn: 'sentence',
          coalesce: true,
          humanDelayMs: 0,
        },
      });

      const text = `This is the first sentence. This is the second sentence. This is the third sentence.`;

      await dispatcher.sendProactive('telegram', 123, text);

      expect(queueEnqueue).toHaveBeenCalled();
      const calls = queueEnqueue.mock.calls;
      expect(calls.length).toBeGreaterThan(1);
    });

    it('handles short text without chunking even with humanDelayMs set', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher({
        streaming: {
          minChars: 50,
          maxChars: 200,
          breakOn: 'paragraph',
          coalesce: true,
          humanDelayMs: 100,
        },
      });

      await dispatcher.sendProactive('telegram', 123, 'Short response');

      expect(queueEnqueue).toHaveBeenCalledTimes(1);
      expect(queueEnqueue).toHaveBeenCalledWith('telegram', 123, 'Short response');
    });

    it('ensures code fences are closed before chunking', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher({
        streaming: {
          minChars: 10,
          maxChars: 100,
          breakOn: 'paragraph',
          coalesce: false,
          humanDelayMs: 0,
        },
      });

      const text = `Here is some code:

\`\`\`
function example() {
  return "hello";
`;

      await dispatcher.sendProactive('telegram', 123, text);

      expect(queueEnqueue).toHaveBeenCalled();
      const lastCall = queueEnqueue.mock.calls[queueEnqueue.mock.calls.length - 1];
      const chunk = lastCall[2] as string;
      expect(chunk).toMatch(/```$/m);
    });

    it('coalesces tiny fragments into larger chunks when coalesce is true', async () => {
      const { dispatcher, queueEnqueue } = createDispatcher({
        streaming: {
          minChars: 30,
          maxChars: 100,
          breakOn: 'paragraph',
          coalesce: true,
          humanDelayMs: 0,
        },
      });

      const text = `A. B. C. D. E.`;

      await dispatcher.sendProactive('telegram', 123, text);

      expect(queueEnqueue).toHaveBeenCalled();
      const calls = queueEnqueue.mock.calls;
      expect(calls.length).toBeLessThan(10);
    });
  });

  describe('inbound debouncing', () => {
    it('processes messages immediately when debounce is disabled', async () => {
      const { telegram, gatewayProcess } = createDispatcher({
        debounce: { enabled: false, debounceMs: 1000 },
        streaming: { humanDelayMs: 0 },
      });

      const inbound = {
        platform: 'telegram' as const,
        senderId: '42',
        chatId: 42,
        text: 'Hello',
        rawPayload: {},
      };

      const messageHandler = (telegram as { onMessage?: (msg: unknown) => void }).onMessage;
      await messageHandler!(inbound);

      expect(gatewayProcess).toHaveBeenCalledTimes(1);
    });
  });
});

function createDispatcher(options?: {
  streaming?: {
    minChars?: number;
    maxChars?: number;
    breakOn?: 'paragraph' | 'sentence';
    coalesce?: boolean;
    humanDelayMs?: number;
  };
  debounce?: {
    enabled: boolean;
    debounceMs: number;
  };
}): {
  dispatcher: Dispatcher;
  telegram: TelegramHandler;
  queueEnqueue: ReturnType<typeof vi.fn>;
  gatewayProcess: ReturnType<typeof vi.fn>;
  debounceService: { getPendingCount: () => number };
} {
  const sendText = vi.fn<(chatId: string | number, text: string) => Promise<void>>().mockResolvedValue(undefined);
  const telegram = {
    onMessage: undefined,
    sendText,
    sendVoice: vi.fn<(chatId: number | string, audio: Buffer) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as unknown as TelegramHandler;

  const stt = {
    transcribeFile: vi.fn<(filePath: string) => Promise<string>>().mockResolvedValue('transcribed'),
  } as unknown as SttService;

  const tts = {
    synthesize: vi.fn<(text: string) => Promise<Buffer>>().mockResolvedValue(Buffer.from('voice')),
  } as unknown as TtsService;

  const gatewayProcess = vi
    .fn<(message: Parameters<GatewayHandler['processMessage']>[0]) => Promise<string>>()
    .mockResolvedValue('Gateway response');
  const gateway: GatewayHandler = {
    processMessage: gatewayProcess,
  };

  const queueEnqueue = vi.fn<(platform: string, chatId: string | number, text: string) => void>();
  const queue = {
    enqueue: queueEnqueue,
  } as unknown as QueueService;

  const dispatcher = new Dispatcher(telegram, undefined, stt, tts, gateway, queue, {
    telegram: {
      dmPolicy: 'allowlist',
      allowFrom: ['42'],
    },
    streaming: options?.streaming,
    debounce: options?.debounce,
  });

  return {
    dispatcher,
    telegram,
    queueEnqueue,
    gatewayProcess,
    debounceService: {
      getPendingCount: () => dispatcher.debounceService.getPendingCount(),
    },
  };
}
