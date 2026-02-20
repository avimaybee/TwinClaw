import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { ApiEnvelope } from '../types/api.js';
import { logThought, scrubSensitiveText } from '../utils/logger.js';
import { getSecretVaultService } from '../services/secret-vault.js';

// ── Response Helpers ────────────────────────────────────────────────────────

/** Send a successful JSON response using the standard envelope. */
export function sendOk<T>(res: Response, data: T, status = 200): void {
    const correlationId = res.locals.correlationId as string | undefined;
    const body: ApiEnvelope<T> = {
        ok: true,
        data,
        correlationId,
        timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
}

/** Send an error JSON response using the standard envelope. */
export function sendError(res: Response, message: string, status = 400): void {
    const correlationId = res.locals.correlationId as string | undefined;
    const redactedMessage = scrubSensitiveText(message);
    const body: ApiEnvelope = {
        ok: false,
        error: redactedMessage,
        correlationId,
        timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
}

// ── Auth Middleware ──────────────────────────────────────────────────────────

/**
 * Validate the `X-Signature` header on incoming webhook callbacks.
 *
 * Expected format: `sha256=<hex digest of HMAC-SHA256(body, API_SECRET)>`
 *
 * If API_SECRET is not configured, all callback requests are rejected.
 */
export function requireSignature(req: Request, res: Response, next: NextFunction): void {
    const apiSecret = getSecretVaultService().readSecret('API_SECRET') ?? '';

    if (!apiSecret) {
        void logThought('[API] Webhook rejected — API_SECRET not configured.');
        sendError(res, 'Webhook endpoint not configured (missing API_SECRET).', 503);
        return;
    }

    const signatureHeader = req.headers['x-signature'];
    if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
        void logThought('[API] Webhook rejected — missing or malformed X-Signature header.');
        sendError(res, 'Missing or malformed X-Signature header.', 401);
        return;
    }

    const providedHex = signatureHeader.slice('sha256='.length);
    const rawBody = JSON.stringify(req.body);
    const expectedHex = createHmac('sha256', apiSecret).update(rawBody).digest('hex');

    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        void logThought('[API] Webhook rejected — signature mismatch.');
        sendError(res, 'Invalid signature.', 403);
        return;
    }

    next();
}

// ── Error Mapping ───────────────────────────────────────────────────────────

/** Map a caught error to a status code and message. */
export function mapError(err: unknown): { status: number; message: string } {
    if (err instanceof Error) {
        if (err.message.includes('not initialized') || err.message.includes('not connected')) {
            return { status: 503, message: scrubSensitiveText(err.message) };
        }
        return { status: 500, message: scrubSensitiveText(err.message) };
    }
    return { status: 500, message: scrubSensitiveText(String(err)) };
}

// ── Logging Middleware ───────────────────────────────────────────────────────

/** Log every incoming request and inject a correlation ID. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const correlationId = randomUUID();
    res.locals.correlationId = correlationId;
    const method = req.method;
    const path = req.path;
    console.log(`[API] [${correlationId}] ${method} ${path}`);
    void logThought(`[API] [${correlationId}] ${method} ${path}`);
    next();
}
