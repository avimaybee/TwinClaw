import { MvpGateService } from '../services/mvp-gate.js';
import type { MvpGateReport } from '../types/mvp-gate.js';

interface ParsedArgs {
  healthUrl?: string;
  reportDir?: string;
  skipHealth: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { skipHealth: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--health-url' && next) {
      parsed.healthUrl = next;
      i += 1;
      continue;
    }
    if (token === '--report-dir' && next) {
      parsed.reportDir = next;
      i += 1;
      continue;
    }
    if (token === '--skip-health') {
      parsed.skipHealth = true;
      continue;
    }
  }

  return parsed;
}

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  tsx src/release/mvp-gate-cli.ts [--health-url <url>] [--report-dir <path>] [--skip-health]',
      '',
      'Flags:',
      '  --health-url <url>  Activate the api-health hard gate against this URL',
      '  --report-dir <path> Override the report output directory',
      '  --skip-health       Skip the api-health check entirely (default when --health-url is omitted)',
      '',
      'Exit codes:',
      '  0  go (all hard gates passed, no advisory failures)',
      '  1  no-go (one or more hard gates failed)',
      '  2  advisory-only (hard gates passed but advisory checks failed)',
    ].join('\n'),
  );
}

function printHumanSummary(report: MvpGateReport): void {
  const verdictLabel =
    report.verdict === 'go'
      ? '🟢 GO'
      : report.verdict === 'no-go'
        ? '🔴 NO-GO'
        : '🟡 ADVISORY-ONLY';

  console.error('');
  console.error('════════════════════════════════════════════════════════════');
  console.error(`  MVP Gate Report  ·  ${report.reportId}`);
  console.error(`  Verdict: ${verdictLabel}`);
  console.error('════════════════════════════════════════════════════════════');
  console.error('');
  console.error(`  ${report.summary}`);
  console.error('');

  if (report.failedHardGates.length > 0) {
    console.error('  ── Blocking Failures ───────────────────────────────────');
    for (const check of report.failedHardGates) {
      console.error(`  ❌  [${check.id}] ${check.detail}`);
    }
    console.error('');
  }

  if (report.advisoryFailures.length > 0) {
    console.error('  ── Advisory Failures (non-blocking) ────────────────────');
    for (const check of report.advisoryFailures) {
      console.error(`  ⚠️   [${check.id}] ${check.detail}`);
    }
    console.error('');
  }

  if (report.triage.length > 0) {
    console.error('  ── Triage & Next Actions ───────────────────────────────');
    for (const entry of report.triage) {
      const icon = entry.severity === 'blocker' ? '🔴' : '🟡';
      console.error(`  ${icon}  ${entry.checkId}`);
      console.error(`     Owner: ${entry.ownerTrack}`);
      console.error(`     Action: ${entry.nextAction}`);
      console.error('');
    }
  }

  const smokePass = report.smokeScenarios.filter((s) => s.pass).length;
  const smokeTotal = report.smokeScenarios.length;
  console.error(`  Smoke scenarios: ${smokePass}/${smokeTotal} passed`);
  console.error('');
  console.error(`  JSON report  → ${report.reportPath}`);
  console.error(`  MD report    → ${report.markdownPath}`);
  console.error('────────────────────────────────────────────────────────────');
  console.error('');
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const service = new MvpGateService({ reportDir: args.reportDir });

  const report = await service.runGate({
    healthUrl: args.skipHealth ? undefined : args.healthUrl,
  });

  // Machine-readable JSON → stdout
  console.log(JSON.stringify(report, null, 2));

  // Human-readable summary → stderr
  printHumanSummary(report);

  // Exit code conveys the verdict
  if (report.verdict === 'no-go') {
    process.exitCode = 1;
  } else if (report.verdict === 'advisory-only') {
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

void main();
