import type { Request, Response } from 'express';
import type {
    BrowserSnapshotRequest,
    BrowserSnapshotData,
    BrowserClickRequest,
    BrowserClickData,
} from '../../types/api.js';
import type { BrowserService } from '../../services/browser-service.js';
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
            const body = req.body as BrowserSnapshotRequest;

            if (body.url) {
                if (typeof body.url !== 'string') {
                    sendError(res, 'Field "url" must be a string.', 400);
                    return;
                }
                await deps.browserService.navigate(body.url);
                await logThought(`[API] Browser navigated to: ${body.url}`);
            }

            const screenshotPath = path.resolve('memory', `snapshot_${Date.now()}.png`);
            const fullPage = body.fullPage !== false;
            const result = await deps.browserService.takeScreenshotForVlm(screenshotPath, fullPage);
            const tree = await deps.browserService.getAccessibilityTree();

            const data: BrowserSnapshotData = {
                screenshotPath: result.path,
                viewport: result.viewport,
                accessibilityTree: typeof tree === 'string' ? tree : JSON.stringify(tree),
            };

            await logThought(`[API] Browser snapshot taken: ${screenshotPath}`);
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
            const body = req.body as BrowserClickRequest;

            if (body.selector && typeof body.selector === 'string') {
                await deps.browserService.click(body.selector);
                await logThought(`[API] Browser clicked selector: ${body.selector}`);

                const data: BrowserClickData = {
                    clicked: true,
                    method: 'selector',
                    detail: body.selector,
                };
                sendOk(res, data, 200);
                return;
            }

            if (typeof body.x === 'number' && typeof body.y === 'number') {
                await deps.browserService.clickAt({ x: body.x, y: body.y });
                await logThought(`[API] Browser clicked at (${body.x}, ${body.y})`);

                const data: BrowserClickData = {
                    clicked: true,
                    method: 'coordinates',
                    detail: `(${body.x}, ${body.y})`,
                };
                sendOk(res, data, 200);
                return;
            }

            sendError(res, 'Provide either "selector" (string) or "x" and "y" (number).', 400);
        } catch (err) {
            const mapped = mapError(err);
            await logThought(`[API] Browser click failed: ${mapped.message}`);
            sendError(res, mapped.message, mapped.status);
        }
    };
}
