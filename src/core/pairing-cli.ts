import {
  DmPairingService,
  getDmPairingService,
  isPairingChannel,
  type PairingChannel,
} from '../services/dm-pairing.js';

function printPairingUsage(): void {
  console.log(`Pairing commands:
  pairing list <channel>
  pairing approve <channel> <CODE>

Supported channels: telegram, whatsapp`);
}

function parseChannel(input: string | undefined): PairingChannel {
  if (!input) {
    throw new Error('Missing channel. Use: pairing <list|approve> <channel>.');
  }
  const normalized = input.trim().toLowerCase();
  if (!isPairingChannel(normalized)) {
    throw new Error(`Unsupported channel '${input}'. Supported channels: telegram, whatsapp.`);
  }
  return normalized;
}

function runPairingList(service: DmPairingService, channel: PairingChannel): void {
  const requests = service.listPending(channel);
  if (requests.length === 0) {
    console.log(`No pending pairing requests for channel '${channel}'.`);
    return;
  }

  console.log(`Pending pairing requests for '${channel}' (${requests.length}):`);
  for (const request of requests) {
    console.log(
      `  code=${request.code}\tsender=${request.senderId}\texpires=${request.expiresAt}`,
    );
  }
}

function runPairingApprove(
  service: DmPairingService,
  channel: PairingChannel,
  code: string | undefined,
): void {
  if (!code) {
    throw new Error('Missing pairing code. Use: pairing approve <channel> <CODE>.');
  }

  const result = service.approve(channel, code);
  switch (result.status) {
    case 'approved':
      console.log(
        `Approved sender '${result.senderId}' for channel '${channel}' using code '${code.toUpperCase()}'.`,
      );
      return;
    case 'expired':
      throw new Error(`Pairing code '${code.toUpperCase()}' is expired for channel '${channel}'.`);
    case 'not_found':
      throw new Error(`Pairing code '${code.toUpperCase()}' not found for channel '${channel}'.`);
  }
}

/**
 * Handle one-shot pairing commands.
 * Returns true when invocation was recognized (handled or failed), false otherwise.
 */
export function handlePairingCli(
  argv: string[],
  service: DmPairingService = getDmPairingService(),
): boolean {
  if (argv[0] !== 'pairing') {
    return false;
  }

  const command = argv[1];

  try {
    switch (command) {
      case 'list': {
        const channel = parseChannel(argv[2]);
        runPairingList(service, channel);
        return true;
      }
      case 'approve': {
        const channel = parseChannel(argv[2]);
        runPairingApprove(service, channel, argv[3]);
        return true;
      }
      default:
        printPairingUsage();
        process.exitCode = 1;
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pairing command failed: ${message}`);
    process.exitCode = 1;
    return true;
  }
}
