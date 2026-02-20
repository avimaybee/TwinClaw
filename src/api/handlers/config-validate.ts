import type { Request, Response } from 'express';
import type { ConfigValidationData } from '../../types/api.js';
import { validateRuntimeConfig } from '../../config/env-validator.js';
import { sendOk } from '../shared.js';

/** GET /config/validate — Returns a full runtime config validation report. */
export function handleConfigValidate() {
    return (_req: Request, res: Response): void => {
        const result = validateRuntimeConfig();

        const data: ConfigValidationData = {
            ok: result.ok,
            presentKeys: result.presentKeys,
            issues: result.issues,
            activeFeatures: result.activeFeatures,
            fatalIssues: result.fatalIssues,
            validatedAt: result.validatedAt,
        };

        // Use 200 even when validation has issues; the `ok` field in the body
        // communicates the config health to callers.
        sendOk(res, data);
    };
}
