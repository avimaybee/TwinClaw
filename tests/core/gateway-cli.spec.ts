import { describe, expect, it } from 'vitest';
import {
  buildTailscaleInstructions,
  parseGatewayArgs,
  resolveGatewayContext,
  sanitizeServiceToken,
} from '../../src/core/gateway-cli.js';

describe('gateway-cli parsing', () => {
  it('parses lifecycle command options', () => {
    const parsed = parseGatewayArgs([
      'gateway',
      'install',
      '--instance',
      'alpha-prod',
      '--config',
      'C:\\tmp\\alpha.json',
      '--port',
      '19001',
    ]);

    expect(parsed.command).toBe('install');
    expect(parsed.instance).toBe('alpha-prod');
    expect(parsed.configPathOverride).toContain('alpha.json');
    expect(parsed.apiPortOverride).toBe(19001);
  });

  it('rejects unknown options', () => {
    expect(() => parseGatewayArgs(['gateway', 'status', '--mystery'])).toThrow(/unknown gateway option/i);
  });
});

describe('gateway-cli rendering', () => {
  it('rejects non-windows platforms', async () => {
    await expect(
      resolveGatewayContext(parseGatewayArgs(['gateway', 'install', '--instance', 'west']), 'aix'),
    ).rejects.toThrow(/windows only/i);
  });

  it('builds tailscale instructions for remote websocket access', async () => {
    const context = await resolveGatewayContext(
      parseGatewayArgs(['gateway', 'tailscale', '--instance', 'remote', '--port', '19999']),
      'win32',
    );
    const instructions = buildTailscaleInstructions(context);
    expect(instructions).toContain('tailscale funnel 19999');
    expect(instructions).toContain('ws://127.0.0.1:19999/ws');
    expect(instructions).toContain(context.serviceId);
  });
});

describe('sanitizeServiceToken', () => {
  it('normalizes unsupported characters', () => {
    expect(sanitizeServiceToken(' My Service@Prod ')).toBe('my-service-prod');
  });

  it('throws when token resolves to empty', () => {
    expect(() => sanitizeServiceToken('@@@')).toThrow(/invalid/i);
  });
});
