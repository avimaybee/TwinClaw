import { execSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigPath, readConfig } from '../config/config-loader.js';

type GatewayCommand =
  | 'install'
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'uninstall'
  | 'tailscale';

const GATEWAY_COMMANDS = new Set<GatewayCommand>([
  'install',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall',
  'tailscale',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const ENTRY_SCRIPT = path.join(PROJECT_ROOT, 'dist', 'index.js');
const BASE_SERVICE_ID = 'ai.twinclaw.gateway';
const BASE_SERVICE_LABEL = 'TwinClaw Gateway';
const DEFAULT_API_PORT = 18789;

export interface ParsedGatewayArgs {
  command: GatewayCommand;
  instance?: string;
  serviceName?: string;
  configPathOverride?: string;
  apiPortOverride?: number;
  asJson: boolean;
  deep: boolean;
}

export interface GatewayServiceContext extends ParsedGatewayArgs {
  platform: NodeJS.Platform;
  projectRoot: string;
  nodePath: string;
  entryScript: string;
  serviceId: string;
  serviceLabel: string;
  configPath: string;
  apiPort: number;
}

interface GatewayStatusResult {
  running: boolean;
  details: string;
  command: string;
}

function ensureCommand(input: string | undefined): GatewayCommand {
  if (!input || !GATEWAY_COMMANDS.has(input as GatewayCommand)) {
    throw new Error(
      `Unknown gateway command '${input ?? ''}'. Available commands: ${[...GATEWAY_COMMANDS].join(', ')}`,
    );
  }
  return input as GatewayCommand;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return next;
}

function parsePort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port '${raw}'. Expected integer in range 1-65535.`);
  }
  return parsed;
}

export function sanitizeServiceToken(raw: string): string {
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!token) {
    throw new Error(`Service token '${raw}' is invalid.`);
  }
  return token;
}

export function parseGatewayArgs(argv: string[]): ParsedGatewayArgs {
  if (argv[0] !== 'gateway') {
    throw new Error('Gateway parser expects argv beginning with "gateway".');
  }

  const parsed: ParsedGatewayArgs = {
    command: ensureCommand(argv[1]),
    asJson: false,
    deep: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--instance':
      case '-i':
        parsed.instance = sanitizeServiceToken(requireValue(argv, i, token));
        i += 1;
        break;
      case '--name':
        parsed.serviceName = sanitizeServiceToken(requireValue(argv, i, token));
        i += 1;
        break;
      case '--config':
        parsed.configPathOverride = requireValue(argv, i, token);
        i += 1;
        break;
      case '--port':
        parsed.apiPortOverride = parsePort(requireValue(argv, i, token));
        i += 1;
        break;
      case '--json':
        parsed.asJson = true;
        break;
      case '--deep':
        parsed.deep = true;
        break;
      default:
        throw new Error(`Unknown gateway option '${token}'.`);
    }
  }

  if (parsed.instance && parsed.serviceName) {
    throw new Error('Use either --instance or --name, not both.');
  }

  return parsed;
}

export function buildTailscaleInstructions(context: GatewayServiceContext): string {
  return `
TwinClaw Remote Access Setup
──────────────────────────────────────────────────
Gateway service : ${context.serviceId}
Config path     : ${context.configPath}
API port        : ${context.apiPort}
WebSocket path  : ws://127.0.0.1:${context.apiPort}/ws

Recommended (Tailscale Funnel):
  1. twinclaw gateway start${context.instance ? ` --instance ${context.instance}` : ''}
  2. tailscale funnel ${context.apiPort}
  3. Use the printed HTTPS URL and authenticate using your API_SECRET token.

Alternative (SSH tunnel):
  ssh -N -L ${context.apiPort}:127.0.0.1:${context.apiPort} <user>@<host>
  Then connect locally to ws://127.0.0.1:${context.apiPort}/ws

Never expose 0.0.0.0:${context.apiPort} directly to the public internet.
`;
}

function ensureWindowsPlatform(platform: NodeJS.Platform): void {
  if (platform !== 'win32') {
    throw new Error(
      `TwinClaw gateway commands support Windows only. Current platform '${platform}' is out of scope.`,
    );
  }
}

export async function resolveGatewayContext(
  parsed: ParsedGatewayArgs,
  platform: NodeJS.Platform = os.platform(),
): Promise<GatewayServiceContext> {
  ensureWindowsPlatform(platform);
  const configPath = getConfigPath(parsed.configPathOverride);

  let configPort = DEFAULT_API_PORT;
  try {
    const config = await readConfig(parsed.configPathOverride);
    if (Number.isInteger(config.runtime.apiPort)) {
      configPort = config.runtime.apiPort;
    }
  } catch {
    // If config is malformed, continue with defaults and explicit overrides.
  }

  const suffix = parsed.serviceName ?? parsed.instance ?? '';
  const serviceId = suffix ? `${BASE_SERVICE_ID}.${sanitizeServiceToken(suffix)}` : BASE_SERVICE_ID;
  const serviceLabel = suffix
    ? `${BASE_SERVICE_LABEL} (${sanitizeServiceToken(suffix)})`
    : BASE_SERVICE_LABEL;
  const apiPort = parsed.apiPortOverride ?? configPort;

  return {
    ...parsed,
    platform,
    projectRoot: PROJECT_ROOT,
    nodePath: process.execPath,
    entryScript: ENTRY_SCRIPT,
    serviceId,
    serviceLabel,
    configPath,
    apiPort,
  };
}

function runCommand(command: string, ignoreFailure = false): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (ignoreFailure) {
      const message = error instanceof Error ? error.message : String(error);
      return message.trim();
    }
    throw error;
  }
}

async function installWindowsService(context: GatewayServiceContext): Promise<void> {
  const nodeWindows = await import('node-windows');
  const svc = new nodeWindows.Service({
    name: context.serviceLabel,
    description: 'TwinClaw background gateway service',
    script: context.entryScript,
    env: [
      { name: 'NODE_ENV', value: 'production' },
      { name: 'API_PORT', value: String(context.apiPort) },
      { name: 'TWINCLAW_CONFIG_PATH', value: context.configPath },
    ],
  });

  await new Promise<void>((resolve, reject) => {
    svc.on('install', () => resolve());
    svc.on('alreadyinstalled', () => resolve());
    svc.on('error', (error: Error) => reject(error));
    svc.install();
  });
}

async function installService(context: GatewayServiceContext): Promise<void> {
  await installWindowsService(context);
}

async function startService(context: GatewayServiceContext): Promise<void> {
  const nodeWindows = await import('node-windows');
  const svc = new nodeWindows.Service({
    name: context.serviceLabel,
    description: 'TwinClaw background gateway service',
    script: context.entryScript,
  });
  await new Promise<void>((resolve, reject) => {
    svc.on('start', () => resolve());
    svc.on('error', (error: Error) => reject(error));
    svc.start();
  });
}

async function stopService(context: GatewayServiceContext): Promise<void> {
  const nodeWindows = await import('node-windows');
  const svc = new nodeWindows.Service({
    name: context.serviceLabel,
    description: 'TwinClaw background gateway service',
    script: context.entryScript,
  });
  await new Promise<void>((resolve, reject) => {
    svc.on('stop', () => resolve());
    svc.on('error', (error: Error) => reject(error));
    svc.stop();
  });
}

async function restartService(context: GatewayServiceContext): Promise<void> {
  await stopService(context);
  await startService(context);
}

async function uninstallService(context: GatewayServiceContext): Promise<void> {
  const nodeWindows = await import('node-windows');
  const svc = new nodeWindows.Service({
    name: context.serviceLabel,
    description: 'TwinClaw background gateway service',
    script: context.entryScript,
  });
  await new Promise<void>((resolve, reject) => {
    svc.on('uninstall', () => resolve());
    svc.on('alreadyuninstalled', () => resolve());
    svc.on('error', (error: Error) => reject(error));
    svc.uninstall();
  });
}

function queryStatus(context: GatewayServiceContext): GatewayStatusResult {
  const command = `sc query "${context.serviceLabel}"`;
  const details = runCommand(command, true);
  return { running: /\bRUNNING\b/.test(details), details, command };
}

function printStatus(context: GatewayServiceContext, status: GatewayStatusResult): void {
  const payload = {
    service: context.serviceId,
    label: context.serviceLabel,
    running: status.running,
    platform: context.platform,
    apiPort: context.apiPort,
    configPath: context.configPath,
    command: status.command,
    details: status.details,
  };

  if (context.asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `[TwinClaw] Gateway '${context.serviceId}' is ${status.running ? 'ACTIVE' : 'INACTIVE'} on ${context.platform}.`,
  );

  if (context.deep) {
    console.log(`Config Path : ${context.configPath}`);
    console.log(`API Port    : ${context.apiPort}`);
    console.log('Mode        : windows service');
    if (status.details.length > 0) {
      console.log('\nStatus details:');
      console.log(status.details);
    }
  }
}

function printGatewayUsage(): void {
  console.log(`Gateway command usage:
  gateway install [--instance <id>] [--name <suffix>] [--config <path>] [--port <num>]
  gateway start [--instance <id>] [--name <suffix>]
  gateway stop [--instance <id>] [--name <suffix>]
  gateway restart [--instance <id>] [--name <suffix>]
  gateway status [--instance <id>] [--name <suffix>] [--json | --deep]
  gateway uninstall [--instance <id>] [--name <suffix>]
  gateway tailscale [--instance <id>] [--name <suffix>] [--port <num>] [--config <path>]
`);
}

/**
 * Handle `gateway` lifecycle commands.
 */
export async function handleGatewayCli(argv: string[]): Promise<boolean> {
  if (argv[0] !== 'gateway') {
    return false;
  }

  try {
    const parsed = parseGatewayArgs(argv);
    const context = await resolveGatewayContext(parsed);

    switch (context.command) {
      case 'install':
        await installService(context);
        console.log(`[TwinClaw] Installed gateway service '${context.serviceId}'.`);
        break;
      case 'start':
        await startService(context);
        console.log(`[TwinClaw] Started gateway service '${context.serviceId}'.`);
        break;
      case 'stop':
        await stopService(context);
        console.log(`[TwinClaw] Stopped gateway service '${context.serviceId}'.`);
        break;
      case 'restart':
        await restartService(context);
        console.log(`[TwinClaw] Restarted gateway service '${context.serviceId}'.`);
        break;
      case 'status': {
        const status = queryStatus(context);
        printStatus(context, status);
        process.exitCode = status.running ? 0 : 1;
        break;
      }
      case 'uninstall':
        await uninstallService(context);
        console.log(`[TwinClaw] Uninstalled gateway service '${context.serviceId}'.`);
        break;
      case 'tailscale':
        console.log(buildTailscaleInstructions(context).trimStart());
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TwinClaw Gateway] ${message}`);
    printGatewayUsage();
    process.exitCode = 1;
  }

  return true;
}
