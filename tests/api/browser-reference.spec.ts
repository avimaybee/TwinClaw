import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  handleBrowserClick,
  handleBrowserSnapshot,
} from '../../src/api/handlers/browser.js';
import { BrowserReferenceError } from '../../src/services/browser-service.js';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

describe('browser reference API handlers', () => {
  let app: Express;
  let browserService: {
    navigate: ReturnType<typeof vi.fn>;
    takeScreenshotForVlm: ReturnType<typeof vi.fn>;
    getAccessibilityTree: ReturnType<typeof vi.fn>;
    captureSnapshotReferenceContext: ReturnType<typeof vi.fn>;
    clickByReference: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
    clickAt: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    browserService = {
      navigate: vi.fn().mockResolvedValue(undefined),
      takeScreenshotForVlm: vi.fn().mockResolvedValue({
        path: 'memory/snapshot_test.png',
        viewport: { width: 1280, height: 720 },
      }),
      getAccessibilityTree: vi.fn().mockResolvedValue({ role: 'document' }),
      captureSnapshotReferenceContext: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-abc',
        createdAt: '2026-02-20T00:00:00.000Z',
        references: [
          {
            ref: 'ref-001',
            selector: '#login',
            role: 'button',
            name: 'Login',
            bounds: { x: 10, y: 20, width: 80, height: 24 },
          },
        ],
      }),
      clickByReference: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-abc',
        reference: {
          ref: 'ref-001',
          selector: '#login',
          role: 'button',
          name: 'Login',
          bounds: { x: 10, y: 20, width: 80, height: 24 },
        },
      }),
      click: vi.fn().mockResolvedValue(undefined),
      clickAt: vi.fn().mockResolvedValue(undefined),
    };

    app = express();
    app.use(express.json());
    app.post('/browser/snapshot', handleBrowserSnapshot({ browserService: browserService as any }));
    app.post('/browser/click', handleBrowserClick({ browserService: browserService as any }));
  });

  it('returns snapshot reference map and snapshotId', async () => {
    const response = await request(app)
      .post('/browser/snapshot')
      .send({ url: 'https://example.com', fullPage: true });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.snapshotId).toBe('snapshot-abc');
    expect(response.body.data.references).toHaveLength(1);
    expect(browserService.captureSnapshotReferenceContext).toHaveBeenCalledTimes(1);
  });

  it('supports click-by-reference mode', async () => {
    const response = await request(app)
      .post('/browser/click')
      .send({ ref: 'ref-001', snapshotId: 'snapshot-abc' });

    expect(response.status).toBe(200);
    expect(response.body.data.method).toBe('reference');
    expect(response.body.data.ref).toBe('ref-001');
    expect(response.body.data.snapshotId).toBe('snapshot-abc');
    expect(browserService.clickByReference).toHaveBeenCalledWith({
      ref: 'ref-001',
      snapshotId: 'snapshot-abc',
    });
  });

  it('returns stale snapshot diagnostics when reference context expires', async () => {
    browserService.clickByReference.mockRejectedValue(
      new BrowserReferenceError(
        'snapshot_context_stale',
        "Snapshot 'snapshot-old' is no longer available. Capture a fresh snapshot and retry.",
      ),
    );

    const response = await request(app)
      .post('/browser/click')
      .send({ ref: 'ref-001', snapshotId: 'snapshot-old' });

    expect(response.status).toBe(409);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toContain('no longer available');
  });

  it('returns 404 for unknown references', async () => {
    browserService.clickByReference.mockRejectedValue(
      new BrowserReferenceError(
        'reference_not_found',
        "Reference 'ref-404' was not found in snapshot 'snapshot-abc'.",
      ),
    );

    const response = await request(app)
      .post('/browser/click')
      .send({ ref: 'ref-404', snapshotId: 'snapshot-abc' });

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toContain('ref-404');
  });

  it('keeps legacy selector/coordinate click compatibility', async () => {
    const selectorResponse = await request(app)
      .post('/browser/click')
      .send({ selector: '#legacy-button' });
    const coordinateResponse = await request(app)
      .post('/browser/click')
      .send({ x: 200, y: 300 });

    expect(selectorResponse.status).toBe(200);
    expect(selectorResponse.body.data.method).toBe('selector');
    expect(coordinateResponse.status).toBe(200);
    expect(coordinateResponse.body.data.method).toBe('coordinates');
    expect(browserService.click).toHaveBeenCalledWith('#legacy-button');
    expect(browserService.clickAt).toHaveBeenCalledWith({ x: 200, y: 300 });
  });

  it('rejects ambiguous click mode payloads', async () => {
    const response = await request(app)
      .post('/browser/click')
      .send({ ref: 'ref-001', selector: '#legacy-button' });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toContain('Provide only one click mode');
  });
});
