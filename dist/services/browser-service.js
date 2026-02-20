import { chromium } from 'playwright-core';
const SNAPSHOT_CONTEXT_LIMIT = 8;
const REFERENCE_CANDIDATE_LIMIT = 256;
const REF_PREFIX = 'ref';
export class BrowserReferenceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'BrowserReferenceError';
        this.code = code;
    }
}
function normalizeRole(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized || 'generic';
}
function normalizeName(value) {
    return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function sanitizeSelector(value) {
    return value.trim();
}
function normalizeBounds(bounds) {
    const normalize = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    return {
        x: normalize(bounds.x),
        y: normalize(bounds.y),
        width: Math.max(0, normalize(bounds.width)),
        height: Math.max(0, normalize(bounds.height)),
    };
}
export function normalizeBrowserReferenceCandidates(candidates) {
    const deduped = new Map();
    for (const candidate of candidates) {
        const selector = sanitizeSelector(candidate.selector);
        if (!selector) {
            continue;
        }
        const entry = {
            selector,
            role: normalizeRole(candidate.role),
            name: normalizeName(candidate.name),
            bounds: normalizeBounds(candidate.bounds),
        };
        const dedupeKey = [
            entry.selector,
            entry.role,
            entry.name,
            entry.bounds.x,
            entry.bounds.y,
            entry.bounds.width,
            entry.bounds.height,
        ].join('|');
        if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, entry);
        }
    }
    const sorted = [...deduped.values()].sort((left, right) => left.bounds.y - right.bounds.y ||
        left.bounds.x - right.bounds.x ||
        left.selector.localeCompare(right.selector) ||
        left.role.localeCompare(right.role) ||
        left.name.localeCompare(right.name));
    return sorted.map((entry, index) => ({
        ...entry,
        ref: `${REF_PREFIX}-${String(index + 1).padStart(3, '0')}`,
    }));
}
export class BrowserService {
    browser = null;
    context = null;
    page = null;
    snapshotContexts = [];
    snapshotCounter = 0;
    async init() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
            this.context = await this.browser.newContext();
            this.page = await this.context.newPage();
        }
    }
    async navigate(url) {
        if (!this.page)
            await this.init();
        await this.page.goto(url, { waitUntil: 'networkidle' });
    }
    async getAccessibilityTree() {
        if (!this.page)
            await this.init();
        const bodyLocator = this.page.locator('body');
        if (typeof bodyLocator.ariaSnapshot === 'function') {
            return await bodyLocator.ariaSnapshot();
        }
        return await this.page.content();
    }
    async captureSnapshotReferenceContext() {
        if (!this.page)
            await this.init();
        const rawCandidates = await this.page.evaluate((limit) => {
            const normalizeText = (value) => {
                if (typeof value !== 'string') {
                    return null;
                }
                const trimmed = value.replace(/\s+/g, ' ').trim();
                return trimmed.length > 0 ? trimmed : null;
            };
            const inferRole = (element) => {
                const explicitRole = normalizeText(element.getAttribute('role'));
                if (explicitRole) {
                    return explicitRole.toLowerCase();
                }
                const tag = element.tagName.toLowerCase();
                if (tag === 'a' && element.hasAttribute('href'))
                    return 'link';
                if (tag === 'button')
                    return 'button';
                if (tag === 'select')
                    return 'combobox';
                if (tag === 'textarea')
                    return 'textbox';
                if (tag === 'summary')
                    return 'button';
                if (tag === 'option')
                    return 'option';
                if (tag === 'input') {
                    const inputType = normalizeText(element.getAttribute('type'))?.toLowerCase() ?? 'text';
                    if (inputType === 'button' || inputType === 'submit' || inputType === 'reset')
                        return 'button';
                    if (inputType === 'checkbox')
                        return 'checkbox';
                    if (inputType === 'radio')
                        return 'radio';
                    if (inputType === 'range')
                        return 'slider';
                    if (inputType === 'search')
                        return 'searchbox';
                    return 'textbox';
                }
                return null;
            };
            const inferName = (element) => {
                const ariaLabel = normalizeText(element.getAttribute('aria-label'));
                if (ariaLabel)
                    return ariaLabel;
                const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
                if (labelledBy) {
                    const label = labelledBy
                        .split(/\s+/g)
                        .map((id) => normalizeText(document.getElementById(id)?.textContent))
                        .filter((value) => !!value)
                        .join(' ');
                    if (label) {
                        return label;
                    }
                }
                const title = normalizeText(element.getAttribute('title'));
                if (title)
                    return title;
                const placeholder = normalizeText(element.getAttribute('placeholder'));
                if (placeholder)
                    return placeholder;
                if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                    const value = normalizeText(element.value);
                    if (value)
                        return value;
                }
                return normalizeText(element.textContent);
            };
            const isVisible = (element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return (rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0');
            };
            const cssPath = (element) => {
                const simpleIdPattern = /^[A-Za-z][A-Za-z0-9\-_:.\u00A0-\uFFFF]*$/;
                if (element.id && simpleIdPattern.test(element.id)) {
                    return `#${element.id}`;
                }
                const segments = [];
                let current = element;
                while (current && current !== document.body) {
                    const parent = current.parentElement;
                    const tag = current.tagName.toLowerCase();
                    if (!parent) {
                        segments.unshift(tag);
                        break;
                    }
                    const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
                    const index = Math.max(1, siblings.indexOf(current) + 1);
                    segments.unshift(`${tag}:nth-of-type(${index})`);
                    current = parent;
                }
                if (segments.length === 0) {
                    return 'body';
                }
                return `body > ${segments.join(' > ')}`;
            };
            const selectors = 'a[href],button,input,select,textarea,[role],summary,[tabindex]';
            const nodes = Array.from(document.querySelectorAll(selectors));
            const candidates = [];
            for (const node of nodes) {
                if (candidates.length >= limit) {
                    break;
                }
                if (!(node instanceof HTMLElement)) {
                    continue;
                }
                if (!isVisible(node)) {
                    continue;
                }
                const rect = node.getBoundingClientRect();
                if (rect.width <= 1 || rect.height <= 1) {
                    continue;
                }
                candidates.push({
                    selector: cssPath(node),
                    role: inferRole(node),
                    name: inferName(node),
                    bounds: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                });
            }
            return candidates;
        }, REFERENCE_CANDIDATE_LIMIT);
        const references = normalizeBrowserReferenceCandidates(rawCandidates);
        const snapshotContext = {
            snapshotId: this.nextSnapshotId(),
            createdAt: new Date().toISOString(),
            references,
        };
        this.snapshotContexts.push(snapshotContext);
        if (this.snapshotContexts.length > SNAPSHOT_CONTEXT_LIMIT) {
            this.snapshotContexts.splice(0, this.snapshotContexts.length - SNAPSHOT_CONTEXT_LIMIT);
        }
        return snapshotContext;
    }
    async takeScreenshot(path) {
        if (!this.page)
            await this.init();
        await this.page.screenshot({ path });
    }
    async takeScreenshotForVlm(filePath, fullPage = true) {
        if (!this.page)
            await this.init();
        await this.page.screenshot({ path: filePath, fullPage });
        const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
        return {
            path: filePath,
            viewport,
        };
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.snapshotContexts = [];
            this.snapshotCounter = 0;
        }
    }
    async click(selector) {
        if (!this.page)
            await this.init();
        await this.page.click(selector);
    }
    async clickAt(point) {
        if (!this.page)
            await this.init();
        await this.page.mouse.click(point.x, point.y);
    }
    async clickByReference(input) {
        if (!this.page)
            await this.init();
        const snapshot = input.snapshotId
            ? this.snapshotContexts.find((context) => context.snapshotId === input.snapshotId)
            : this.snapshotContexts.at(-1);
        if (!snapshot && input.snapshotId) {
            throw new BrowserReferenceError('snapshot_context_stale', `Snapshot '${input.snapshotId}' is no longer available. Capture a fresh snapshot and retry.`);
        }
        if (!snapshot) {
            throw new BrowserReferenceError('snapshot_context_missing', 'No snapshot reference context is available. Capture /browser/snapshot before clicking by ref.');
        }
        const reference = snapshot.references.find((entry) => entry.ref === input.ref);
        if (!reference) {
            throw new BrowserReferenceError('reference_not_found', `Reference '${input.ref}' was not found in snapshot '${snapshot.snapshotId}'.`);
        }
        try {
            await this.page.locator(reference.selector).first().click();
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new BrowserReferenceError('reference_unresolved', `Reference '${input.ref}' could not be resolved to a clickable element. ${detail}`);
        }
        return {
            snapshotId: snapshot.snapshotId,
            reference,
        };
    }
    async clickFromViewportPercentage(xRatio, yRatio) {
        if (!this.page)
            await this.init();
        const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
        const boundedX = Math.max(0, Math.min(1, xRatio));
        const boundedY = Math.max(0, Math.min(1, yRatio));
        const point = {
            x: Math.round(viewport.width * boundedX),
            y: Math.round(viewport.height * boundedY),
        };
        await this.clickAt(point);
        return point;
    }
    async getViewportInfo() {
        if (!this.page)
            await this.init();
        return this.page.viewportSize() ?? { width: 1280, height: 720 };
    }
    async type(selector, text) {
        if (!this.page)
            await this.init();
        await this.page.type(selector, text);
    }
    nextSnapshotId() {
        this.snapshotCounter += 1;
        return `snapshot-${Date.now()}-${String(this.snapshotCounter).padStart(4, '0')}`;
    }
}
