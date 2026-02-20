import type { Request, Response } from 'express';
import type { LocalStateBackupService } from '../../services/local-state-backup.js';
import type { LocalStateBackupScope, LocalStateRestoreRequest } from '../../types/local-state-backup.js';
import type {
    LocalStateBackupDiagnosticsData,
    LocalStateRestoreData,
    LocalStateSnapshotData,
    LocalStateSnapshotRequest,
} from '../../types/api.js';
import { sendError, sendOk } from '../shared.js';

const ALLOWED_SCOPES: ReadonlySet<LocalStateBackupScope> = new Set([
    'identity',
    'memory',
    'runtime-db',
    'policy-profiles',
    'mcp-config',
    'skill-packages',
]);

export interface LocalStateBackupDeps {
    backupService?: LocalStateBackupService;
}

function requireBackupService(
    deps: LocalStateBackupDeps,
    res: Response,
): LocalStateBackupService | null {
    if (!deps.backupService) {
        sendError(res, 'Local state backup service is not initialized.', 503);
        return null;
    }
    return deps.backupService;
}

function parseSnapshotRequestBody(body: unknown): LocalStateSnapshotRequest {
    if (!body || typeof body !== 'object') {
        return {};
    }
    const candidate = body as { retentionLimit?: unknown };
    if (candidate.retentionLimit === undefined) {
        return {};
    }
    if (
        typeof candidate.retentionLimit !== 'number' ||
        !Number.isFinite(candidate.retentionLimit) ||
        candidate.retentionLimit <= 0
    ) {
        throw new Error("Field 'retentionLimit' must be a positive number.");
    }
    return { retentionLimit: Math.floor(candidate.retentionLimit) };
}

function parseRestoreRequestBody(body: unknown): LocalStateRestoreRequest {
    if (!body || typeof body !== 'object') {
        return {};
    }

    const candidate = body as {
        snapshotId?: unknown;
        dryRun?: unknown;
        scopes?: unknown;
    };
    const request: LocalStateRestoreRequest = {};

    if (candidate.snapshotId !== undefined) {
        if (typeof candidate.snapshotId !== 'string' || candidate.snapshotId.trim().length === 0) {
            throw new Error("Field 'snapshotId' must be a non-empty string when provided.");
        }
        request.snapshotId = candidate.snapshotId.trim();
    }

    if (candidate.dryRun !== undefined) {
        if (typeof candidate.dryRun !== 'boolean') {
            throw new Error("Field 'dryRun' must be boolean when provided.");
        }
        request.dryRun = candidate.dryRun;
    }

    if (candidate.scopes !== undefined) {
        if (!Array.isArray(candidate.scopes)) {
            throw new Error("Field 'scopes' must be an array when provided.");
        }
        const scopes: LocalStateBackupScope[] = [];
        for (const scope of candidate.scopes) {
            if (typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope as LocalStateBackupScope)) {
                throw new Error(`Unsupported backup scope '${String(scope)}'.`);
            }
            scopes.push(scope as LocalStateBackupScope);
        }
        request.scopes = [...new Set(scopes)];
    }

    return request;
}

export function handleLocalStateBackupDiagnostics(deps: LocalStateBackupDeps) {
    return async (_req: Request, res: Response): Promise<void> => {
        const service = requireBackupService(deps, res);
        if (!service) {
            return;
        }
        const diagnostics = await service.getDiagnostics();
        const data: LocalStateBackupDiagnosticsData = { diagnostics };
        sendOk(res, data);
    };
}

export function handleLocalStateCreateSnapshot(deps: LocalStateBackupDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        const service = requireBackupService(deps, res);
        if (!service) {
            return;
        }

        try {
            const request = parseSnapshotRequestBody(req.body);
            const snapshot = await service.createSnapshot({
                trigger: 'manual',
                retentionLimit: request.retentionLimit,
            });
            const data: LocalStateSnapshotData = { snapshot };
            sendOk(res, data, 201);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, 400);
        }
    };
}

export function handleLocalStateRestoreSnapshot(deps: LocalStateBackupDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        const service = requireBackupService(deps, res);
        if (!service) {
            return;
        }

        try {
            const request = parseRestoreRequestBody(req.body);
            const result = await service.restoreSnapshot(request);
            const data: LocalStateRestoreData = { request, result };
            if (result.status === 'failed') {
                sendError(res, result.validationErrors.join(' | ') || 'Restore failed.', 409);
                return;
            }
            sendOk(res, data);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, 400);
        }
    };
}

