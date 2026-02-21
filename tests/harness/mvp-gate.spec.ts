import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MvpGateService } from '../../src/services/mvp-gate.js';
import type { CommandExecutionResult } from '../../src/types/release.js';

// ─── Workspace Fixtures ───────────────────────────────────────────────────────

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-mvpgate-'));

  await mkdir(path.join(workspace, 'gui'), { recursive: true });
  await mkdir(path.join(workspace, 'src', 'interfaces'), { recursive: true });
  await mkdir(path.join(workspace, 'src', 'release'), { recursive: true });
  await mkdir(path.join(workspace, 'src', 'services'), { recursive: true });
  await mkdir(path.join(workspace, 'src', 'core'), { recursive: true });

  // Minimal package.json with all required MVP scripts
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({
      name: 'twinclaw-test',
      version: '9.9.9',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        start: 'tsx src/index.ts',
        'release:preflight': 'tsx src/release/cli.ts preflight',
        'release:prepare': 'tsx src/release/cli.ts prepare',
        'release:rollback': 'tsx src/release/cli.ts rollback',
      },
    }),
    'utf8',
  );

  await mkdir(path.join(workspace, 'dist'), { recursive: true });

  // Required files
  await writeFile(path.join(workspace, 'mcp-servers.json'), '{}', 'utf8');
  await writeFile(path.join(workspace, 'twinclaw.default.json'), '{}\n', 'utf8');
  await writeFile(
    path.join(workspace, 'gui', 'package.json'),
    JSON.stringify({ name: 'gui-test' }),
    'utf8',
  );
  await writeFile(path.join(workspace, 'src', 'interfaces', 'dispatcher.ts'), 'export {};', 'utf8');
  await writeFile(path.join(workspace, 'src', 'release', 'cli.ts'), 'export {};', 'utf8');
  await writeFile(path.join(workspace, 'src', 'services', 'db.ts'), 'export {};', 'utf8');
  await writeFile(path.join(workspace, 'src', 'core', 'gateway.ts'), 'export {};', 'utf8');
  await writeFile(path.join(workspace, 'src', 'core', 'onboarding.ts'), 'export {};', 'utf8');
  await writeFile(path.join(workspace, 'src', 'core', 'doctor.ts'), 'export {};', 'utf8');
  // Stub dist output so dist-artifact advisory passes
  await writeFile(path.join(workspace, 'dist', 'index.js'), 'export {};', 'utf8');

  return workspace;
}

// ─── Mock Factories ───────────────────────────────────────────────────────────

function passingRunner(): (command: string, _cwd: string) => Promise<CommandExecutionResult> {
  return async () => ({ ok: true, exitCode: 0, output: '', durationMs: 5 });
}

function failingRunner(
  commands: string[],
): (command: string, _cwd: string) => Promise<CommandExecutionResult> {
  return async (command: string) => {
    if (commands.some((c) => command.includes(c))) {
      return { ok: false, exitCode: 1, output: `${command} failed in mock`, durationMs: 5 };
    }
    return { ok: true, exitCode: 0, output: '', durationMs: 5 };
  };
}

function healthyProbe(): () => Promise<{ ok: boolean; detail: string }> {
  return async () => ({ ok: true, detail: 'Health OK' });
}

function unhealthyProbe(): () => Promise<{ ok: boolean; detail: string }> {
  return async () => ({ ok: false, detail: 'Health endpoint unreachable' });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('MvpGateService', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((ws) => rm(ws, { recursive: true, force: true })));
  });

  it('returns go verdict when all hard gates pass', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.verdict).toBe('go');
    expect(report.hardGatePassed).toBe(true);
    expect(report.failedHardGates).toHaveLength(0);
    expect(report.triage).toHaveLength(0);
  });

  it('returns no-go verdict when a hard gate fails', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: failingRunner(['npm run build']),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.verdict).toBe('no-go');
    expect(report.hardGatePassed).toBe(false);
    expect(report.failedHardGates.some((c) => c.id === 'build')).toBe(true);
    expect(report.triage.some((t) => t.checkId === 'build' && t.severity === 'blocker')).toBe(true);
  });

  it('returns no-go when tests fail and includes triage with owning track', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: failingRunner(['npm run test']),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.verdict).toBe('no-go');
    const testTriage = report.triage.find((t) => t.checkId === 'tests');
    expect(testTriage).toBeDefined();
    expect(testTriage?.ownerTrack).toContain('Track 36');
    expect(testTriage?.nextAction).toBeTruthy();
  });

  it('activates api-health hard gate when healthUrl is provided', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: unhealthyProbe(),
    });

    const report = await service.runGate({ healthUrl: 'http://localhost:3100/health' });

    expect(report.verdict).toBe('no-go');
    expect(report.failedHardGates.some((c) => c.id === 'api-health')).toBe(true);
  });

  it('skips api-health when no healthUrl is provided', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: unhealthyProbe(),
    });

    const report = await service.runGate(); // no healthUrl

    // api-health should not appear in checks at all
    expect(report.checks.some((c) => c.id === 'api-health')).toBe(false);
    expect(report.verdict).toBe('go');
  });

  it('fails npm-commands check when required scripts are missing', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    // Overwrite package.json without the release scripts
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'twinclaw-test', version: '1.0.0', scripts: { build: 'tsc', test: 'vitest run', start: 'tsx src/index.ts' } }),
      'utf8',
    );

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    const npmCheck = report.checks.find((c) => c.id === 'npm-commands');
    expect(npmCheck?.status).toBe('failed');
    expect(npmCheck?.detail).toContain('release:preflight');
  });

  it('fails cli-onboard check when src/core/onboarding.ts is missing', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    await rm(path.join(workspace, 'src', 'core', 'onboarding.ts'), { force: true });

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.verdict).toBe('no-go');
    const onboardCheck = report.checks.find((c) => c.id === 'cli-onboard');
    expect(onboardCheck?.status).toBe('failed');
  });

  it('returns advisory-only verdict when only advisory checks fail', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    // Remove doctor (doctor-readiness advisory) and no dist/ (dist-artifact advisory)
    await rm(path.join(workspace, 'src', 'core', 'doctor.ts'), { force: true });

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.hardGatePassed).toBe(true);
    expect(report.verdict).toBe('advisory-only');
    expect(report.advisoryFailures.some((c) => c.id === 'doctor-readiness')).toBe(true);
  });

  it('runs all smoke scenarios and reports file-level coverage', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    // All core files exist in the workspace, so all scenarios should pass
    expect(report.smokeScenarios.length).toBeGreaterThan(0);
    const failing = report.smokeScenarios.filter((s) => !s.pass);
    expect(failing).toHaveLength(0);
  });

  it('smoke scenario fails when a critical file is removed', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    await rm(path.join(workspace, 'twinclaw.default.json'), { force: true });

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    const configScenario = report.smokeScenarios.find((s) => s.id === 'core:config-template');
    expect(configScenario?.pass).toBe(false);
  });

  it('writes json and markdown reports to disk', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    // Verify report files were written
    const { readFile } = await import('node:fs/promises');
    const jsonContent = await readFile(report.reportPath, 'utf8');
    const mdContent = await readFile(report.markdownPath, 'utf8');

    expect(() => JSON.parse(jsonContent)).not.toThrow();
    expect(mdContent).toContain('MVP Gate Report');
    expect(mdContent).toContain('Hard Gate Checks');
    expect(mdContent).toContain('Smoke Scenario Matrix');
  });

  it('generates a summary with failed check ids for no-go verdict', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: failingRunner(['npm run build', 'npm run test']),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    expect(report.summary).toContain('blocked');
    expect(report.summary).toContain('build');
    expect(report.summary).toContain('tests');
  });

  it('includes dist-artifact advisory when dist/ is absent', async () => {
    const workspace = await createWorkspace();
    workspaces.push(workspace);

    // Remove dist/ to trigger the advisory failure
    await rm(path.join(workspace, 'dist'), { recursive: true, force: true });

    const service = new MvpGateService({
      workspaceRoot: workspace,
      commandRunner: passingRunner(),
      healthProbe: healthyProbe(),
    });

    const report = await service.runGate();

    const distCheck = report.checks.find((c) => c.id === 'dist-artifact');
    expect(distCheck).toBeDefined();
    expect(distCheck?.class).toBe('advisory');
    expect(distCheck?.status).toBe('failed');
  });
});
