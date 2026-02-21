import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { ApiEnvelope } from '../types/api.js';
import { logThought, scrubSensitiveText } from '../utils/logger.js';
import { getSecretVaultService } from '../services/secret-vault.js';

type SignatureRequest = Request & { rawBody?: string };

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
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
}

function getSignaturePayloadCandidates(req: Request): string[] {
    const payloads = new Set<string>();
    const rawBody = (req as SignatureRequest).rawBody;
    if (typeof rawBody === 'string') {
        payloads.add(rawBody);
    }

    if (req.body === undefined) {
        payloads.add('');
        return [...payloads];
    }

    try {
        const stringified = JSON.stringify(req.body);
        if (typeof stringified === 'string') {
            payloads.add(stringified);
        }
    } catch {
        // JSON parse body should always be stringifiable; ignore defensive fallback.
    }

    try {
        payloads.add(stableStringify(req.body));
    } catch {
        // Ignore pathological payloads and continue with available candidates.
    }

    if (payloads.size === 0) {
        payloads.add('');
    }

    return [...payloads];
}

export function setRawRequestBody(req: IncomingMessage, buffer: Buffer): void {
    (req as IncomingMessage & { rawBody?: string }).rawBody = buffer.toString('utf8');
}

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
 * Validate the `X-Signature` header on incoming signed API requests.
 *
 * Expected format: `sha256=<hex digest of HMAC-SHA256(body, API_SECRET)>`
 *
 * If API_SECRET is not configured, all signed API requests are rejected.
 */
export function requireSignature(req: Request, res: Response, next: NextFunction): void {
    const apiSecret = getSecretVaultService().readSecret('API_SECRET') ?? '';

    if (!apiSecret) {
        void logThought('[API] Signed request rejected — API_SECRET not configured.');
        sendError(res, 'Signed API endpoints are unavailable (missing API_SECRET).', 503);
        return;
    }

    const signatureHeader = req.headers['x-signature'];
    if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
        void logThought('[API] Signed request rejected — missing or malformed X-Signature header.');
        sendError(res, 'Missing or malformed X-Signature header.', 401);
        return;
    }

    const providedHex = signatureHeader.slice('sha256='.length);
    if (!/^[a-f0-9]{64}$/i.test(providedHex)) {
        void logThought('[API] Signed request rejected — malformed signature digest.');
        sendError(res, 'Malformed signature digest.', 401);
        return;
    }
    const provided = Buffer.from(providedHex, 'hex');
    const payloadCandidates = getSignaturePayloadCandidates(req);
    const signatureMatches = payloadCandidates.some((payload) => {
        const expectedHex = createHmac('sha256', apiSecret).update(payload).digest('hex');
        const expected = Buffer.from(expectedHex, 'hex');
        return provided.length === expected.length && timingSafeEqual(provided, expected);
    });

    if (!signatureMatches) {
        void logThought('[API] Signed request rejected — signature mismatch.');
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
