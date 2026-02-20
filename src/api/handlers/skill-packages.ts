import type { Request, Response } from 'express';
import type { McpServerManager } from '../../services/mcp-server-manager.js';
import { sendError, sendOk } from '../shared.js';

export interface SkillPackageDeps {
    mcpManager: McpServerManager;
}

interface SkillPackageMutationBody {
    name?: unknown;
    versionRange?: unknown;
}

function readPackageName(body: unknown): string {
    if (!body || typeof body !== 'object' || !('name' in body)) {
        throw new Error("Request body must include 'name'.");
    }

    const candidate = (body as SkillPackageMutationBody).name;
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        throw new Error("Field 'name' must be a non-empty string.");
    }

    return candidate.trim();
}

function readVersionRange(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || !('versionRange' in body)) {
        return undefined;
    }

    const candidate = (body as SkillPackageMutationBody).versionRange;
    if (candidate === undefined || candidate === null) {
        return undefined;
    }
    if (typeof candidate !== 'string') {
        throw new Error("Field 'versionRange' must be a string when provided.");
    }
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function mapPackageErrorStatus(message: string): number {
    if (
        message.includes('must be') ||
        message.includes('required') ||
        message.includes('Invalid')
    ) {
        return 400;
    }
    if (
        message.includes('No compatible version') ||
        message.includes('Compatibility gate blocked') ||
        message.includes('Cannot uninstall')
    ) {
        return 409;
    }
    if (message.includes('not installed')) {
        return 404;
    }
    return 500;
}

export function handleSkillPackageDiagnostics(deps: SkillPackageDeps) {
    return async (_req: Request, res: Response): Promise<void> => {
        try {
            const diagnostics = await deps.mcpManager.getSkillPackageDiagnostics();
            sendOk(res, diagnostics);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, mapPackageErrorStatus(message));
        }
    };
}

export function handleSkillPackageInstall(deps: SkillPackageDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            const packageName = readPackageName(req.body);
            const versionRange = readVersionRange(req.body);
            const result = await deps.mcpManager.installSkillPackage(packageName, versionRange);
            sendOk(res, result, result.changed ? 201 : 200);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, mapPackageErrorStatus(message));
        }
    };
}

export function handleSkillPackageUpgrade(deps: SkillPackageDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            const packageName = readPackageName(req.body);
            const versionRange = readVersionRange(req.body);
            const result = await deps.mcpManager.upgradeSkillPackage(packageName, versionRange);
            sendOk(res, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, mapPackageErrorStatus(message));
        }
    };
}

export function handleSkillPackageUninstall(deps: SkillPackageDeps) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            const packageName = readPackageName(req.body);
            const result = await deps.mcpManager.uninstallSkillPackage(packageName);
            sendOk(res, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendError(res, message, mapPackageErrorStatus(message));
        }
    };
}

