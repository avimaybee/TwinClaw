import { getSecretVaultService, type SecretVaultService } from '../services/secret-vault.js';
import { validateRuntimeConfig } from '../config/env-validator.js';
import type { SecretScope, SecretSource } from '../types/secret-vault.js';

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionalNumber(args: string[], flag: string): number | undefined {
  const value = readOption(args, flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(`Secret vault commands:
  secret list
  secret doctor
  secret set <NAME> <VALUE> [--scope <scope>] [--source <source>] [--required] [--rotation-hours <n>] [--warning-hours <n>] [--expires-at <ISO8601>]
  secret rotate <NAME> <NEXT_VALUE> [--reason <text>] [--rotation-hours <n>] [--warning-hours <n>] [--expires-at <ISO8601>]
  secret revoke <NAME> [--reason <text>]
  config doctor`);
}

function runList(service: SecretVaultService): void {
  const secrets = service.listSecrets();
  if (secrets.length === 0) {
    console.log('No secrets registered.');
    return;
  }

  for (const secret of secrets) {
    console.log(
      `${secret.name}\tstatus=${secret.status}\tscope=${secret.scope}\tsource=${secret.source}\t` +
        `required=${secret.required}\tversion=${secret.version}\t` +
        `lastRotated=${secret.lastRotatedAt ?? 'n/a'}\texpires=${secret.expiresAt ?? 'none'}`,
    );
  }
}

function runDoctor(service: SecretVaultService): void {
  const diagnostics = service.getDiagnostics();
  const status = diagnostics.health.hasIssues ? 'degraded' : 'ok';

  console.log(`Secret vault status: ${status}`);
  console.log(
    `Totals: total=${diagnostics.total}, active=${diagnostics.active}, expired=${diagnostics.expired}, revoked=${diagnostics.revoked}`,
  );

  if (diagnostics.health.missingRequired.length > 0) {
    console.log(`Missing required: ${diagnostics.health.missingRequired.join(', ')}`);
  }
  if (diagnostics.health.expired.length > 0) {
    console.log(`Expired: ${diagnostics.health.expired.join(', ')}`);
  }
  if (diagnostics.health.warnings.length > 0) {
    console.log(`Warnings: ${diagnostics.health.warnings.join(' | ')}`);
  }
  if (diagnostics.dueForRotation.length > 0) {
    console.log(`Due for rotation: ${diagnostics.dueForRotation.join(', ')}`);
  }
}

function runSet(service: SecretVaultService, args: string[]): void {
  const name = args[0];
  const value = args[1];
  if (!name || !value) {
    throw new Error('Usage: secret set <NAME> <VALUE> [...options]');
  }

  const scope = readOption(args, '--scope') as SecretScope | undefined;
  const source = readOption(args, '--source') as SecretSource | undefined;
  const metadata = service.setSecret({
    name,
    value,
    scope,
    source,
    required: hasFlag(args, '--required'),
    rotationWindowHours: parseOptionalNumber(args, '--rotation-hours'),
    warningWindowHours: parseOptionalNumber(args, '--warning-hours'),
    expiresAt: readOption(args, '--expires-at'),
  });

  console.log(
    `Secret '${metadata.name}' saved. version=${metadata.version}, status=${metadata.status}, expires=${metadata.expiresAt ?? 'none'}.`,
  );
}

function runRotate(service: SecretVaultService, args: string[]): void {
  const name = args[0];
  const nextValue = args[1];
  if (!name || !nextValue) {
    throw new Error('Usage: secret rotate <NAME> <NEXT_VALUE> [...options]');
  }

  const metadata = service.rotateSecret({
    name,
    nextValue,
    reason: readOption(args, '--reason'),
    rotationWindowHours: parseOptionalNumber(args, '--rotation-hours'),
    warningWindowHours: parseOptionalNumber(args, '--warning-hours'),
    expiresAt: readOption(args, '--expires-at'),
  });

  console.log(
    `Secret '${metadata.name}' rotated. version=${metadata.version}, status=${metadata.status}, expires=${metadata.expiresAt ?? 'none'}.`,
  );
}

function runRevoke(service: SecretVaultService, args: string[]): void {
  const name = args[0];
  if (!name) {
    throw new Error('Usage: secret revoke <NAME> [--reason <text>]');
  }

  const metadata = service.revokeSecret({
    name,
    reason: readOption(args, '--reason'),
  });

  console.log(`Secret '${metadata.name}' revoked.`);
}

function runConfigDoctor(): void {
  const result = validateRuntimeConfig();
  const overallStatus = result.ok ? 'ok' : 'degraded';

  console.log(`Config validation status: ${overallStatus}`);
  console.log(`Validated at: ${result.validatedAt}`);
  console.log(`Present keys (${result.presentKeys.length}): ${result.presentKeys.join(', ') || 'none'}`);

  if (result.activeFeatures.length > 0) {
    console.log(`Active features: ${result.activeFeatures.join(', ')}`);
  }

  if (result.issues.length === 0) {
    console.log('No config issues detected.');
    return;
  }

  if (result.fatalIssues.length > 0) {
    console.log(`\nFatal issues (${result.fatalIssues.length}):`);
    for (const issue of result.fatalIssues) {
      console.log(`  [${issue.key}] ${issue.message}`);
      console.log(`    Remediation: ${issue.remediation}`);
    }
  }

  const nonFatal = result.issues.filter((i) => i.class !== 'missing_required');
  if (nonFatal.length > 0) {
    console.log(`\nWarnings (${nonFatal.length}):`);
    for (const issue of nonFatal) {
      console.log(`  [${issue.class}] [${issue.key}] ${issue.message}`);
      console.log(`    Remediation: ${issue.remediation}`);
    }
  }
}

/**
 * Handles one-shot secret and config CLI workflows.
 * Returns true when invocation was recognized (handled or failed), false otherwise.
 */
export function handleSecretVaultCli(
  argv: string[],
  service: SecretVaultService = getSecretVaultService(),
): boolean {
  const topCommand = argv[0];

  // ── config subcommands ─────────────────────────────────────────────────────
  if (topCommand === 'config') {
    const subcommand = argv[1];
    try {
      switch (subcommand) {
        case 'doctor':
          runConfigDoctor();
          return true;
        default:
          console.log('Config commands:\n  config doctor');
          process.exitCode = 1;
          return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Config command failed: ${message}`);
      process.exitCode = 1;
      return true;
    }
  }

  if (topCommand !== 'secret') {
    return false;
  }

  const command = argv[1];
  const commandArgs = argv.slice(2);

  try {
    switch (command) {
      case 'list':
        runList(service);
        return true;
      case 'doctor':
        runDoctor(service);
        return true;
      case 'set':
        runSet(service, commandArgs);
        return true;
      case 'rotate':
        runRotate(service, commandArgs);
        return true;
      case 'revoke':
        runRevoke(service, commandArgs);
        return true;
      default:
        printUsage();
        process.exitCode = 1;
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Secret vault command failed: ${message}`);
    process.exitCode = 1;
    return true;
  }
}
