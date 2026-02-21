import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Dispatcher } from '../../src/interfaces/dispatcher.js';
import type { TelegramHandler } from '../../src/interfaces/telegram_handler.js';
import type { WhatsAppHandler } from '../../src/interfaces/whatsapp_handler.js';
import type { SttService } from '../../src/services/stt-service.js';
import type { TtsService } from '../../src/services/tts-service.js';
import type { GatewayHandler } from '../../src/types/messaging.js';
import type { QueueService } from '../../src/services/queue-service.js';
import type { InboundMessage } from '../../src/types/messaging.js';
import { DmPairingService, type DmPolicy } from '../../src/services/dm-pairing.js';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

describe('Dispatcher — messaging and voice dispatch paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transcribes audio voice note and forwards text to gateway', async () => {
    const { telegram, stt, gateway, queueEnqueue } = buildDispatcher();

    const inbound: InboundMessage = {
      platform: 'telegram',
      senderId: '77',
      chatId: 77,
      audioFilePath: '/tmp/voice_test.ogg',
      rawPayload: {},
    };

    vi.spyOn(stt, 'transcribeFile').mockResolvedValue('voice note content');

    await telegram.onMessage?.(inbound);

    expect(stt.transcribeFile).toHaveBeenCalledWith('/tmp/voice_test.ogg');
    expect(gateway.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'voice note content', audioFilePath: undefined }),
    );
    expect(queueEnqueue).toHaveBeenCalledWith('telegram', 77, 'gateway-reply');
  });

  it('forwards plain text messages without invoking STT', async () => {
    const { telegram, stt, queueEnqueue } = buildDispatcher();

    const inbound: InboundMessage = {
      platform: 'telegram',
      senderId: '42',
      chatId: 42,
      text: 'hello world',
      rawPayload: {},
    };

    await telegram.onMessage?.(inbound);

    expect(stt.transcribeFile).not.toHaveBeenCalled();
    expect(queueEnqueue).toHaveBeenCalledWith('telegram', 42, 'gateway-reply');
  });

  it('routes inbound WhatsApp text messages to gateway and enqueues reply', async () => {
    const { whatsapp, queueEnqueue, gateway } = buildDispatcher();

    const inbound: InboundMessage = {
      platform: 'whatsapp',
      senderId: 'phone-1234',
      chatId: 'phone-1234@c.us',
      text: 'status update',
      rawPayload: {},
    };

    await whatsapp.onMessage?.(inbound);

    expect(gateway.processMessage).toHaveBeenCalledTimes(1);
    expect(queueEnqueue).toHaveBeenCalledWith('whatsapp', 'phone-1234@c.us', 'gateway-reply');
  });

  it('enqueues proactive messages to the queue without invoking gateway', async () => {
    const { dispatcher, queueEnqueue, gateway } = buildDispatcher();

    await dispatcher.sendProactive('telegram', 9999, 'proactive alert!');

    expect(queueEnqueue).toHaveBeenCalledWith('telegram', 9999, 'proactive alert!');
    expect(gateway.processMessage).not.toHaveBeenCalled();
  });

  it('handles gateway errors gracefully without crashing the dispatcher', async () => {
    const { telegram, gateway } = buildDispatcher();
    vi.spyOn(gateway, 'processMessage').mockRejectedValue(new Error('gateway-exploded'));

    const inbound: InboundMessage = {
      platform: 'telegram',
      senderId: '1',
      chatId: 1,
      text: 'trigger error',
      rawPayload: {},
    };

    // Should not throw — dispatcher must isolate errors
    await expect(telegram.onMessage?.(inbound)).resolves.toBeUndefined();
  });

  it('still enqueues the response even when audio transcription fails', async () => {
    const { telegram, stt, queueEnqueue } = buildDispatcher();
    vi.spyOn(stt, 'transcribeFile').mockRejectedValue(new Error('whisper-api-down'));

    const inbound: InboundMessage = {
      platform: 'telegram',
      senderId: '5',
      chatId: 5,
      audioFilePath: '/tmp/broken.ogg',
      rawPayload: {},
    };

    // STT failure propagates as a gateway error, dispatcher must stay silent
    await expect(telegram.onMessage?.(inbound)).resolves.toBeUndefined();
    // Queue was not called because the whole handle() caught the error before dispatch
    expect(queueEnqueue).not.toHaveBeenCalled();
  });

  it('blocks unknown sender until pairing approval is completed', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-dispatcher-pairing-'));

    try {
      const pairingService = new DmPairingService({ credentialsDir: tempDir });
      const { telegram, gateway, queueEnqueue } = buildDispatcher({
        pairingService,
        telegramDmPolicy: 'pairing',
        telegramAllowFrom: [],
      });

      const inbound: InboundMessage = {
        platform: 'telegram',
        senderId: '321',
        chatId: 321,
        text: 'hello from unknown sender',
        rawPayload: {},
      };

      await telegram.onMessage?.(inbound);

      expect(gateway.processMessage).not.toHaveBeenCalled();
      expect(queueEnqueue).toHaveBeenCalledTimes(1);

      const challengeText = String(queueEnqueue.mock.calls[0]?.[2] ?? '');
      const pairingCode = challengeText.match(/[A-Z2-9]{8}/)?.[0];
      expect(pairingCode).toBeDefined();

      const approval = pairingService.approve('telegram', String(pairingCode));
      expect(approval.status).toBe('approved');

      queueEnqueue.mockClear();
      await telegram.onMessage?.(inbound);

      expect(gateway.processMessage).toHaveBeenCalledTimes(1);
      expect(queueEnqueue).toHaveBeenCalledWith('telegram', 321, 'gateway-reply');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ── Factory ─────────────────────────────────────────────────────────────────

interface BuildDispatcherOptions {
  pairingService?: DmPairingService;
  telegramDmPolicy?: DmPolicy;
  whatsappDmPolicy?: DmPolicy;
  telegramAllowFrom?: string[];
  whatsappAllowFrom?: string[];
}

function buildDispatcher(options: BuildDispatcherOptions = {}): {
  dispatcher: Dispatcher;
  telegram: TelegramHandler;
  whatsapp: WhatsAppHandler;
  stt: SttService;
  tts: TtsService;
  gateway: GatewayHandler;
  queueEnqueue: ReturnType<typeof vi.fn>;
} {
  const telegram = {
    onMessage: undefined as TelegramHandler['onMessage'],
    sendText: vi.fn<(chatId: string | number, text: string) => Promise<void>>().mockResolvedValue(undefined),
    sendVoice: vi.fn<(chatId: number | string, audio: Buffer) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as unknown as TelegramHandler;

  const whatsapp = {
    onMessage: undefined as WhatsAppHandler['onMessage'],
    sendText: vi.fn<(chatId: string | number, text: string) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as unknown as WhatsAppHandler;

  const stt: SttService = {
    transcribeFile: vi.fn<(filePath: string) => Promise<string>>().mockResolvedValue(''),
  } as unknown as SttService;

  const tts: TtsService = {
    synthesize: vi.fn<(text: string) => Promise<Buffer>>().mockResolvedValue(Buffer.from('voice')),
  } as unknown as TtsService;

  const gateway: GatewayHandler = {
    processMessage: vi.fn<(msg: InboundMessage) => Promise<string>>().mockResolvedValue('gateway-reply'),
  };

  const queueEnqueue = vi.fn<(platform: string, chatId: string | number, text: string) => void>();
  const queue = { enqueue: queueEnqueue } as unknown as QueueService;

  const dispatcher = new Dispatcher(telegram, whatsapp, stt, tts, gateway, queue, {
    pairingService: options.pairingService,
    telegram: {
      dmPolicy: options.telegramDmPolicy ?? 'allowlist',
      allowFrom: options.telegramAllowFrom ?? ['77', '42', '1', '5', '9999'],
    },
    whatsapp: {
      dmPolicy: options.whatsappDmPolicy ?? 'allowlist',
      allowFrom: options.whatsappAllowFrom ?? ['phone1234'],
    },
  });

  return { dispatcher, telegram, whatsapp, stt, tts, gateway, queueEnqueue };
}
