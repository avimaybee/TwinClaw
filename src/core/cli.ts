import { runDoctorChecks, formatDoctorReport } from './doctor.js';

// ── Help text ────────────────────────────────────────────────────────────────

const HELP_TEXT = `
Usage: node src/index.ts [command] [options]

Commands:
  doctor              Run diagnostics and validate prerequisites
  setup               Run the guided configuration wizard
  pairing             Manage DM pairing approvals (list/approve)
  secret <subcommand> Manage secrets in the secure vault
  channels <subcmd>   Manage messaging channels (e.g. login)
  --onboard           Run the interactive AI persona-building session

Options:
  --help, -h          Show this help message
  --json              Output in machine-readable JSON format (doctor only)

Examples:
  node src/index.ts doctor
  node src/index.ts doctor --json
  node src/index.ts setup
  node src/index.ts pairing list telegram
  node src/index.ts pairing approve telegram ABCD1234
  node src/index.ts secret list
  node src/index.ts secret set API_SECRET mysecret
  node src/index.ts secret rotate API_SECRET newsecret
  node src/index.ts secret revoke API_SECRET
  node src/index.ts secret doctor
`.trim();

// ── Command handlers ─────────────────────────────────────────────────────────

/**
 * Handle the `doctor` command.
 * Runs all diagnostic checks and emits a report.
 * Returns `true` when the command was recognized and handled.
 */
export function handleDoctorCli(argv: string[]): boolean {
  if (argv[0] !== 'doctor') return false;

  const asJson = argv.includes('--json');

  try {
    const report = runDoctorChecks();
    const output = formatDoctorReport(report, asJson);
    console.log(output);

    if (report.status === 'critical') {
      process.exitCode = 2;
    } else if (report.status === 'degraded') {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TwinClaw] Doctor check failed: ${message}`);
    process.exitCode = 1;
  }

  return true;
}

/**
 * Handle `--help` or `-h` flags.
 * Returns `true` when the flag was found.
 */
export function handleHelpCli(argv: string[]): boolean {
  if (!argv.includes('--help') && !argv.includes('-h')) return false;

  console.log(HELP_TEXT);
  process.exitCode = 0;
  return true;
}

/**
 * Guard against unknown or mistyped top-level commands.
 * Known commands are allowed to fall through to their own handlers.
 * Returns `true` and sets a non-zero exit code when an unknown command is detected.
 */
export function handleUnknownCommand(argv: string[]): boolean {
  if (argv.length === 0) return false;

  const command = argv[0];

  // Flags and known commands pass through
  const KNOWN_COMMANDS = new Set([
    'pairing',
    'secret',
    'doctor',
    'setup',
    'channels',
    '--onboard',
    '--help',
    '-h',
    '--json',
  ]);

  if (KNOWN_COMMANDS.has(command) || command.startsWith('--')) {
    return false;
  }

  console.error(`[TwinClaw] Unknown command: '${command}'`);
  console.error(`Run 'node src/index.ts --help' to see available commands.`);
  process.exitCode = 1;
  return true;
}
