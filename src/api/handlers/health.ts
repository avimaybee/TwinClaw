import type { Request, Response } from 'express';
import type { HealthData } from '../../types/api.js';
import type { SkillRegistry } from '../../services/skill-registry.js';
import type { McpServerManager } from '../../services/mcp-server-manager.js';
import type { HeartbeatService } from '../../core/heartbeat.js';
import type { RuntimeBudgetGovernor } from '../../services/runtime-budget-governor.js';
import type { LocalStateBackupService } from '../../services/local-state-backup.js';
import type { ModelRouter } from '../../services/model-router.js';
import type { QueueService } from '../../services/queue-service.js';
import type { IncidentManager } from '../../services/incident-manager.js';
import { getSecretVaultService } from '../../services/secret-vault.js';
import { DoctorService } from '../../core/doctor.js';
import { sendOk } from '../shared.js';

const startTime = Date.now();

export interface HealthDeps {
    heartbeat: HeartbeatService;
    skillRegistry: SkillRegistry;
    mcpManager: McpServerManager;
    budgetGovernor?: RuntimeBudgetGovernor;
    localStateBackup?: LocalStateBackupService;
    modelRouter?: ModelRouter;
    queue?: QueueService;
    incidentManager?: IncidentManager;
}

/** GET /health — Returns system health status and subsystem summaries. */
export function handleHealth(deps: HealthDeps) {
    return async (_req: Request, res: Response): Promise<void> => {
        const summary = deps.skillRegistry.summary();
        const servers = deps.mcpManager.listServers();
        const packageDiagnostics = await deps.mcpManager.getSkillPackageDiagnostics();
        const secretDiagnostics = getSecretVaultService().getDiagnostics(['API_SECRET']);
        const budgetSnapshot = deps.budgetGovernor?.getSnapshot('health');
        const routingSnapshot = deps.modelRouter?.getHealthSnapshot();
        const backupDiagnostics = deps.localStateBackup
            ? await deps.localStateBackup.getDiagnostics(5)
            : null;
        const heartbeatRunning = deps.heartbeat.scheduler
            .listJobs()
            .some((j) => j.status === 'running');

        // Run the doctor for a unified readiness summary
        const doctor = new DoctorService({
            heartbeat: deps.heartbeat,
            skillRegistry: deps.skillRegistry,
            mcpManager: deps.mcpManager,
            queue: deps.queue,
            modelRouter: deps.modelRouter,
            incidentManager: deps.incidentManager,
        });
        const doctorReport = await doctor.runAll();

        const data: HealthData = {
            status:
                servers.some((s) => s.state === 'error') ||
                packageDiagnostics.blockedPackageCount > 0 ||
                secretDiagnostics.health.hasIssues ||
                budgetSnapshot?.directive.severity === 'hard_limit' ||
                (routingSnapshot?.consecutiveFailures ?? 0) >= 3 ||
                backupDiagnostics?.status === 'degraded'
                    ? 'degraded'
                    : 'ok',
            uptimeSec: Math.floor((Date.now() - startTime) / 1000),
            memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heartbeat: { running: heartbeatRunning },
            readiness: doctorReport.readiness,
            skills: {
                builtin: summary.builtin ?? 0,
                mcp: summary.mcp ?? 0,
                total: deps.skillRegistry.size,
            },
            skillPackages: {
                installed: packageDiagnostics.installed.length,
                active: packageDiagnostics.activePackageCount,
                blocked: packageDiagnostics.blockedPackageCount,
                warnings: packageDiagnostics.warnings,
                violations: packageDiagnostics.violations.map((violation) => ({
                    packageName: violation.packageName,
                    version: violation.version,
                    code: violation.code,
                    message: violation.message,
                    remediation: violation.remediation,
                })),
            },
            secrets: {
                status: secretDiagnostics.health.hasIssues ? 'degraded' : 'ok',
                missingRequired: secretDiagnostics.health.missingRequired,
                expired: secretDiagnostics.health.expired,
                warnings: secretDiagnostics.health.warnings,
                total: secretDiagnostics.total,
                active: secretDiagnostics.active,
                dueForRotation: secretDiagnostics.dueForRotation,
            },
            budget: budgetSnapshot
                ? {
                    severity: budgetSnapshot.directive.severity,
                    profile: budgetSnapshot.directive.profile,
                    pacingDelayMs: budgetSnapshot.directive.pacingDelayMs,
                    manualProfile: budgetSnapshot.manualProfile,
                    daily: budgetSnapshot.daily,
                    session: budgetSnapshot.session,
                    providers: budgetSnapshot.providers,
                }
                : undefined,
            routing: routingSnapshot,
            backups: backupDiagnostics
                ? {
                    status: backupDiagnostics.status,
                    lastSnapshotAt: backupDiagnostics.lastSnapshotAt,
                    lastRestoreAt: backupDiagnostics.lastRestoreAt,
                    validationFailureCount: backupDiagnostics.validationFailureCount,
                    recommendationCount: backupDiagnostics.recommendations.length,
                }
                : undefined,
            mcpServers: servers.map((s) => ({
                id: s.id,
                name: s.name,
                state: s.state,
                toolCount: s.toolCount,
                health: {
                    circuit: s.health.state,
                    failureCount: s.health.metrics.failureCount,
                    remainingCooldownMs: s.health.remainingCooldownMs,
                },
            })),
        };

        sendOk(res, data);
    };
}
