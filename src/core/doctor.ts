import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  DoctorCheck,
  DoctorCheckResult,
  DoctorReport,
  DoctorSeverity,
  DoctorStatus,
} from '../types/doctor.js';

// ── Built-in check definitions ───────────────────────────────────────────────

export const BINARY_CHECKS: DoctorCheck[] = [
  {
    kind: 'binary',
    name: 'node',
    description: 'Node.js runtime (v22+ required)',
    severity: 'critical',
    remediation: 'Install Node.js v22+ from https://nodejs.org',
  },
  {
    kind: 'binary',
    name: 'git',
    description: 'Git version control',
    severity: 'warning',
    remediation: 'Install Git from https://git-scm.com',
  },
];

export const ENV_VAR_CHECKS: DoctorCheck[] = [
  {
    kind: 'env-var',
    name: 'GROQ_API_KEY',
    description: 'Groq API key for Speech-to-Text and TTS',
    severity: 'critical',
    remediation:
      'Get a free API key at https://console.groq.com and set GROQ_API_KEY in your .env file.',
  },
  {
    kind: 'env-var',
    name: 'TELEGRAM_BOT_TOKEN',
    description: 'Telegram Bot token for messaging integration',
    severity: 'warning',
    remediation:
      'Create a bot via @BotFather on Telegram and set TELEGRAM_BOT_TOKEN in your .env file.',
  },
  {
    kind: 'env-var',
    name: 'TELEGRAM_USER_ID',
    description: 'Your Telegram user ID for bot authorization',
    severity: 'warning',
    remediation:
      'Find your Telegram user ID via @userinfobot and set TELEGRAM_USER_ID in your .env file.',
  },
  {
    kind: 'env-var',
    name: 'API_SECRET',
    description: 'API secret for webhook callback authentication',
    severity: 'critical',
    remediation:
      'Generate a strong secret and set API_SECRET in your .env file. Example: openssl rand -hex 32',
  },
];

export const FILESYSTEM_CHECKS: DoctorCheck[] = [
  {
    kind: 'filesystem',
    name: 'memory-dir',
    description: 'Memory directory for logs and state persistence',
    severity: 'warning',
    remediation: 'Create the ./memory directory: mkdir -p memory',
  },
  {
    kind: 'filesystem',
    name: 'env-file',
    description: '.env configuration file',
    severity: 'info',
    remediation:
      'Copy .env.example to .env and fill in required values: cp .env.example .env',
  },
];

/** All built-in checks in default run order. */
export const DEFAULT_CHECKS: DoctorCheck[] = [
  ...BINARY_CHECKS,
  ...ENV_VAR_CHECKS,
  ...FILESYSTEM_CHECKS,
];

// ── Individual check executors ───────────────────────────────────────────────

/** @internal exported for testing */
export function checkBinary(check: DoctorCheck): DoctorCheckResult {
  try {
    const cmd =
      process.platform === 'win32'
        ? `where ${check.name}`
        : `which ${check.name}`;
    execSync(cmd, { stdio: 'pipe', timeout: 5_000 });

    if (check.name === 'node') {
      const versionRaw = execSync('node --version', { stdio: 'pipe' })
        .toString()
        .trim();
      const match = versionRaw.match(/^v(\d+)\./);
      const major = match ? parseInt(match[1], 10) : 0;
      if (major < 22) {
        return {
          check,
          passed: false,
          actual: versionRaw,
          message: `Node.js ${versionRaw} found but v22+ is required.`,
        };
      }
      return {
        check,
        passed: true,
        actual: versionRaw,
        message: `Node.js ${versionRaw} found.`,
      };
    }

    return {
      check,
      passed: true,
      message: `'${check.name}' binary found.`,
    };
  } catch {
    return {
      check,
      passed: false,
      message: `'${check.name}' binary not found in PATH.`,
    };
  }
}

/** @internal exported for testing */
export function checkEnvVar(check: DoctorCheck): DoctorCheckResult {
  const value = process.env[check.name];
  if (!value || value.trim().length === 0) {
    return {
      check,
      passed: false,
      message: `Environment variable '${check.name}' is not set.`,
    };
  }
  // Mask the value for safe display
  const masked =
    value.length > 8
      ? `${value.slice(0, 4)}${'*'.repeat(Math.min(8, value.length - 4))}`
      : '****';
  return {
    check,
    passed: true,
    actual: masked,
    message: `'${check.name}' is set (${masked}).`,
  };
}

/** @internal exported for testing */
export function checkFilesystem(check: DoctorCheck): DoctorCheckResult {
  const targetMap: Record<string, string> = {
    'memory-dir': path.resolve('memory'),
    'env-file': path.resolve('.env'),
  };

  const target = targetMap[check.name];
  if (!target) {
    return {
      check,
      passed: false,
      message: `Unknown filesystem check target: '${check.name}'.`,
    };
  }

  if (!existsSync(target)) {
    return {
      check,
      passed: false,
      actual: target,
      message: `'${target}' does not exist.`,
    };
  }

  return {
    check,
    passed: true,
    actual: target,
    message: `'${target}' exists.`,
  };
}

// ── Report utilities ─────────────────────────────────────────────────────────

function deriveStatus(results: DoctorCheckResult[]): DoctorStatus {
  const hasCriticalFailure = results.some(
    (r) => !r.passed && r.check.severity === 'critical',
  );
  if (hasCriticalFailure) return 'critical';
  if (results.some((r) => !r.passed)) return 'degraded';
  return 'ok';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute all doctor checks and return a structured report.
 * Accepts an optional override list for targeted or test-only runs.
 */
export function runDoctorChecks(checks?: DoctorCheck[]): DoctorReport {
  const allChecks = checks ?? DEFAULT_CHECKS;

  const results: DoctorCheckResult[] = allChecks.map((check) => {
    switch (check.kind) {
      case 'binary':
        return checkBinary(check);
      case 'env-var':
        return checkEnvVar(check);
      case 'filesystem':
        return checkFilesystem(check);
      case 'service-endpoint':
        // Service endpoint checks are intentionally deferred for interactive local use
        return {
          check,
          passed: true,
          message: 'Service endpoint checks are skipped in local mode.',
        };
      default: {
        const exhaustive: never = check.kind;
        return {
          check,
          passed: false,
          message: `Unknown check kind: '${exhaustive as string}'.`,
        };
      }
    }
  });

  const status = deriveStatus(results);
  const passed = results.filter((r) => r.passed).length;

  return {
    status,
    results,
    checkedAt: new Date().toISOString(),
    passed,
    failed: results.length - passed,
  };
}

const SEVERITY_ICON: Record<DoctorSeverity, string> = {
  critical: '✗',
  warning: '⚠',
  info: 'ℹ',
};

const STATUS_LABEL: Record<DoctorStatus, string> = {
  ok: '✓ OK',
  degraded: '⚠ DEGRADED',
  critical: '✗ CRITICAL',
};

/**
 * Format a DoctorReport for display.
 * Set `asJson=true` to emit machine-readable JSON.
 */
export function formatDoctorReport(report: DoctorReport, asJson = false): string {
  if (asJson) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push(`TwinClaw Doctor — ${STATUS_LABEL[report.status]}`);
  lines.push(`Checked at: ${report.checkedAt}`);
  lines.push(`Passed: ${report.passed}  Failed: ${report.failed}`);
  lines.push('');

  for (const result of report.results) {
    const icon = result.passed ? '✓' : SEVERITY_ICON[result.check.severity];
    const kindLabel = `[${result.check.kind}]`;
    lines.push(`  ${icon} ${kindLabel} ${result.check.name}: ${result.message}`);
    if (!result.passed) {
      lines.push(`      → Remediation: ${result.check.remediation}`);
    }
  }

  lines.push('');
  if (report.status === 'ok') {
    lines.push('All checks passed. TwinClaw is ready to run.');
  } else if (report.status === 'degraded') {
    lines.push('Some checks failed. TwinClaw may run with limited functionality.');
  } else {
    lines.push('Critical checks failed. Fix the issues above before running TwinClaw.');
  }

  return lines.join('\n');
}
