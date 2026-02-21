import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dispatcher } from '../../src/interfaces/dispatcher.js';
import type { TelegramHandler } from '../../src/interfaces/telegram_handler.js';
import type { SttService } from '../../src/services/stt-service.js';
import type { TtsService } from '../../src/services/tts-service.js';
import type { GatewayHandler } from '../../src/types/messaging.js';
import type { QueueService } from '../../src/services/queue-service.js';
import type { InboundMessage } from '../../src/types/messaging.js';

describe('Dispatcher reliability integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes proactive sends through the persistent queue', async () => {
    const { dispatcher, queueEnqueue } = createDispatcher();

    await dispatcher.sendProactive('telegram', 123, 'ping');

    expect(queueEnqueue).toHaveBeenCalledWith('telegram', 123, 'ping');
  });

  it('processes inbound messages and enqueues gateway responses', async () => {
    const { dispatcher, telegram, queueEnqueue, gatewayProcess } = createDispatcher();
    const inbound: InboundMessage = {
      platform: 'telegram',
      senderId: '42',
      chatId: 42,
      text: 'status',
      rawPayload: {},
    };

    await telegram.onMessage?.(inbound);

    expect(gatewayProcess).toHaveBeenCalledTimes(1);
    expect(queueEnqueue).toHaveBeenCalledWith('telegram', 42, 'ok');
    expect(dispatcher).toBeDefined();
  });
});

function createDispatcher(): {
  dispatcher: Dispatcher;
  telegram: TelegramHandler;
  queueEnqueue: ReturnType<typeof vi.fn>;
  gatewayProcess: ReturnType<typeof vi.fn>;
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
    .mockResolvedValue('ok');
  const gateway: GatewayHandler = {
    processMessage: gatewayProcess,
  };

  const queueEnqueue = vi.fn<(platform: string, chatId: string | number, text: string) => void>();
  const queue = {
    enqueue: queueEnqueue,
  } as unknown as QueueService;

  return {
    dispatcher: new Dispatcher(telegram, undefined, stt, tts, gateway, queue, {
      telegram: {
        dmPolicy: 'allowlist',
        allowFrom: ['42'],
      },
    }),
    telegram,
    queueEnqueue,
    gatewayProcess,
  };
}
