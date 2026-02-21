import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandRunner, HealthProbe } from '../types/release.js';
import type {
  MvpCheckResult,
  MvpCriterionClass,
  MvpCriterionId,
  MvpGateOptions,
  MvpGateReport,
  MvpGateVerdict,
  MvpSmokeScenario,
  TriageEntry,
  TriageSeverity,
} from '../types/mvp-gate.js';
import { validateTwinclawConfigSchema } from '../release/twinclaw-config-schema.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

type PackageJson = {
  scripts?: Record<string, string>;
  name?: string;
  version?: string;
};

// ─── Triage Ownership Map ─────────────────────────────────────────────────────

const TRIAGE_OWNERSHIP: Record<
  MvpCriterionId,
  { severity: TriageSeverity; ownerTrack: string; nextAction: string }
> = {
  build: {
    severity: 'blocker',
    ownerTrack: 'Track 35: Build Contract Recovery & Compile Unblock',
    nextAction: 'Run `npm run build` and resolve TypeScript compiler errors before re-running the gate.',
  },
  tests: {
    severity: 'blocker',
    ownerTrack: 'Track 36: Test Harness FK Integrity & Suite Unblock',
    nextAction: 'Run `npm test` locally, fix failing specs, and ensure zero test failures before re-running the gate.',
  },
  'api-health': {
    severity: 'blocker',
    ownerTrack: 'Track 41: Runtime Health, Doctor & Readiness Surfaces',
    nextAction: 'Start the runtime (`npm start`) and verify GET /health returns {"data":{"status":"ok"}}.',
  },
  'config-schema': {
    severity: 'blocker',
    ownerTrack: 'Track 58: MVP Gate v2 (Deep Config/Vault Validation)',
    nextAction:
      'Fix twinclaw.json so it satisfies the required schema (runtime, models, messaging, storage, integration, tools).',
  },
  'vault-health': {
    severity: 'blocker',
    ownerTrack: 'Track 57: Secrets Hygiene & Credential Rotation Sweep',
    nextAction: 'Run `node src/index.ts secret doctor` and resolve degraded vault diagnostics before release.',
  },
  'interface-readiness': {
    severity: 'blocker',
    ownerTrack: 'Track 35: Build Contract Recovery & Compile Unblock',
    nextAction: 'Ensure `gui/package.json`, `src/interfaces/dispatcher.ts`, and `mcp-servers.json` all exist.',
  },
  'npm-commands': {
    severity: 'blocker',
    ownerTrack: 'Track 38: NPM Command Reliability Matrix & Script Repair',
    nextAction: 'Add the missing npm script(s) to package.json and verify each runs successfully.',
  },
  'cli-onboard': {
    severity: 'blocker',
    ownerTrack: 'Track 58: MVP Gate v2 (Deep Config/Vault Validation)',
    nextAction:
      'Run a non-interactive onboarding smoke command and ensure it generates a schema-valid config file.',
  },
  'dist-artifact': {
    severity: 'advisory',
    ownerTrack: 'Track 35: Build Contract Recovery & Compile Unblock',
    nextAction: 'Run `npm run build` to generate dist/ artifacts. Advisory only — does not block the gate.',
  },
  'test-coverage': {
    severity: 'advisory',
    ownerTrack: 'Track 43: Coverage Gap Closure for Messaging/MCP/Proactive/Observability',
    nextAction: 'Run `npm run test:coverage` and address gaps. Advisory only — does not block the gate.',
  },
  'doctor-readiness': {
    severity: 'advisory',
    ownerTrack: 'Track 23: CLI Hardening, User Onboarding & Doctor Diagnostics',
    nextAction: 'Ensure the doctor/onboarding entrypoint is wired in src/core/onboarding.ts. Advisory only.',
  },
};

// ─── Required MVP Scripts ─────────────────────────────────────────────────────

const REQUIRED_SCRIPTS: string[] = [
  'build',
  'test',
  'start',
  'release:preflight',
  'release:prepare',
  'release:rollback',
];

// ─── Core Smoke Scenarios ─────────────────────────────────────────────────────

type SmokeScenarioDef = {
  id: string;
  label: string;
  relativePaths: string[];
};

const SMOKE_SCENARIOS: SmokeScenarioDef[] = [
  {
    id: 'core:package-manifest',
    label: 'Root package.json exists',
    relativePaths: ['package.json'],
  },
  {
    id: 'core:mcp-config',
    label: 'MCP server config (mcp-servers.json) exists',
    relativePaths: ['mcp-servers.json'],
  },
  {
    id: 'core:config-template',
    label: 'Configuration template (twinclaw.default.json) exists',
    relativePaths: ['twinclaw.default.json'],
  },
  {
    id: 'runtime:interface-dispatcher',
    label: 'Interface dispatcher module exists',
    relativePaths: ['src/interfaces/dispatcher.ts'],
  },
  {
    id: 'runtime:release-cli',
    label: 'Release pipeline CLI entrypoint exists',
    relativePaths: ['src/release/cli.ts'],
  },
  {
    id: 'runtime:db-service',
    label: 'Database service module exists',
    relativePaths: ['src/services/db.ts'],
  },
  {
    id: 'runtime:gateway',
    label: 'Core gateway module exists',
    relativePaths: ['src/core/gateway.ts'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function compactTimestamp(now: () => Date): string {
  return now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function quoteCommandArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirNonEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function buildSummary(verdict: MvpGateVerdict, failedHardGates: MvpCheckResult[]): string {
  if (verdict === 'go') {
    return 'All MVP hard-gate criteria passed. The release is approved to proceed.';
  }
  if (verdict === 'advisory-only') {
    return 'All hard-gate criteria passed. One or more advisory checks are failing — review and address before next release cycle.';
  }
  const ids = failedHardGates.map((c) => c.id).join(', ');
  return `Release blocked. The following hard-gate(s) failed: ${ids}. Resolve the issues indicated in the triage section and re-run the gate.`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_HEALTH_URL = 'http://localhost:18789/health';

export interface MvpGateServiceOptions {
  workspaceRoot?: string;
  reportDir?: string;
  commandRunner?: CommandRunner;
  healthProbe?: HealthProbe;
  now?: () => Date;
  defaultHealthUrl?: string;
}

export class MvpGateService {
  readonly #workspaceRoot: string;
  readonly #reportDir: string;
  readonly #commandRunner: CommandRunner;
  readonly #healthProbe: HealthProbe;
  readonly #now: () => Date;
  readonly #defaultHealthUrl: string;

  constructor(options: MvpGateServiceOptions = {}) {
    this.#workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.#reportDir =
      options.reportDir ?? path.join(this.#workspaceRoot, 'memory', 'mvp-gate', 'reports');
    this.#commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.#healthProbe = options.healthProbe ?? defaultHealthProbe;
    this.#now = options.now ?? (() => new Date());
    this.#defaultHealthUrl = options.defaultHealthUrl ?? DEFAULT_HEALTH_URL;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async runGate(options: MvpGateOptions = {}): Promise<MvpGateReport> {
    await mkdir(this.#reportDir, { recursive: true });

    const reportId = `mvp_gate_${compactTimestamp(this.#now)}`;
    const checks: MvpCheckResult[] = [];

    // Hard gates — run in order of severity / dependency
    checks.push(await this.#runBuildCheck());
    checks.push(await this.#runTestsCheck());
    checks.push(await this.#runNpmCommandsCheck());
    checks.push(await this.#runConfigSchemaCheck());
    checks.push(await this.#runCliOnboardCheck(reportId));
    checks.push(await this.#runVaultHealthCheck());
    checks.push(await this.#runInterfaceReadinessCheck());

    // api-health is a hard gate by default (uses default URL if not provided)
    if (!options.skipHealth) {
      const healthUrl = options.healthUrl ?? this.#defaultHealthUrl;
      checks.push(await this.#runHealthCheck(healthUrl));
    }

    // Advisory checks
    checks.push(await this.#runDistArtifactCheck());
    checks.push(await this.#runTestCoverageCheck());
    checks.push(await this.#runDoctorReadinessCheck());

    // Smoke scenarios
    const smokeScenarios = await this.#runSmokeScenarios();

    // Compute verdict
    const failedHardGates = checks.filter(
      (c) => c.class === 'hard-gate' && c.status === 'failed',
    );
    const advisoryFailures = checks.filter(
      (c) => c.class === 'advisory' && c.status === 'failed',
    );

    let verdict: MvpGateVerdict;
    if (failedHardGates.length > 0) {
      verdict = 'no-go';
    } else if (advisoryFailures.length > 0) {
      verdict = 'advisory-only';
    } else {
      verdict = 'go';
    }

    const triage = this.#buildTriage([...failedHardGates, ...advisoryFailures]);
    const summary = buildSummary(verdict, failedHardGates);

    const reportPath = path.join(this.#reportDir, `${reportId}.json`);
    const markdownPath = path.join(this.#reportDir, `${reportId}.md`);

    const report: MvpGateReport = {
      reportVersion: 1,
      reportId,
      generatedAt: nowIso(this.#now),
      verdict,
      hardGatePassed: failedHardGates.length === 0,
      checks,
      failedHardGates,
      advisoryFailures,
      smokeScenarios,
      triage,
      summary,
      reportPath,
      markdownPath,
    };

    await this.#writeReport(report);
    return report;
  }

  // ── Hard Gate Checks ────────────────────────────────────────────────────────

  async #runBuildCheck(): Promise<MvpCheckResult> {
    return this.#runCommandCheck('build', 'hard-gate', 'npm run build', 'TypeScript build');
  }

  async #runTestsCheck(): Promise<MvpCheckResult> {
    return this.#runCommandCheck('tests', 'hard-gate', 'npm run test', 'Test suite');
  }

  async #runNpmCommandsCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();

    try {
      const pkgPath = path.join(this.#workspaceRoot, 'package.json');
      const raw = await readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as PackageJson;
      const scripts = pkg.scripts ?? {};
      const missing = REQUIRED_SCRIPTS.filter((s) => !Object.prototype.hasOwnProperty.call(scripts, s));

      return {
        id: 'npm-commands',
        class: 'hard-gate',
        status: missing.length === 0 ? 'passed' : 'failed',
        detail:
          missing.length === 0
            ? `All ${REQUIRED_SCRIPTS.length} required npm scripts are defined.`
            : `Missing required npm scripts: ${missing.join(', ')}`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
        artifacts: [`package.json#scripts`],
      };
    } catch (error: unknown) {
      return {
        id: 'npm-commands',
        class: 'hard-gate',
        status: 'failed',
        detail: `Unable to read package.json: ${error instanceof Error ? error.message : String(error)}`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }
  }

  async #runConfigSchemaCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const configPath = path.join(this.#workspaceRoot, 'twinclaw.json');

    if (!(await pathExists(configPath))) {
      return {
        id: 'config-schema',
        class: 'hard-gate',
        status: 'failed',
        detail: 'twinclaw.json is missing.',
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }

    try {
      const raw = await readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const validation = validateTwinclawConfigSchema(parsed);

      return {
        id: 'config-schema',
        class: 'hard-gate',
        status: validation.valid ? 'passed' : 'failed',
        detail: validation.valid
          ? 'twinclaw.json satisfies the required schema.'
          : `twinclaw.json schema validation failed: ${validation.errors.slice(0, 4).join(' | ')}`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
        artifacts: [configPath],
      };
    } catch (error: unknown) {
      return {
        id: 'config-schema',
        class: 'hard-gate',
        status: 'failed',
        detail: `Unable to parse twinclaw.json: ${error instanceof Error ? error.message : String(error)}`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }
  }

  async #runCliOnboardCheck(reportId: string): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const onboardPath = path.join(this.#workspaceRoot, 'src', 'core', 'onboarding.ts');
    const exists = await pathExists(onboardPath);
    if (!exists) {
      return {
        id: 'cli-onboard',
        class: 'hard-gate',
        status: 'failed',
        detail: 'src/core/onboarding.ts is missing — the interactive wizard is required for MVP setup.',
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }

    const smokeConfigPath = path.join(this.#reportDir, `${reportId}.onboard-smoke.json`);
    const command = [
      'npm run start -- onboard --non-interactive',
      `--config ${quoteCommandArg(smokeConfigPath)}`,
      '--api-secret mvp-gate-smoke-secret',
      '--openrouter-api-key mvp-gate-smoke-model',
      '--embedding-provider openai',
      '--api-port 3100',
    ].join(' ');

    try {
      const run = await this.#commandRunner(command, this.#workspaceRoot);
      if (!run.ok) {
        return {
          id: 'cli-onboard',
          class: 'hard-gate',
          status: 'failed',
          detail: `Onboarding smoke run failed (exit ${run.exitCode}). ${run.output.trim().split('\n').slice(-5).join('\n')}`,
          command,
          startedAt,
          completedAt: nowIso(this.#now),
          durationMs: run.durationMs,
          artifacts: ['src/core/onboarding.ts'],
        };
      }

      if (!(await pathExists(smokeConfigPath))) {
        return {
          id: 'cli-onboard',
          class: 'hard-gate',
          status: 'failed',
          detail: 'Onboarding smoke run succeeded but did not produce a config artifact.',
          command,
          startedAt,
          completedAt: nowIso(this.#now),
          durationMs: run.durationMs,
          artifacts: ['src/core/onboarding.ts'],
        };
      }

      const generatedRaw = await readFile(smokeConfigPath, 'utf8');
      const generatedConfig = JSON.parse(generatedRaw) as unknown;
      const validation = validateTwinclawConfigSchema(generatedConfig);
      if (!validation.valid) {
        return {
          id: 'cli-onboard',
          class: 'hard-gate',
          status: 'failed',
          detail: `Onboarding output failed schema validation: ${validation.errors.slice(0, 4).join(' | ')}`,
          command,
          startedAt,
          completedAt: nowIso(this.#now),
          durationMs: run.durationMs,
          artifacts: ['src/core/onboarding.ts', smokeConfigPath],
        };
      }

      return {
        id: 'cli-onboard',
        class: 'hard-gate',
        status: 'passed',
        detail: 'Onboarding smoke run generated a schema-valid config artifact.',
        command,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: run.durationMs,
        artifacts: ['src/core/onboarding.ts'],
      };
    } catch (error: unknown) {
      return {
        id: 'cli-onboard',
        class: 'hard-gate',
        status: 'failed',
        detail: `Onboarding smoke run crashed: ${error instanceof Error ? error.message : String(error)}`,
        command,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
        artifacts: ['src/core/onboarding.ts'],
      };
    } finally {
      await rm(smokeConfigPath, { force: true });
    }
  }

  async #runVaultHealthCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const command = 'npm run start -- secret doctor';
    const run = await this.#commandRunner(command, this.#workspaceRoot);

    if (!run.ok) {
      return {
        id: 'vault-health',
        class: 'hard-gate',
        status: 'failed',
        detail: `Secret vault doctor command failed (exit ${run.exitCode}). ${run.output.trim().split('\n').slice(-5).join('\n')}`,
        command,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: run.durationMs,
      };
    }

    const match = run.output.match(/Secret vault status:\s*(\w+)/i);
    const status = match?.[1]?.toLowerCase();
    if (status && status !== 'ok') {
      return {
        id: 'vault-health',
        class: 'hard-gate',
        status: 'failed',
        detail: `Secret vault doctor reported non-healthy status: ${status}.`,
        command,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: run.durationMs,
      };
    }

    return {
      id: 'vault-health',
      class: 'hard-gate',
      status: 'passed',
      detail: status === 'ok'
        ? 'Secret vault doctor reported healthy status.'
        : 'Secret vault doctor command succeeded.',
      command,
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: run.durationMs,
    };
  }

  async #runInterfaceReadinessCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const required: string[] = [
      path.join(this.#workspaceRoot, 'gui', 'package.json'),
      path.join(this.#workspaceRoot, 'src', 'interfaces', 'dispatcher.ts'),
      path.join(this.#workspaceRoot, 'mcp-servers.json'),
    ];

    const missing: string[] = [];
    for (const target of required) {
      if (!(await pathExists(target))) {
        missing.push(path.relative(this.#workspaceRoot, target));
      }
    }

    return {
      id: 'interface-readiness',
      class: 'hard-gate',
      status: missing.length === 0 ? 'passed' : 'failed',
      detail:
        missing.length === 0
          ? 'All critical interface assets are present.'
          : `Missing critical interface assets: ${missing.join(', ')}`,
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: Date.now() - started,
    };
  }

  async #runHealthCheck(healthUrl: string): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const probe = await this.#healthProbe(healthUrl);

    return {
      id: 'api-health',
      class: 'hard-gate',
      status: probe.ok ? 'passed' : 'failed',
      detail: probe.detail,
      command: `GET ${healthUrl}`,
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: Date.now() - started,
    };
  }

  // ── Advisory Checks ─────────────────────────────────────────────────────────

  async #runDistArtifactCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const distPath = path.join(this.#workspaceRoot, 'dist');
    const exists = await pathExists(distPath);
    const nonEmpty = exists && (await isDirNonEmpty(distPath));

    return {
      id: 'dist-artifact',
      class: 'advisory',
      status: nonEmpty ? 'passed' : 'failed',
      detail: nonEmpty
        ? 'dist/ directory exists and contains build artifacts.'
        : exists
          ? 'dist/ directory exists but is empty — run `npm run build` to populate it.'
          : 'dist/ directory is absent — run `npm run build` first.',
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: Date.now() - started,
      artifacts: nonEmpty ? [distPath] : undefined,
    };
  }

  async #runTestCoverageCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const summaryPath = path.join(this.#workspaceRoot, 'coverage', 'coverage-summary.json');
    const exists = await pathExists(summaryPath);

    if (!exists) {
      return {
        id: 'test-coverage',
        class: 'advisory',
        status: 'skipped',
        detail: 'No coverage summary found. Run `npm run test:coverage` to generate one.',
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }

    try {
      const raw = await readFile(summaryPath, 'utf8');
      const summary = JSON.parse(raw) as Record<string, Record<string, { pct: number }>>;
      const total = summary.total;
      if (!total) {
        return {
          id: 'test-coverage',
          class: 'advisory',
          status: 'failed',
          detail: 'Coverage summary is malformed — missing "total" entry.',
          startedAt,
          completedAt: nowIso(this.#now),
          durationMs: Date.now() - started,
          artifacts: [summaryPath],
        };
      }

      const lines = total.lines?.pct ?? 0;
      const functions = total.functions?.pct ?? 0;
      const branches = total.branches?.pct ?? 0;
      const statements = total.statements?.pct ?? 0;

      const MIN_THRESHOLD = 25;
      const failing = [
        lines < MIN_THRESHOLD ? `lines: ${lines}% < ${MIN_THRESHOLD}%` : null,
        functions < MIN_THRESHOLD ? `functions: ${functions}% < ${MIN_THRESHOLD}%` : null,
        branches < MIN_THRESHOLD ? `branches: ${branches}% < ${MIN_THRESHOLD}%` : null,
        statements < MIN_THRESHOLD ? `statements: ${statements}% < ${MIN_THRESHOLD}%` : null,
      ].filter((v): v is string => v !== null);

      return {
        id: 'test-coverage',
        class: 'advisory',
        status: failing.length === 0 ? 'passed' : 'failed',
        detail:
          failing.length === 0
            ? `Coverage meets thresholds: lines ${lines}%, functions ${functions}%, branches ${branches}%, statements ${statements}%.`
            : `Coverage below threshold: ${failing.join('; ')}.`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
        artifacts: [summaryPath],
      };
    } catch (error: unknown) {
      return {
        id: 'test-coverage',
        class: 'advisory',
        status: 'failed',
        detail: `Failed to parse coverage summary: ${error instanceof Error ? error.message : String(error)}`,
        startedAt,
        completedAt: nowIso(this.#now),
        durationMs: Date.now() - started,
      };
    }
  }

  async #runDoctorReadinessCheck(): Promise<MvpCheckResult> {
    const startedAt = nowIso(this.#now);
    const started = Date.now();
    const doctorPath = path.join(this.#workspaceRoot, 'src', 'core', 'doctor.ts');
    const exists = await pathExists(doctorPath);

    return {
      id: 'doctor-readiness',
      class: 'advisory',
      status: exists ? 'passed' : 'failed',
      detail: exists
        ? 'Doctor diagnostics module is present (src/core/doctor.ts).'
        : 'Doctor module is missing — Track 23 should wire the system diagnostic logic.',
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: Date.now() - started,
      artifacts: exists ? [doctorPath] : undefined,
    };
  }

  // ── Smoke Scenarios ─────────────────────────────────────────────────────────

  async #runSmokeScenarios(): Promise<MvpSmokeScenario[]> {
    const results: MvpSmokeScenario[] = [];

    for (const scenario of SMOKE_SCENARIOS) {
      const allExist = await Promise.all(
        scenario.relativePaths.map((rel) => pathExists(path.join(this.#workspaceRoot, rel))),
      );
      const pass = allExist.every(Boolean);
      const missing = scenario.relativePaths.filter((_, i) => !allExist[i]);

      results.push({
        id: scenario.id,
        label: scenario.label,
        pass,
        detail: pass
          ? `${scenario.label}: OK`
          : `${scenario.label}: missing file(s): ${missing.join(', ')}`,
      });
    }

    return results;
  }

  // ── Shared Command Check ────────────────────────────────────────────────────

  async #runCommandCheck(
    id: MvpCriterionId,
    criterionClass: MvpCriterionClass,
    command: string,
    label: string,
  ): Promise<MvpCheckResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const run = await this.#commandRunner(command, this.#workspaceRoot);

    return {
      id,
      class: criterionClass,
      status: run.ok ? 'passed' : 'failed',
      detail: run.ok
        ? `${label} passed.`
        : `${label} failed (exit ${run.exitCode}). ${run.output.trim().split('\n').slice(-5).join('\n')}`,
      command,
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: run.durationMs,
    };
  }

  // ── Triage Builder ──────────────────────────────────────────────────────────

  #buildTriage(failedChecks: MvpCheckResult[]): TriageEntry[] {
    return failedChecks.map((check) => {
      const ownership = TRIAGE_OWNERSHIP[check.id];
      return {
        checkId: check.id,
        severity: ownership.severity,
        ownerTrack: ownership.ownerTrack,
        detail: check.detail,
        nextAction: ownership.nextAction,
      };
    });
  }

  // ── Report Writers ──────────────────────────────────────────────────────────

  async #writeReport(report: MvpGateReport): Promise<void> {
    await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(report.markdownPath, buildMarkdownReport(report), 'utf8');

    const latestPath = path.join(this.#reportDir, 'latest.json');
    await writeFile(
      latestPath,
      `${JSON.stringify(
        {
          reportId: report.reportId,
          reportPath: report.reportPath,
          markdownPath: report.markdownPath,
          generatedAt: report.generatedAt,
          verdict: report.verdict,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
}

// ─── Markdown Report Builder ──────────────────────────────────────────────────

function checkStatusIcon(status: string): string {
  if (status === 'passed') return '✅';
  if (status === 'failed') return '❌';
  return '⏭️';
}

function verdictBadge(verdict: MvpGateVerdict): string {
  if (verdict === 'go') return '🟢 **GO**';
  if (verdict === 'no-go') return '🔴 **NO-GO**';
  return '🟡 **ADVISORY-ONLY**';
}

function buildMarkdownReport(report: MvpGateReport): string {
  const lines: string[] = [];

  lines.push(`# MVP Gate Report — ${report.reportId}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Verdict** | ${verdictBadge(report.verdict)} |`);
  lines.push(`| Generated | ${report.generatedAt} |`);
  lines.push(`| Hard Gates | ${report.hardGatePassed ? '✅ All passed' : `❌ ${report.failedHardGates.length} failed`} |`);
  lines.push(`| Advisory Failures | ${report.advisoryFailures.length} |`);
  lines.push('');
  lines.push(`**Summary:** ${report.summary}`);
  lines.push('');

  // ── Hard Gate Results ──
  lines.push('## Hard Gate Checks');
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('|---|---|---|');
  for (const check of report.checks.filter((c) => c.class === 'hard-gate')) {
    lines.push(`| \`${check.id}\` | ${checkStatusIcon(check.status)} ${check.status} | ${check.detail.replace(/\n/g, ' ')} |`);
  }
  lines.push('');

  // ── Advisory Check Results ──
  lines.push('## Advisory Checks');
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('|---|---|---|');
  for (const check of report.checks.filter((c) => c.class === 'advisory')) {
    lines.push(`| \`${check.id}\` | ${checkStatusIcon(check.status)} ${check.status} | ${check.detail.replace(/\n/g, ' ')} |`);
  }
  lines.push('');

  // ── Smoke Scenarios ──
  lines.push('## Smoke Scenario Matrix');
  lines.push('');
  lines.push('| Scenario | Result | Detail |');
  lines.push('|---|---|---|');
  for (const scenario of report.smokeScenarios) {
    const icon = scenario.pass ? '✅' : '❌';
    lines.push(`| ${scenario.label} | ${icon} ${scenario.pass ? 'pass' : 'fail'} | ${scenario.detail} |`);
  }
  lines.push('');

  // ── Triage ──
  if (report.triage.length > 0) {
    lines.push('## Failure Triage');
    lines.push('');
    for (const entry of report.triage) {
      lines.push(`### \`${entry.checkId}\` — ${entry.severity === 'blocker' ? '🔴 Blocker' : '🟡 Advisory'}`);
      lines.push(`- **Owner:** ${entry.ownerTrack}`);
      lines.push(`- **Detail:** ${entry.detail}`);
      lines.push(`- **Next Action:** ${entry.nextAction}`);
      lines.push('');
    }
  } else {
    lines.push('## Failure Triage');
    lines.push('');
    lines.push('No failures — all checks passed or were skipped.');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Default Implementations ──────────────────────────────────────────────────

async function defaultCommandRunner(command: string, cwd: string): Promise<{
  ok: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
}> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const started = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { ok: true, exitCode: 0, output, durationMs: Date.now() - started };
  } catch (error: unknown) {
    type ExecError = Error & { code?: number | null; stdout?: string; stderr?: string };
    const err = error as ExecError;
    const output = [err.stdout, err.stderr, err.message]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join('\n')
      .trim();
    return {
      ok: false,
      exitCode: typeof err.code === 'number' ? err.code : 1,
      output,
      durationMs: Date.now() - started,
    };
  }
}

async function defaultHealthProbe(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { ok: false, detail: `Health endpoint returned HTTP ${response.status}.` };
    }
    return { ok: true, detail: `Health endpoint reachable (HTTP ${response.status}).` };
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `Health probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
