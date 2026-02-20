import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueService } from '../../src/services/queue-service.js';
import * as db from '../../src/services/db.js';
import { JobScheduler } from '../../src/services/job-scheduler.js';

// Mock DB helpers
vi.mock('../../src/services/db.js', () => ({
    enqueueDelivery: vi.fn(),
    dequeueDeliveries: vi.fn(),
    updateDeliveryState: vi.fn(),
    updateDeliveryAttempts: vi.fn(),
    recordDeliveryAttemptStart: vi.fn(),
    recordDeliveryAttemptEnd: vi.fn(),
    getDeliveryStateCounts: vi.fn().mockReturnValue({ sent: 0, failed: 0, dead_letter: 0, queued: 0, dispatching: 0 }),
    getDeliveryMetrics: vi.fn(),
    getDeadLetters: vi.fn(),
    getDelivery: vi.fn(),
}));

describe('QueueService', () => {
    let scheduler: JobScheduler;
    let dispatchFn: any;
    let queue: QueueService;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new JobScheduler();
        dispatchFn = vi.fn().mockResolvedValue(undefined);
        queue = new QueueService(dispatchFn, scheduler, {
            maxAttempts: 2,
            baseDelayMs: 10,
            backoffFactor: 2,
        });
    });

    it('should enqueue a delivery and record it in the DB', () => {
        const id = queue.enqueue('telegram', '12345', 'hello');
        expect(id).toBeDefined();
        expect(db.enqueueDelivery).toHaveBeenCalledWith(id, 'telegram', '12345', 'hello');
    });

    it('should process a job successfully', async () => {
        const job = { id: 'job1', platform: 'telegram', chat_id: '12345', text_payload: 'hello', attempts: 1 };
        vi.mocked(db.dequeueDeliveries).mockReturnValue([job]);

        await queue.processQueue();

        expect(dispatchFn).toHaveBeenCalledWith('telegram', '12345', 'hello');
        expect(db.updateDeliveryState).toHaveBeenCalledWith('job1', 'sent', expect.any(String));
        expect(db.recordDeliveryAttemptEnd).toHaveBeenCalledWith(expect.any(String), expect.any(String), null, expect.any(Number));
    });

    it('should handle failure and retry', async () => {
        const job = { id: 'job1', platform: 'telegram', chat_id: '12345', text_payload: 'hello', attempts: 1 };
        vi.mocked(db.dequeueDeliveries).mockReturnValue([job]);
        dispatchFn.mockRejectedValue(new Error('Network error'));

        await queue.processQueue();

        expect(db.updateDeliveryState).toHaveBeenCalledWith('job1', 'failed', null);
        expect(db.updateDeliveryAttempts).toHaveBeenCalledWith('job1', 1, expect.any(String));
        expect(db.recordDeliveryAttemptEnd).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'Network error', expect.any(Number));
    });

    it('should move to dead-letter after exhaustive failure', async () => {
        // maxAttempts is 2 in this test setup
        const job = { id: 'job2', platform: 'whatsapp', chat_id: '6789', text_payload: 'hi', attempts: 2 };
        vi.mocked(db.dequeueDeliveries).mockReturnValue([job]);
        dispatchFn.mockRejectedValue(new Error('Terminal error'));

        await queue.processQueue();

        expect(db.updateDeliveryState).toHaveBeenCalledWith('job2', 'dead_letter', expect.any(String));
        expect(db.updateDeliveryAttempts).not.toHaveBeenCalledWith('job2', expect.any(Number), expect.any(String));
    });

    it('should requeue a dead letter', () => {
        queue.requeueDeadLetter('job-dead');
        expect(db.updateDeliveryState).toHaveBeenCalledWith('job-dead', 'queued', null);
        expect(db.updateDeliveryAttempts).toHaveBeenCalledWith('job-dead', 0, expect.any(String));
    });
});
