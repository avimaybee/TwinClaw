import type { MvpCriterionId, TriageSeverity } from '../types/mvp-gate.js';

// ─── Triage Ownership Map ─────────────────────────────────────────────────────

export const TRIAGE_OWNERSHIP: Record<
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

export const REQUIRED_SCRIPTS: string[] = [
  'build',
  'test',
  'start',
  'release:preflight',
  'release:prepare',
  'release:rollback',
];

// ─── Core Smoke Scenarios ─────────────────────────────────────────────────────

export type SmokeScenarioDef = {
  id: string;
  label: string;
  relativePaths: string[];
};

export const SMOKE_SCENARIOS: SmokeScenarioDef[] = [
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
