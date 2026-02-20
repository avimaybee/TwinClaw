import type { Request, Response } from 'express';
import type { WebhookCallbackPayload, WebhookCallbackData } from '../../types/api.js';
import type { Gateway } from '../../core/gateway.js';
import { sendOk, sendError } from '../shared.js';
import { logThought } from '../../utils/logger.js';
import { recordCallbackReceipt, getCallbackReceipt, getDelivery, updateDeliveryState } from '../../services/db.js';

export interface CallbackDeps {
    gateway: Gateway;
}

/**
 * POST /callback/webhook
 *
 * Ingests completion events from long-running external tasks.
 * This endpoint is protected by the `requireSignature` middleware.
 *
 * Body:
 *   eventType: string                       — e.g. 'deploy.complete', 'scrape.done'
 *   taskId:    string                       — Correlating task identifier.
 *   status:    'completed' | 'failed' | 'progress'
 *   result?:   unknown                      — Arbitrary payload on success.
 *   error?:    string                       — Error description on failure.
 */
export function handleWebhookCallback(deps: CallbackDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        const body = req.body as Partial<WebhookCallbackPayload>;

        // ── Validate required fields ────────────────────────────────────────────
        if (!body.eventType || typeof body.eventType !== 'string') {
            sendError(res, 'Missing or invalid "eventType" (string).', 400);
            return;
        }
        if (!body.taskId || typeof body.taskId !== 'string') {
            sendError(res, 'Missing or invalid "taskId" (string).', 400);
            return;
        }
        const validStatuses = new Set(['completed', 'failed', 'progress']);
        if (!body.status || !validStatuses.has(body.status)) {
            sendError(res, 'Missing or invalid "status" (completed | failed | progress).', 400);
            return;
        }

        // ── Idempotency Check ───────────────────────────────────────────────────
        const idempotencyKey = `${body.taskId}:${body.eventType}:${body.status}`;
        const existingReceipt = getCallbackReceipt(idempotencyKey);

        if (existingReceipt) {
            await logThought(
                `[API] Webhook rejected — duplicate payload detected for key: ${idempotencyKey}`,
            );
            const data: WebhookCallbackData = {
                accepted: true,
                eventType: body.eventType,
                taskId: body.taskId,
                outcome: 'duplicate',
            };
            sendOk(res, data, 200);
            return;
        }

        await logThought(
            `[API] Webhook received — event: ${body.eventType}, task: ${body.taskId}, status: ${body.status}`,
        );

        // ── Forward into the gateway as a system-level message ──────────────────
        try {
            const sessionId = `webhook:${body.taskId}`;
            const summaryText =
                `[Webhook Callback] Event: ${body.eventType} | Task: ${body.taskId} | Status: ${body.status}` +
                (body.result ? `\nResult: ${JSON.stringify(body.result)}` : '') +
                (body.error ? `\nError: ${body.error}` : '');

            // ── Reconciliation ───────────────────────────────────────────────────
            const delivery = getDelivery(body.taskId);
            if (delivery) {
                const newState = body.status === 'completed' ? 'sent' : body.status === 'failed' ? 'failed' : delivery.state;
                updateDeliveryState(body.taskId, newState, newState === 'sent' ? new Date().toISOString() : null);
                await logThought(`[API] Webhook reconciled delivery queue item: ${body.taskId} -> ${newState}`);
            }

            // Fire-and-forget: process the webhook payload as a conversation turn
            void deps.gateway.processText(sessionId, summaryText);

            recordCallbackReceipt(idempotencyKey, 202, 'accepted');

            const data: WebhookCallbackData = {
                accepted: true,
                eventType: body.eventType,
                taskId: body.taskId,
                outcome: 'accepted',
            };

            sendOk(res, data, 202);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await logThought(`[API] Webhook processing error: ${message}`);
            recordCallbackReceipt(idempotencyKey, 500, 'rejected');
            sendError(res, `Webhook processing error: ${message}`, 500);
        }
    };
}
