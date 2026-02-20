import type { HealthCheckResult, DoctorReport, ReadinessLevel } from '../types/health-doctor.js';
import { DoctorService } from './doctor.js';

const SEVERITY_ICONS: Record<string, string> = {
    ok: '✓',
    warning: '⚠',
    critical: '✗',
};

function formatCheck(check: HealthCheckResult): string {
    const icon = SEVERITY_ICONS[check.severity] ?? '?';
    const lines = [`  ${icon} [${check.severity.toUpperCase().padEnd(8)}] ${check.name}: ${check.message}`];
    if (check.remediation && check.severity !== 'ok') {
        lines.push(`          → ${check.remediation}`);
    }
    return lines.join('\n');
}

function formatReadiness(level: ReadinessLevel): string {
    switch (level) {
        case 'ready':
            return 'READY';
        case 'degraded':
            return 'DEGRADED';
        case 'not_ready':
            return 'NOT READY';
    }
}

function printReport(report: DoctorReport): void {
    const { readiness, checks } = report;

    console.log('\nTwinClaw Runtime Health Doctor');
    console.log('══════════════════════════════════════');

    for (const check of checks) {
        console.log(formatCheck(check));
    }

    console.log('──────────────────────────────────────');
    console.log(
        `Readiness: ${formatReadiness(readiness.level)}  ` +
            `(${readiness.passed} ok, ${readiness.warnings} warning, ${readiness.critical} critical)`,
    );
    console.log(`Evaluated at: ${readiness.evaluatedAt}`);
    console.log('');
}

/**
 * Run the CLI doctor command.
 *
 * Initializes a minimal {@link DoctorService} (DB + secrets), runs all
 * checks, prints a formatted report, and sets exit code 1 if any critical
 * check fails.
 *
 * Returns `true` if the command was handled so the caller can exit early.
 */
export async function handleDoctorCli(argv: string[]): Promise<boolean> {
    if (!argv.includes('doctor')) {
        return false;
    }

    const doctor = new DoctorService();
    const report = await doctor.runAll();

    printReport(report);

    if (report.readiness.level === 'not_ready') {
        console.error('[Doctor] Runtime is NOT READY. Resolve critical issues before starting.');
        process.exitCode = 1;
    } else if (report.readiness.level === 'degraded') {
        console.warn('[Doctor] Runtime is DEGRADED. Some features may be unavailable.');
    } else {
        console.log('[Doctor] All checks passed. Runtime is ready.');
    }

    return true;
}
