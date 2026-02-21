import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { DmPairingService } from '../../src/services/dm-pairing.js';

describe('DmPairingService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-dm-pairing-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates pairing requests and deduplicates re-requests for the same sender', () => {
    const service = new DmPairingService({ credentialsDir: tempDir });

    const first = service.requestPairing('telegram', '12345', 1_000);
    expect(first.status).toBe('created');
    expect(first.request?.code).toMatch(/^[A-Z2-9]{8}$/);

    const second = service.requestPairing('telegram', '12345', 2_000);
    expect(second.status).toBe('existing');
    expect(second.request?.code).toBe(first.request?.code);
  });

  it('approves a pairing code and authorizes sender access', () => {
    const service = new DmPairingService({ credentialsDir: tempDir });
    const created = service.requestPairing('telegram', '12345', 5_000);
    expect(created.status).toBe('created');
    const code = created.request?.code;
    expect(code).toBeDefined();

    const approval = service.approve('telegram', String(code), 6_000);
    expect(approval.status).toBe('approved');
    expect(approval.senderId).toBe('12345');
    expect(service.isApproved('telegram', '12345')).toBe(true);
    expect(service.listPending('telegram', 6_000)).toHaveLength(0);
  });

  it('expires pending requests and reports expired approval attempts', () => {
    const service = new DmPairingService({
      credentialsDir: tempDir,
      codeTtlMs: 1_000,
    });
    const created = service.requestPairing('telegram', '12345', 1_000);
    expect(created.status).toBe('created');
    const code = created.request?.code;
    expect(code).toBeDefined();

    const expired = service.approve('telegram', String(code), 2_500);
    expect(expired.status).toBe('expired');
    expect(service.listPending('telegram', 2_500)).toHaveLength(0);
  });

  it('enforces pending request limits per channel', () => {
    const service = new DmPairingService({
      credentialsDir: tempDir,
      maxPendingPerChannel: 3,
    });

    expect(service.requestPairing('telegram', '111', 1_000).status).toBe('created');
    expect(service.requestPairing('telegram', '222', 1_100).status).toBe('created');
    expect(service.requestPairing('telegram', '333', 1_200).status).toBe('created');
    expect(service.requestPairing('telegram', '444', 1_300).status).toBe('limit_reached');
  });

  it('normalizes WhatsApp sender IDs before approving and checking access', () => {
    const service = new DmPairingService({ credentialsDir: tempDir });
    const created = service.requestPairing('whatsapp', '+1 (555) 100-2000@c.us', 1_000);
    expect(created.status).toBe('created');
    const code = created.request?.code;
    expect(code).toBeDefined();

    const approval = service.approve('whatsapp', String(code), 1_500);
    expect(approval.status).toBe('approved');
    expect(service.isApproved('whatsapp', '15551002000@c.us')).toBe(true);
  });
});
