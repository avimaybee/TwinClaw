import { ReleasePipelineService } from '../services/release-pipeline.js';
import type { PreflightResult, ReleaseManifest, RollbackResult } from '../types/release.js';

interface ParsedArgs {
  command: string | undefined;
  healthUrl?: string;
  snapshotId?: string;
  restartCommand?: string;
  releaseId?: string;
  retentionLimit?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const parsed: ParsedArgs = { command };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = rest[index + 1];
    if (token === '--health-url' && next) {
      parsed.healthUrl = next;
      index += 1;
      continue;
    }
    if (token === '--snapshot' && next) {
      parsed.snapshotId = next;
      index += 1;
      continue;
    }
    if (token === '--restart-command' && next) {
      parsed.restartCommand = next;
      index += 1;
      continue;
    }
    if (token === '--release-id' && next) {
      parsed.releaseId = next;
      index += 1;
      continue;
    }
    if (token === '--retention' && next) {
      const parsedNumber = Number(next);
      if (Number.isFinite(parsedNumber) && parsedNumber >= 1) {
        parsed.retentionLimit = Math.floor(parsedNumber);
      }
      index += 1;
      continue;
    }
  }

  return parsed;
}

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  tsx src/release/cli.ts preflight [--health-url <url>]',
      '  tsx src/release/cli.ts prepare [--health-url <url>] [--release-id <id>] [--retention <n>]',
      '  tsx src/release/cli.ts rollback [--snapshot <id>] [--health-url <url>] [--restart-command "<cmd>"]',
    ].join('\n'),
  );
}

function printJson(payload: PreflightResult | ReleaseManifest | RollbackResult): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const service = new ReleasePipelineService();

  if (parsed.command === 'preflight') {
    const result = await service.runPreflight({ healthUrl: parsed.healthUrl });
    printJson(result);
    process.exitCode = result.passed ? 0 : 1;
    return;
  }

  if (parsed.command === 'prepare') {
    const manifest = await service.prepareRelease({
      healthUrl: parsed.healthUrl,
      releaseId: parsed.releaseId,
      retentionLimit: parsed.retentionLimit,
    });
    printJson(manifest);
    process.exitCode = manifest.status === 'ready' ? 0 : 1;
    return;
  }

  if (parsed.command === 'rollback') {
    const result = await service.rollback({
      snapshotId: parsed.snapshotId,
      healthUrl: parsed.healthUrl,
      restartCommand: parsed.restartCommand,
    });
    printJson(result);
    process.exitCode = result.status === 'failed' ? 1 : 0;
    return;
  }

  printUsage();
  process.exitCode = 1;
}

void main();
