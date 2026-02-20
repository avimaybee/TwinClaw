import type { Request, Response } from 'express';
import type {
    BrowserSnapshotRequest,
    BrowserSnapshotData,
    BrowserClickRequest,
    BrowserClickData,
} from '../../types/api.js';
import { BrowserReferenceError, type BrowserService } from '../../services/browser-service.js';
import { sendOk, sendError, mapError } from '../shared.js';
import { logThought } from '../../utils/logger.js';
import path from 'node:path';

export interface BrowserDeps {
    browserService: BrowserService;
}

/**
 * POST /browser/snapshot
 *
 * Takes a screenshot and returns the accessibility tree of the current
 * (or newly navigated) page.
 *
 * Body:
 *   url?:      string  — Navigate to this URL before taking a snapshot.
 *   fullPage?: boolean — Whether to capture the full page. Default true.
 */
export function handleBrowserSnapshot(deps: BrowserDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as BrowserSnapshotRequest;

            if (body.url !== undefined && typeof body.url !== 'string') {
                sendError(res, 'Field "url" must be a string.', 400);
                return;
            }

            if (body.fullPage !== undefined && typeof body.fullPage !== 'boolean') {
                sendError(res, 'Field "fullPage" must be a boolean.', 400);
                return;
            }

            if (body.url) {
                await deps.browserService.navigate(body.url);
                await logThought(`[API] Browser navigated to: ${body.url}`);
            }

            const screenshotPath = path.resolve('memory', `snapshot_${Date.now()}.png`);
            const fullPage = body.fullPage !== false;
            const result = await deps.browserService.takeScreenshotForVlm(screenshotPath, fullPage);
            const tree = await deps.browserService.getAccessibilityTree();
            const referenceContext = await deps.browserService.captureSnapshotReferenceContext();

            const data: BrowserSnapshotData = {
                snapshotId: referenceContext.snapshotId,
                screenshotPath: result.path,
                viewport: result.viewport,
                accessibilityTree: typeof tree === 'string' ? tree : JSON.stringify(tree),
                references: referenceContext.references,
            };

            await logThought(
                `[API] Browser snapshot taken: ${screenshotPath} (snapshotId=${referenceContext.snapshotId}, refs=${referenceContext.references.length}).`,
            );
            sendOk(res, data, 200);
        } catch (err) {
            const mapped = mapError(err);
            await logThought(`[API] Browser snapshot failed: ${mapped.message}`);
            sendError(res, mapped.message, mapped.status);
        }
    };
}

/**
 * POST /browser/click
 *
 * Clicks an element on the current browser page.
 *
 * Body (one of):
 *   selector?: string — CSS selector to click.
 *   x?, y?:   number — Absolute viewport coordinates to click.
 */
export function handleBrowserClick(deps: BrowserDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as BrowserClickRequest;

            if (body.selector !== undefined && typeof body.selector !== 'string') {
                sendError(res, 'Field "selector" must be a string when provided.', 400);
                return;
            }
            if (body.ref !== undefined && typeof body.ref !== 'string') {
                sendError(res, 'Field "ref" must be a string when provided.', 400);
                return;
            }
            if (body.snapshotId !== undefined && typeof body.snapshotId !== 'string') {
                sendError(res, 'Field "snapshotId" must be a string when provided.', 400);
                return;
            }
            if (body.x !== undefined && typeof body.x !== 'number') {
                sendError(res, 'Field "x" must be a number when provided.', 400);
                return;
            }
            if (body.y !== undefined && typeof body.y !== 'number') {
                sendError(res, 'Field "y" must be a number when provided.', 400);
                return;
            }

            const hasReferenceMode = typeof body.ref === 'string' && body.ref.trim().length > 0;
            const hasSelectorMode = typeof body.selector === 'string' && body.selector.trim().length > 0;
            const hasCoordinateMode = typeof body.x === 'number' && typeof body.y === 'number';
            const selectedModes = [hasReferenceMode, hasSelectorMode, hasCoordinateMode].filter(Boolean).length;

            if (selectedModes > 1) {
                sendError(res, 'Provide only one click mode: "ref", "selector", or both "x" and "y".', 400);
                return;
            }

            if (hasReferenceMode && body.ref) {
                const result = await deps.browserService.clickByReference({
                    ref: body.ref,
                    snapshotId: body.snapshotId,
                });
                await logThought(
                    `[API] Browser clicked reference ${body.ref} on snapshot ${result.snapshotId} (selector=${result.reference.selector}).`,
                );
                const data: BrowserClickData = {
                    clicked: true,
                    method: 'reference',
                    detail: result.reference.selector,
                    ref: result.reference.ref,
                    snapshotId: result.snapshotId,
                };
                sendOk(res, data, 200);
                return;
            }

            if (hasSelectorMode && body.selector) {
                await deps.browserService.click(body.selector);
                await logThought(
                    `[API] Browser clicked selector: ${body.selector}. Prefer reference mode from /browser/snapshot for deterministic actions.`,
                );

                const data: BrowserClickData = {
                    clicked: true,
                    method: 'selector',
                    detail: `${body.selector} (selector mode; prefer ref mode for deterministic targeting)`,
                };
                sendOk(res, data, 200);
                return;
            }

            if (hasCoordinateMode && typeof body.x === 'number' && typeof body.y === 'number') {
                await deps.browserService.clickAt({ x: body.x, y: body.y });
                await logThought(
                    `[API] Browser clicked at (${body.x}, ${body.y}). Prefer reference mode from /browser/snapshot when available.`,
                );

                const data: BrowserClickData = {
                    clicked: true,
                    method: 'coordinates',
                    detail: `(${body.x}, ${body.y}) (coordinates mode; prefer ref mode for deterministic targeting)`,
                };
                sendOk(res, data, 200);
                return;
            }

            sendError(
                res,
                'Provide one click mode: "ref" (string), "selector" (string), or "x" and "y" (number).',
                400,
            );
        } catch (err) {
            if (err instanceof BrowserReferenceError) {
                const mapped = mapBrowserReferenceError(err);
                await logThought(`[API] Browser click reference failed: ${mapped.message}`);
                sendError(res, mapped.message, mapped.status);
                return;
            }
            const mapped = mapError(err);
            await logThought(`[API] Browser click failed: ${mapped.message}`);
            sendError(res, mapped.message, mapped.status);
        }
    };
}

function mapBrowserReferenceError(error: BrowserReferenceError): { status: number; message: string } {
    switch (error.code) {
        case 'snapshot_context_missing':
            return { status: 409, message: error.message };
        case 'snapshot_context_stale':
            return { status: 409, message: error.message };
        case 'reference_not_found':
            return { status: 404, message: error.message };
        case 'reference_unresolved':
            return { status: 422, message: error.message };
        default:
            return { status: 500, message: error.message };
    }
}
