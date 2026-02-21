import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InboundDebounceService } from '../../src/services/inbound-debounce.js';
import { InboundMessage } from '../../src/types/messaging.js';

describe('InboundDebounceService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const createMessage = (text: string, chatId: string = 'chat1'): InboundMessage => ({
        platform: 'telegram',
        senderId: 'user1',
        chatId,
        text,
        rawPayload: {},
    });

    it('should debounce a single message', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });
        const message = createMessage('hello');

        const promise = service.debounce(message);

        vi.advanceTimersByTime(500);
        // Should still be pending - but checking if it's resolved is tricky with async
        // We'll just advance to the end and check result
        vi.advanceTimersByTime(500);
        const result = await promise;
        expect(result.text).toBe('hello');
    });

    it('should resolve ALL promises when merging messages', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });

        const p1 = service.debounce(createMessage('one'));
        vi.advanceTimersByTime(500);
        const p2 = service.debounce(createMessage('two'));
        vi.advanceTimersByTime(500);
        const p3 = service.debounce(createMessage('three'));

        vi.advanceTimersByTime(1000);

        const results = await Promise.all([p1, p2, p3]);

        expect(results[0].text).toBe('one\ntwo\nthree');
        expect(results[1].text).toBe('one\ntwo\nthree');
        expect(results[2].text).toBe('one\ntwo\nthree');
    });

    it('should resolve promises when flushAll is called', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });

        const p1 = service.debounce(createMessage('m1', 'c1'));
        const p2 = service.debounce(createMessage('m2', 'c2'));

        const flushed = service.flushAll();
        expect(flushed).toHaveLength(2);

        const r1 = await p1;
        const r2 = await p2;
        expect(r1.text).toBe('m1');
        expect(r2.text).toBe('m2');
    });

    it('should handle multiple chats independently', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });

        const p1 = service.debounce(createMessage('chat1-msg1', 'chat1'));
        vi.advanceTimersByTime(500);
        const p2 = service.debounce(createMessage('chat2-msg1', 'chat2'));

        vi.advanceTimersByTime(500);
        const r1 = await p1;
        expect(r1.text).toBe('chat1-msg1');

        vi.advanceTimersByTime(500);
        const r2 = await p2;
        expect(r2.text).toBe('chat2-msg1');
    });

    it('should resolve immediately if disabled', async () => {
        const service = new InboundDebounceService({ enabled: false });
        const message = createMessage('hello');
        const result = await service.debounce(message);
        expect(result).toBe(message);
    });

    it('should resolve immediately if debounceMs is 0', async () => {
        const service = new InboundDebounceService({ debounceMs: 0 });
        const message = createMessage('hello');
        const result = await service.debounce(message);
        expect(result).toBe(message);
    });

    it('should clear pending messages', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });

        service.debounce(createMessage('m1', 'c1'));
        expect(service.getPendingCount()).toBe(1);

        service.clear();
        expect(service.getPendingCount()).toBe(0);
    });

    it('should handle messages without text (e.g. voice only)', async () => {
        const service = new InboundDebounceService({ debounceMs: 1000 });
        const msg: InboundMessage = {
            platform: 'telegram',
            senderId: 'u1',
            chatId: 'c1',
            audioFilePath: '/tmp/voice.ogg',
            rawPayload: {},
        };

        const p = service.debounce(msg);
        vi.advanceTimersByTime(1000);
        const result = await p;
        expect(result.audioFilePath).toBe('/tmp/voice.ogg');
        expect(result.text).toBeUndefined();
    });
});
