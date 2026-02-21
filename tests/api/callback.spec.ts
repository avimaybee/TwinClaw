import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { handleWebhookCallback } from '../../src/api/handlers/callback.js';
import { requireSignature, requestLogger } from '../../src/api/shared.js';
import { recordCallbackReceipt, getCallbackReceipt } from '../../src/services/db.js';

// Mock DB and Gateway
vi.mock('../../src/services/db.js', () => {
    return {
        db: null,
        recordCallbackReceipt: vi.fn(),
        getCallbackReceipt: vi.fn(),
        getDelivery: vi.fn().mockReturnValue(null),
        updateDeliveryState: vi.fn(),
    };
});

vi.mock('../../src/utils/logger.js', () => ({
    logThought: vi.fn(),
    scrubSensitiveText: (s: string) => s,
}));

const mockGateway = {
    processText: vi.fn().mockResolvedValue('ok')
};

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        const serialized = JSON.stringify(value);
        return serialized ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

describe('POST /callback/webhook', () => {
    let app: Express;
    const API_SECRET = 'test-secret';
    let receipts: Map<string, any>;

    beforeEach(() => {
        vi.clearAllMocks();
        receipts = new Map<string, any>();

        vi.mocked(recordCallbackReceipt).mockImplementation((key, status, outcome) => {
            receipts.set(key, { idempotency_key: key, status_code: status, outcome });
        });
        vi.mocked(getCallbackReceipt).mockImplementation((key) => receipts.get(key) as any);

        process.env.API_SECRET = API_SECRET;

        app = express();
        app.use(express.json());
        app.use(requestLogger);
        app.post('/callback/webhook', requireSignature, handleWebhookCallback({ gateway: mockGateway as any }));
    });

    const generateSignature = (body: any, secret = API_SECRET) => {
        const hmac = createHmac('sha256', secret);
        return `sha256=${hmac.update(JSON.stringify(body)).digest('hex')}`;
    };

    it('rejects requests without a signature', async () => {
        const response = await request(app)
            .post('/callback/webhook')
            .send({ eventType: 'test', taskId: '123', status: 'completed' });

        expect(response.status).toBe(401);
        expect(response.body.ok).toBe(false);
    });

    it('rejects requests with an invalid signature', async () => {
        const payload = { eventType: 'test', taskId: '123', status: 'completed' };

        const response = await request(app)
            .post('/callback/webhook')
            .set('x-signature', generateSignature(payload, 'wrong-secret'))
            .send(payload);

        expect(response.status).toBe(403);
        expect(response.body.ok).toBe(false);
    });

    it('accepts valid requests and forwards to gateway', async () => {
        const payload = { eventType: 'test', taskId: 'task-1', status: 'completed' };

        const response = await request(app)
            .post('/callback/webhook')
            .set('x-signature', generateSignature(payload))
            .send(payload);

        expect(response.status).toBe(202);
        expect(response.body.ok).toBe(true);
        expect(response.body.data.outcome).toBe('accepted');
        expect(mockGateway.processText).toHaveBeenCalledOnce();

        // Ensure receipt was recorded
        expect(recordCallbackReceipt).toHaveBeenCalledWith('task-1:test:completed', 202, 'accepted');
    });

    it('accepts canonical signatures with reordered JSON keys', async () => {
        const payload = {
            taskId: 'task-canonical',
            status: 'completed',
            eventType: 'test',
            result: { z: 1, a: 2 },
        };
        const canonicalSignature = `sha256=${createHmac('sha256', API_SECRET)
            .update(stableStringify(payload))
            .digest('hex')}`;

        const response = await request(app)
            .post('/callback/webhook')
            .set('x-signature', canonicalSignature)
            .send(payload);

        expect(response.status).toBe(202);
        expect(response.body.ok).toBe(true);
    });

    it('short-circuits identical duplicate requests (idempotency)', async () => {
        const payload = { eventType: 'test', taskId: 'task-2', status: 'completed' };
        const sig = generateSignature(payload);

        // First request is accepted
        await request(app).post('/callback/webhook').set('x-signature', sig).send(payload);
        expect(mockGateway.processText).toHaveBeenCalledTimes(1);

        // Submitting exact same payload again
        const response2 = await request(app).post('/callback/webhook').set('x-signature', sig).send(payload);

        // It should return 200 OK (not 202 Async Accepted) and NOT call the gateway again
        expect(response2.status).toBe(200);
        expect(response2.body.data.outcome).toBe('duplicate');
        expect(mockGateway.processText).toHaveBeenCalledTimes(1); // Still 1!
    });

    it('returns validation errors for missing fields and logs rejection receipt', async () => {
        const payload = { eventType: 'test', taskId: '123' }; // missing status

        const response = await request(app)
            .post('/callback/webhook')
            .set('x-signature', generateSignature(payload))
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
    });
});
