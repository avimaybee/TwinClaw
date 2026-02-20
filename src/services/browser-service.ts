import { chromium, Browser, BrowserContext, Page } from 'playwright-core';

const SNAPSHOT_CONTEXT_LIMIT = 8;
const REFERENCE_CANDIDATE_LIMIT = 256;
const REF_PREFIX = 'ref';

export interface ClickPoint {
  x: number;
  y: number;
}

export interface VlmScreenshotResult {
  path: string;
  viewport: {
    width: number;
    height: number;
  };
}

export interface BrowserReferenceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserReferenceCandidate {
  selector: string;
  role: string | null;
  name: string | null;
  bounds: BrowserReferenceBounds;
}

export interface BrowserReferenceEntry {
  ref: string;
  selector: string;
  role: string;
  name: string;
  bounds: BrowserReferenceBounds;
}

export interface BrowserSnapshotReferenceContext {
  snapshotId: string;
  createdAt: string;
  references: BrowserReferenceEntry[];
}

export type BrowserReferenceErrorCode =
  | 'snapshot_context_missing'
  | 'snapshot_context_stale'
  | 'reference_not_found'
  | 'reference_unresolved';

export class BrowserReferenceError extends Error {
  readonly code: BrowserReferenceErrorCode;

  constructor(code: BrowserReferenceErrorCode, message: string) {
    super(message);
    this.name = 'BrowserReferenceError';
    this.code = code;
  }
}

function normalizeRole(value: string | null): string {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized || 'generic';
}

function normalizeName(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function sanitizeSelector(value: string): string {
  return value.trim();
}

function normalizeBounds(bounds: BrowserReferenceBounds): BrowserReferenceBounds {
  const normalize = (value: number): number =>
    Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

  return {
    x: normalize(bounds.x),
    y: normalize(bounds.y),
    width: Math.max(0, normalize(bounds.width)),
    height: Math.max(0, normalize(bounds.height)),
  };
}

export function normalizeBrowserReferenceCandidates(
  candidates: BrowserReferenceCandidate[],
): BrowserReferenceEntry[] {
  const deduped = new Map<string, Omit<BrowserReferenceEntry, 'ref'>>();

  for (const candidate of candidates) {
    const selector = sanitizeSelector(candidate.selector);
    if (!selector) {
      continue;
    }

    const entry: Omit<BrowserReferenceEntry, 'ref'> = {
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

  const sorted = [...deduped.values()].sort((left, right) =>
    left.bounds.y - right.bounds.y ||
    left.bounds.x - right.bounds.x ||
    left.selector.localeCompare(right.selector) ||
    left.role.localeCompare(right.role) ||
    left.name.localeCompare(right.name),
  );

  return sorted.map((entry, index) => ({
    ...entry,
    ref: `${REF_PREFIX}-${String(index + 1).padStart(3, '0')}`,
  }));
}

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private snapshotContexts: BrowserSnapshotReferenceContext[] = [];
  private snapshotCounter = 0;

  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    }
  }

  async navigate(url: string) {
    if (!this.page) await this.init();
    await this.page!.goto(url, { waitUntil: 'networkidle' });
  }

  async getAccessibilityTree() {
    if (!this.page) await this.init();

    const bodyLocator = this.page!.locator('body');
    if (typeof bodyLocator.ariaSnapshot === 'function') {
      return await bodyLocator.ariaSnapshot();
    }

    return await this.page!.content();
  }

  async captureSnapshotReferenceContext(): Promise<BrowserSnapshotReferenceContext> {
    if (!this.page) await this.init();

    const rawCandidates = await this.page!.evaluate((limit: number) => {
      type Candidate = {
        selector: string;
        role: string | null;
        name: string | null;
        bounds: { x: number; y: number; width: number; height: number };
      };

      const normalizeText = (value: string | null | undefined): string | null => {
        if (typeof value !== 'string') {
          return null;
        }
        const trimmed = value.replace(/\s+/g, ' ').trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const inferRole = (element: HTMLElement): string | null => {
        const explicitRole = normalizeText(element.getAttribute('role'));
        if (explicitRole) {
          return explicitRole.toLowerCase();
        }

        const tag = element.tagName.toLowerCase();
        if (tag === 'a' && element.hasAttribute('href')) return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'summary') return 'button';
        if (tag === 'option') return 'option';

        if (tag === 'input') {
          const inputType = normalizeText(element.getAttribute('type'))?.toLowerCase() ?? 'text';
          if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') return 'button';
          if (inputType === 'checkbox') return 'checkbox';
          if (inputType === 'radio') return 'radio';
          if (inputType === 'range') return 'slider';
          if (inputType === 'search') return 'searchbox';
          return 'textbox';
        }

        return null;
      };

      const inferName = (element: HTMLElement): string | null => {
        const ariaLabel = normalizeText(element.getAttribute('aria-label'));
        if (ariaLabel) return ariaLabel;

        const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
        if (labelledBy) {
          const label = labelledBy
            .split(/\s+/g)
            .map((id) => normalizeText(document.getElementById(id)?.textContent))
            .filter((value): value is string => !!value)
            .join(' ');
          if (label) {
            return label;
          }
        }

        const title = normalizeText(element.getAttribute('title'));
        if (title) return title;

        const placeholder = normalizeText(element.getAttribute('placeholder'));
        if (placeholder) return placeholder;

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const value = normalizeText(element.value);
          if (value) return value;
        }

        return normalizeText(element.textContent);
      };

      const isVisible = (element: HTMLElement): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };

      const cssPath = (element: HTMLElement): string => {
        const simpleIdPattern = /^[A-Za-z][A-Za-z0-9\-_:.\u00A0-\uFFFF]*$/;
        if (element.id && simpleIdPattern.test(element.id)) {
          return `#${element.id}`;
        }

        const segments: string[] = [];
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const parent = current.parentElement;
          const tag = current.tagName.toLowerCase();
          if (!parent) {
            segments.unshift(tag);
            break;
          }

          const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
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
      const candidates: Candidate[] = [];

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
    const snapshotContext: BrowserSnapshotReferenceContext = {
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

  async takeScreenshot(path: string) {
    if (!this.page) await this.init();
    await this.page!.screenshot({ path });
  }

  async takeScreenshotForVlm(
    filePath: string,
    fullPage: boolean = true,
  ): Promise<VlmScreenshotResult> {
    if (!this.page) await this.init();
    await this.page!.screenshot({ path: filePath, fullPage });
    const viewport = this.page!.viewportSize() ?? { width: 1280, height: 720 };
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

  async click(selector: string) {
    if (!this.page) await this.init();
    await this.page!.click(selector);
  }

  async clickAt(point: ClickPoint) {
    if (!this.page) await this.init();
    await this.page!.mouse.click(point.x, point.y);
  }

  async clickByReference(input: {
    ref: string;
    snapshotId?: string;
  }): Promise<{ snapshotId: string; reference: BrowserReferenceEntry }> {
    if (!this.page) await this.init();

    const snapshot = input.snapshotId
      ? this.snapshotContexts.find((context) => context.snapshotId === input.snapshotId)
      : this.snapshotContexts.at(-1);

    if (!snapshot && input.snapshotId) {
      throw new BrowserReferenceError(
        'snapshot_context_stale',
        `Snapshot '${input.snapshotId}' is no longer available. Capture a fresh snapshot and retry.`,
      );
    }

    if (!snapshot) {
      throw new BrowserReferenceError(
        'snapshot_context_missing',
        'No snapshot reference context is available. Capture /browser/snapshot before clicking by ref.',
      );
    }

    const reference = snapshot.references.find((entry) => entry.ref === input.ref);
    if (!reference) {
      throw new BrowserReferenceError(
        'reference_not_found',
        `Reference '${input.ref}' was not found in snapshot '${snapshot.snapshotId}'.`,
      );
    }

    try {
      await this.page!.locator(reference.selector).first().click();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BrowserReferenceError(
        'reference_unresolved',
        `Reference '${input.ref}' could not be resolved to a clickable element. ${detail}`,
      );
    }

    return {
      snapshotId: snapshot.snapshotId,
      reference,
    };
  }

  async clickFromViewportPercentage(xRatio: number, yRatio: number) {
    if (!this.page) await this.init();
    const viewport = this.page!.viewportSize() ?? { width: 1280, height: 720 };

    const boundedX = Math.max(0, Math.min(1, xRatio));
    const boundedY = Math.max(0, Math.min(1, yRatio));

    const point: ClickPoint = {
      x: Math.round(viewport.width * boundedX),
      y: Math.round(viewport.height * boundedY),
    };

    await this.clickAt(point);
    return point;
  }

  async getViewportInfo() {
    if (!this.page) await this.init();
    return this.page!.viewportSize() ?? { width: 1280, height: 720 };
  }

  async type(selector: string, text: string) {
    if (!this.page) await this.init();
    await this.page!.type(selector, text);
  }

  private nextSnapshotId(): string {
    this.snapshotCounter += 1;
    return `snapshot-${Date.now()}-${String(this.snapshotCounter).padStart(4, '0')}`;
  }
}
