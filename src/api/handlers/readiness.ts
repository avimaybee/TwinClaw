import type { Request, Response } from 'express';
import type { DoctorReport } from '../../types/health-doctor.js';
import { DoctorService, type DoctorDeps } from '../../core/doctor.js';
import { sendOk } from '../shared.js';

export type ReadinessDeps = DoctorDeps;

/**
 * GET /readiness
 *
 * Minimal readiness probe — returns just the aggregated readiness level.
 * Intended for load-balancer / orchestrator health checks.
 *
 * Returns HTTP 200 for `ready` and `degraded`, HTTP 503 for `not_ready`.
 */
export function handleReadiness(deps: ReadinessDeps) {
    return async (_req: Request, res: Response): Promise<void> => {
        const doctor = new DoctorService(deps);
        const report = await doctor.runAll();
        const { readiness } = report;

        const status = readiness.level === 'not_ready' ? 503 : 200;
        sendOk(
            res,
            {
                level: readiness.level,
                passed: readiness.passed,
                warnings: readiness.warnings,
                critical: readiness.critical,
                evaluatedAt: readiness.evaluatedAt,
            },
            status,
        );
    };
}

/**
 * GET /doctor
 *
 * Full diagnostic report. Returns all check results with actionable
 * remediation guidance. Suitable for operator dashboards and CLI display.
 *
 * Returns HTTP 200 for `ready` and `degraded`, HTTP 503 for `not_ready`.
 */
export function handleDoctor(deps: ReadinessDeps) {
    return async (_req: Request, res: Response): Promise<void> => {
        const doctor = new DoctorService(deps);
        const report: DoctorReport = await doctor.runAll();

        const status = report.readiness.level === 'not_ready' ? 503 : 200;
        sendOk(res, report, status);
    };
}
