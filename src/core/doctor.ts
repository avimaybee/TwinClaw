import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getConfigPath } from '../config/json-config.js';
import type {
  DoctorCheck,
  DoctorCheckResult,
  DoctorReport,
  DoctorSeverity,
  DoctorStatus,
} from '../types/doctor.js';
import { getConfigValue } from '../config/config-loader.js';
import { getSecretVaultService } from '../services/secret-vault.js';

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
    description: 'Optional Telegram user ID bootstrap allowlist seed',
    severity: 'info',
    remediation:
      'Optional: set TELEGRAM_USER_ID to pre-authorize your own Telegram account before pairing approvals.',
  },
  {
    kind: 'env-var',
    name: 'API_SECRET',
    description: 'API secret for webhook callback authentication',
    severity: 'critical',
    remediation:
      'Generate a strong secret and set API_SECRET in your .env file. Example: openssl rand -hex 32',
  },
  {
    kind: 'env-var',
    name: 'OPENROUTER_API_KEY',
    description: 'Primary AI model provider routing',
    severity: 'warning',
    remediation: 'Get an OpenRouter key at https://openrouter.ai/keys and set OPENROUTER_API_KEY in .env.',
  },
  {
    kind: 'env-var',
    name: 'ELEVENLABS_API_KEY',
    description: 'Text-to-Speech voice synthesis',
    severity: 'warning',
    remediation: 'Get an ElevenLabs key at https://elevenlabs.io and set ELEVENLABS_API_KEY in .env.',
  },
  {
    kind: 'env-var',
    name: 'GEMINI_API_KEY',
    description: 'Fallback AI model provider',
    severity: 'info',
    remediation: 'Get a Gemini API key at https://aistudio.google.com and set GEMINI_API_KEY in .env.',
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

export const CONFIG_CHECKS: DoctorCheck[] = [
  {
    kind: 'config-schema',
    name: 'twinclaw.json',
    description: 'TwinClaw local JSON configuration schema',
    severity: 'critical',
    remediation: 'Run `node src/index.ts setup` to initialize or repair your configuration.',
  }
];

export const CHANNEL_CHECKS: DoctorCheck[] = [
  {
    kind: 'channel-auth',
    name: 'whatsapp',
    description: 'WhatsApp QR session linking state',
    severity: 'warning',
    remediation: 'Run `node src/index.ts channels login whatsapp` to link your device.',
  }
];

/** All built-in checks in default run order. */
export const DEFAULT_CHECKS: DoctorCheck[] = [
  ...BINARY_CHECKS,
  ...ENV_VAR_CHECKS,
  ...FILESYSTEM_CHECKS,
  ...CONFIG_CHECKS,
  ...CHANNEL_CHECKS,
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
  const secret = getSecretVaultService().readSecret(check.name);
  const value = secret ?? getConfigValue(check.name);
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

// ── Individual check executors ───────────────────────────────────────────────

/** @internal exported for testing */
export function checkConfigSchema(check: DoctorCheck): DoctorCheckResult {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {
      check,
      passed: false,
      message: `Config file not found at ${configPath}.`,
    };
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    JSON.parse(raw);
    return {
      check,
      passed: true,
      message: 'twinclaw.json config is valid JSON and accessible.',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      check,
      passed: false,
      message: `Config file is invalid JSON: ${msg}`,
    };
  }
}

/** @internal exported for testing */
export function checkChannelAuth(check: DoctorCheck): DoctorCheckResult {
  if (check.name === 'whatsapp') {
    const authDir = path.resolve('memory', 'whatsapp_auth');
    if (!existsSync(authDir)) {
      return {
        check,
        passed: false,
        message: 'WhatsApp auth session directory does not exist.',
      };
    }
    // simple heuristic: if it has files, it might be linked
    return {
      check,
      passed: true,
      message: 'WhatsApp auth session directory exists.',
    };
  }
  return {
    check,
    passed: false,
    message: `Unknown channel: ${check.name}`,
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
      case 'config-schema':
        return checkConfigSchema(check);
      case 'channel-auth':
        return checkChannelAuth(check);
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
