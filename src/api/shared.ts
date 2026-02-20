import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiEnvelope } from '../types/api.js';
import { logThought } from '../utils/logger.js';

// ── Response Helpers ────────────────────────────────────────────────────────

/** Send a successful JSON response using the standard envelope. */
export function sendOk<T>(res: Response, data: T, status = 200): void {
    const body: ApiEnvelope<T> = {
        ok: true,
        data,
        timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
}

/** Send an error JSON response using the standard envelope. */
export function sendError(res: Response, message: string, status = 400): void {
    const body: ApiEnvelope = {
        ok: false,
        error: message,
        timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
}

// ── Auth Middleware ──────────────────────────────────────────────────────────

const API_SECRET = process.env.API_SECRET ?? '';

/**
 * Validate the `X-Signature` header on incoming webhook callbacks.
 *
 * Expected format: `sha256=<hex digest of HMAC-SHA256(body, API_SECRET)>`
 *
 * If API_SECRET is not configured, all callback requests are rejected.
 */
export function requireSignature(req: Request, res: Response, next: NextFunction): void {
    if (!API_SECRET) {
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
    const expectedHex = createHmac('sha256', API_SECRET).update(rawBody).digest('hex');

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
            return { status: 503, message: err.message };
        }
        return { status: 500, message: err.message };
    }
    return { status: 500, message: String(err) };
}

// ── Logging Middleware ───────────────────────────────────────────────────────

/** Log every incoming request. */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
    const method = req.method;
    const path = req.path;
    console.log(`[API] ${method} ${path}`);
    void logThought(`[API] ${method} ${path}`);
    next();
}
