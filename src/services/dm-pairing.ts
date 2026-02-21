import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type PairingChannel = 'telegram' | 'whatsapp';
export type DmPolicy = 'pairing' | 'allowlist';

export interface PairingRequestRecord {
  senderId: string;
  code: string;
  requestedAt: string;
  expiresAt: string;
}

interface PairingPendingStore {
  requests: PairingRequestRecord[];
}

interface PairingAllowStore {
  senderIds: string[];
}

export interface RequestPairingResult {
  status: 'created' | 'existing' | 'limit_reached';
  request?: PairingRequestRecord;
}

export interface ApprovePairingResult {
  status: 'approved' | 'not_found' | 'expired';
  senderId?: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DEFAULT_CODE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PENDING_PER_CHANNEL = 3;

export interface DmPairingServiceOptions {
  credentialsDir?: string;
  codeTtlMs?: number;
  maxPendingPerChannel?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isPairingRequestRecord(value: unknown): value is PairingRequestRecord {
  if (!isRecord(value)) {
    return false;
  }

  const senderId = value['senderId'];
  const code = value['code'];
  const requestedAt = value['requestedAt'];
  const expiresAt = value['expiresAt'];

  return (
    typeof senderId === 'string' &&
    senderId.length > 0 &&
    typeof code === 'string' &&
    /^[A-Z2-9]{8}$/.test(code) &&
    typeof requestedAt === 'string' &&
    isIsoTimestamp(requestedAt) &&
    typeof expiresAt === 'string' &&
    isIsoTimestamp(expiresAt)
  );
}

function assertPairingPendingStore(value: unknown, filePath: string): PairingPendingStore {
  if (!isRecord(value) || !Array.isArray(value['requests'])) {
    throw new Error(`Invalid pairing pending store format at '${filePath}'.`);
  }

  const requests = value['requests'];
  if (!requests.every((entry) => isPairingRequestRecord(entry))) {
    throw new Error(`Invalid pairing request entries at '${filePath}'.`);
  }

  return { requests };
}

function assertPairingAllowStore(value: unknown, filePath: string): PairingAllowStore {
  if (!isRecord(value) || !Array.isArray(value['senderIds'])) {
    throw new Error(`Invalid pairing allow store format at '${filePath}'.`);
  }

  const senderIds = value['senderIds'];
  if (!senderIds.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new Error(`Invalid allowlist sender IDs at '${filePath}'.`);
  }

  return { senderIds };
}

export function isPairingChannel(value: string): value is PairingChannel {
  return value === 'telegram' || value === 'whatsapp';
}

export function normalizePairingSenderId(channel: PairingChannel, senderId: string): string {
  const trimmed = senderId.trim();
  if (channel === 'telegram') {
    return trimmed;
  }

  const localPart = trimmed.split('@')[0] ?? trimmed;
  return localPart.replace(/[\s\+\-\(\)]/g, '');
}

export class DmPairingService {
  readonly #credentialsDir: string;
  readonly #codeTtlMs: number;
  readonly #maxPendingPerChannel: number;

  constructor(options: DmPairingServiceOptions = {}) {
    this.#credentialsDir = options.credentialsDir
      ? path.resolve(options.credentialsDir)
      : path.resolve('memory', 'credentials');
    this.#codeTtlMs =
      Number.isFinite(options.codeTtlMs) && (options.codeTtlMs ?? 0) > 0
        ? Number(options.codeTtlMs)
        : DEFAULT_CODE_TTL_MS;
    this.#maxPendingPerChannel =
      Number.isFinite(options.maxPendingPerChannel) && (options.maxPendingPerChannel ?? 0) > 0
        ? Number(options.maxPendingPerChannel)
        : DEFAULT_MAX_PENDING_PER_CHANNEL;
  }

  listPending(channel: PairingChannel, nowMs: number = Date.now()): PairingRequestRecord[] {
    const pending = this.#readPendingStore(channel);
    const { activeRequests, changed } = this.#pruneExpired(pending.requests, nowMs);
    if (changed) {
      this.#writePendingStore(channel, activeRequests);
    }

    return [...activeRequests].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  listApproved(channel: PairingChannel): string[] {
    const store = this.#readAllowStore(channel);
    return [...store.senderIds].sort();
  }

  isApproved(channel: PairingChannel, senderId: string): boolean {
    const normalized = normalizePairingSenderId(channel, senderId);
    if (!normalized) {
      return false;
    }
    const store = this.#readAllowStore(channel);
    return store.senderIds.includes(normalized);
  }

  seedAllowFrom(channel: PairingChannel, senderIds: string[]): void {
    const normalized = senderIds
      .map((senderId) => normalizePairingSenderId(channel, senderId))
      .filter((senderId) => senderId.length > 0);

    if (normalized.length === 0) {
      return;
    }

    const store = this.#readAllowStore(channel);
    const merged = [...new Set([...store.senderIds, ...normalized])].sort();
    this.#writeAllowStore(channel, merged);
  }

  requestPairing(
    channel: PairingChannel,
    senderId: string,
    nowMs: number = Date.now(),
  ): RequestPairingResult {
    const normalizedSenderId = normalizePairingSenderId(channel, senderId);
    if (!normalizedSenderId) {
      return { status: 'limit_reached' };
    }

    const pending = this.#readPendingStore(channel);
    const { activeRequests } = this.#pruneExpired(pending.requests, nowMs);

    const existing = activeRequests.find((request) => request.senderId === normalizedSenderId);
    if (existing) {
      if (activeRequests.length !== pending.requests.length) {
        this.#writePendingStore(channel, activeRequests);
      }
      return { status: 'existing', request: existing };
    }

    if (activeRequests.length >= this.#maxPendingPerChannel) {
      if (activeRequests.length !== pending.requests.length) {
        this.#writePendingStore(channel, activeRequests);
      }
      return { status: 'limit_reached' };
    }

    const request: PairingRequestRecord = {
      senderId: normalizedSenderId,
      code: this.#generateUniqueCode(activeRequests),
      requestedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + this.#codeTtlMs).toISOString(),
    };

    this.#writePendingStore(channel, [...activeRequests, request]);
    return { status: 'created', request };
  }

  approve(channel: PairingChannel, code: string, nowMs: number = Date.now()): ApprovePairingResult {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(normalizedCode)) {
      return { status: 'not_found' };
    }

    const pending = this.#readPendingStore(channel);
    const request = pending.requests.find((entry) => entry.code === normalizedCode);
    const { activeRequests } = this.#pruneExpired(pending.requests, nowMs);

    if (!request) {
      if (activeRequests.length !== pending.requests.length) {
        this.#writePendingStore(channel, activeRequests);
      }
      return { status: 'not_found' };
    }

    if (Date.parse(request.expiresAt) <= nowMs) {
      const withoutExpired = activeRequests.filter((entry) => entry.code !== normalizedCode);
      this.#writePendingStore(channel, withoutExpired);
      return { status: 'expired' };
    }

    const remaining = activeRequests.filter((entry) => entry.code !== normalizedCode);
    this.#writePendingStore(channel, remaining);
    this.seedAllowFrom(channel, [request.senderId]);

    return { status: 'approved', senderId: request.senderId };
  }

  #generateUniqueCode(existingRequests: PairingRequestRecord[]): string {
    const existingCodes = new Set(existingRequests.map((request) => request.code));
    for (let attempts = 0; attempts < 128; attempts++) {
      const code = this.#generateCode();
      if (!existingCodes.has(code)) {
        return code;
      }
    }
    throw new Error('Unable to generate a unique pairing code after multiple attempts.');
  }

  #generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (let index = 0; index < CODE_LENGTH; index++) {
      const alphabetIndex = bytes[index]! % CODE_ALPHABET.length;
      code += CODE_ALPHABET[alphabetIndex];
    }
    return code;
  }

  #pruneExpired(
    requests: PairingRequestRecord[],
    nowMs: number,
  ): { activeRequests: PairingRequestRecord[]; changed: boolean } {
    const activeRequests = requests.filter((request) => Date.parse(request.expiresAt) > nowMs);
    return { activeRequests, changed: activeRequests.length !== requests.length };
  }

  #pendingStorePath(channel: PairingChannel): string {
    return path.join(this.#credentialsDir, `${channel}-pairing.json`);
  }

  #allowStorePath(channel: PairingChannel): string {
    return path.join(this.#credentialsDir, `${channel}-allowFrom.json`);
  }

  #readPendingStore(channel: PairingChannel): PairingPendingStore {
    const filePath = this.#pendingStorePath(channel);
    if (!fs.existsSync(filePath)) {
      return { requests: [] };
    }
    const raw = this.#readJson(filePath);
    return assertPairingPendingStore(raw, filePath);
  }

  #readAllowStore(channel: PairingChannel): PairingAllowStore {
    const filePath = this.#allowStorePath(channel);
    if (!fs.existsSync(filePath)) {
      return { senderIds: [] };
    }
    const raw = this.#readJson(filePath);
    return assertPairingAllowStore(raw, filePath);
  }

  #writePendingStore(channel: PairingChannel, requests: PairingRequestRecord[]): void {
    this.#writeJson(this.#pendingStorePath(channel), { requests });
  }

  #writeAllowStore(channel: PairingChannel, senderIds: string[]): void {
    this.#writeJson(this.#allowStorePath(channel), {
      senderIds: [...new Set(senderIds)].sort(),
    });
  }

  #readJson(filePath: string): unknown {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  #writeJson(filePath: string, payload: PairingPendingStore | PairingAllowStore): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = `${JSON.stringify(payload, null, 2)}\n`;

    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }
}

let pairingServiceSingleton: DmPairingService | null = null;

export function getDmPairingService(): DmPairingService {
  if (!pairingServiceSingleton) {
    pairingServiceSingleton = new DmPairingService();
  }
  return pairingServiceSingleton;
}

export function resetDmPairingServiceForTests(): void {
  pairingServiceSingleton = null;
}
