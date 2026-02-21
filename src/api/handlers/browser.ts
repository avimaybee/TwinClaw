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

const DEFAULT_BROWSER_ALLOWED_HOSTS = ['example.com'];

function resolveAllowedBrowserHosts(): string[] {
    const configured = (process.env.BROWSER_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    return configured.length > 0 ? configured : DEFAULT_BROWSER_ALLOWED_HOSTS;
}

function isPrivateIpv4(hostname: string): boolean {
    const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) {
        return false;
    }
    const octets = match.slice(1).map((value) => Number(value));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
        return false;
    }
    const [a, b] = octets;
    return (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

function isPrivateOrLocalHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    if (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fe80:') ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd')
    ) {
        return true;
    }
    return isPrivateIpv4(normalized);
}

function hostMatchesAllowRule(hostname: string, rule: string): boolean {
    if (rule === '*') {
        return true;
    }
    if (rule.startsWith('*.')) {
        const suffix = rule.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return hostname === rule;
}

function validateNavigationUrl(inputUrl: string): { ok: true; url: string } | { ok: false; status: number; error: string } {
    let parsed: URL;
    try {
        parsed = new URL(inputUrl);
    } catch {
        return { ok: false, status: 400, error: 'Field "url" must be a valid absolute URL.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, status: 400, error: 'Only http:// and https:// URLs are allowed.' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, status: 400, error: 'URLs with embedded credentials are not allowed.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHost(hostname)) {
        return { ok: false, status: 403, error: 'Navigation to local or private-network hosts is blocked.' };
    }

    const allowedHosts = resolveAllowedBrowserHosts();
    const hostAllowed = allowedHosts.some((rule) => hostMatchesAllowRule(hostname, rule));
    if (!hostAllowed) {
        return {
            ok: false,
            status: 403,
            error: `Host '${hostname}' is not in BROWSER_ALLOWED_HOSTS allowlist.`,
        };
    }

    return { ok: true, url: parsed.toString() };
}

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
                const validatedUrl = validateNavigationUrl(body.url);
                if (!validatedUrl.ok) {
                    sendError(res, validatedUrl.error, validatedUrl.status);
                    return;
                }

                await deps.browserService.navigate(validatedUrl.url);
                await logThought(`[API] Browser navigated to: ${validatedUrl.url}`);
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
