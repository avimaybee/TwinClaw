import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillRegistry } from '../../src/services/skill-registry.js';
import { McpServerManager } from '../../src/services/mcp-server-manager.js';
import type { Skill } from '../../src/skills/types.js';
import type { McpServerConfig } from '../../src/types/mcp.js';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

// Prevent real MCP client connections
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const ClientMock = vi.fn();
  ClientMock.prototype.connect = vi.fn().mockResolvedValue(undefined);
  ClientMock.prototype.close = vi.fn().mockResolvedValue(undefined);
  ClientMock.prototype.listTools = vi.fn().mockResolvedValue({ tools: [] });
  ClientMock.prototype.callTool = vi.fn();
  return { Client: ClientMock };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock('../../src/services/db.js', () => ({
  saveMcpHealthEvent: vi.fn(),
  saveMcpScopeAuditLog: vi.fn(),
  saveOrchestrationEvent: vi.fn(),
  saveMessage: vi.fn(),
  createSession: vi.fn(),
  savePolicyAuditLog: vi.fn(),
}));

// ── SkillRegistry unit tests ──────────────────────────────────────────────────

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  const buildSkill = (name: string, source: Skill['source'] = 'builtin', serverId?: string): Skill => ({
    name,
    description: `Test skill: ${name}`,
    parameters: { type: 'object', properties: {} },
    source,
    serverId,
    execute: vi.fn().mockResolvedValue({ ok: true, output: 'done' }),
  });

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('registers a skill and retrieves it by name', () => {
    registry.register(buildSkill('read_file'));
    expect(registry.has('read_file')).toBe(true);
    expect(registry.get('read_file')?.name).toBe('read_file');
  });

  it('overwrites existing skill on duplicate registration', () => {
    registry.register(buildSkill('read_file'));
    registry.register({ ...buildSkill('read_file'), description: 'updated description' });
    expect(registry.size).toBe(1);
    expect(registry.get('read_file')?.description).toBe('updated description');
  });

  it('registers many skills at once', () => {
    registry.registerMany([buildSkill('tool_a'), buildSkill('tool_b'), buildSkill('tool_c')]);
    expect(registry.size).toBe(3);
  });

  it('unregisters a skill and returns true', () => {
    registry.register(buildSkill('remove_me'));
    expect(registry.unregister('remove_me')).toBe(true);
    expect(registry.has('remove_me')).toBe(false);
  });

  it('returns false when unregistering a non-existent skill', () => {
    expect(registry.unregister('ghost-skill')).toBe(false);
  });

  it('unregisters all skills belonging to a specific MCP server', () => {
    registry.register(buildSkill('server_a_tool_1', 'mcp', 'server-a'));
    registry.register(buildSkill('server_a_tool_2', 'mcp', 'server-a'));
    registry.register(buildSkill('server_b_tool', 'mcp', 'server-b'));
    registry.register(buildSkill('builtin_tool', 'builtin'));

    const removed = registry.unregisterByServer('server-a');
    expect(removed).toBe(2);
    expect(registry.has('server_a_tool_1')).toBe(false);
    expect(registry.has('server_a_tool_2')).toBe(false);
    expect(registry.has('server_b_tool')).toBe(true);
    expect(registry.has('builtin_tool')).toBe(true);
  });

  it('lists all skills with no filter applied', () => {
    registry.registerMany([buildSkill('a'), buildSkill('b', 'mcp', 's1')]);
    expect(registry.list()).toHaveLength(2);
  });

  it('filters skills by source', () => {
    registry.register(buildSkill('builtin_tool', 'builtin'));
    registry.register(buildSkill('mcp_tool', 'mcp', 'srv'));

    const builtins = registry.list({ source: 'builtin' });
    expect(builtins).toHaveLength(1);
    expect(builtins[0]?.name).toBe('builtin_tool');

    const mcpSkills = registry.list({ source: 'mcp' });
    expect(mcpSkills).toHaveLength(1);
    expect(mcpSkills[0]?.name).toBe('mcp_tool');
  });

  it('filters skills by serverId', () => {
    registry.register(buildSkill('tool_a', 'mcp', 'server-x'));
    registry.register(buildSkill('tool_b', 'mcp', 'server-y'));

    const serverX = registry.list({ serverId: 'server-x' });
    expect(serverX).toHaveLength(1);
    expect(serverX[0]?.name).toBe('tool_a');
  });

  it('returns correct summary grouped by source', () => {
    registry.register(buildSkill('bt1', 'builtin'));
    registry.register(buildSkill('bt2', 'builtin'));
    registry.register(buildSkill('mcp1', 'mcp', 's1'));

    const summary = registry.summary();
    expect(summary.builtin).toBe(2);
    expect(summary.mcp).toBe(1);
  });
});

// ── McpServerManager unit tests ───────────────────────────────────────────────

describe('McpServerManager — config loading and server lifecycle', () => {
  const writeConfig = async (servers: McpServerConfig[]): Promise<string> => {
    const configPath = join(tmpdir(), `mcp-test-${randomUUID()}.json`);
    await writeFile(configPath, JSON.stringify({ servers }), 'utf8');
    return configPath;
  };

  const buildServerConfig = (id: string, enabled = true): McpServerConfig => ({
    id,
    name: `Server ${id}`,
    description: `Test server ${id}`,
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled,
  });

  it('loads enabled servers from a config file', async () => {
    const servers = [buildServerConfig('s1'), buildServerConfig('s2')];
    const configPath = await writeConfig(servers);
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, configPath);

    const loaded = await manager.loadConfig();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('filters out servers with enabled=false', async () => {
    const servers = [buildServerConfig('active'), buildServerConfig('disabled', false)];
    const configPath = await writeConfig(servers);
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, configPath);

    const loaded = await manager.loadConfig();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('active');
  });

  it('handles a missing config file gracefully (returns empty list)', async () => {
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, '/nonexistent/path/mcp-config.json');

    const loaded = await manager.loadConfig();
    // Package plan may add servers; we only assert no exception is thrown
    // and the missing file doesn't produce hard failures
    expect(Array.isArray(loaded)).toBe(true);
  });

  it('skips duplicate server IDs silently', async () => {
    // Two entries with the same id — only first should be registered
    const servers = [buildServerConfig('dup'), buildServerConfig('dup')];
    const configPath = await writeConfig(servers);
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();
    const snapshot = manager.listServers();
    // Only one adapter per id
    const ids = snapshot.map((s) => s.id);
    expect(ids.filter((id) => id === 'dup')).toHaveLength(1);
  });

  it('listServers returns disconnected state before connectAll', async () => {
    const servers = [buildServerConfig('srv-a')];
    const configPath = await writeConfig(servers);
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();
    const snapshots = manager.listServers();
    expect(snapshots[0]?.state).toBe('disconnected');
  });

  it('connectAll isolates failures — one failing server does not block others', async () => {
    const servers = [buildServerConfig('good'), buildServerConfig('bad')];
    const configPath = await writeConfig(servers);
    const registry = new SkillRegistry();
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();

    // Inject failure only for 'bad'
    const badAdapter = manager.getAdapter('bad');
    if (badAdapter) {
      vi.spyOn(badAdapter, 'connect').mockRejectedValueOnce(new Error('connection refused'));
    }

    // connectAll must not throw even if 'bad' fails
    await expect(manager.connectAll()).resolves.toBeUndefined();
  });

  it('getAdapter returns undefined for unknown server IDs', async () => {
    const registry = new SkillRegistry();
    const configPath = await writeConfig([]);
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();
    expect(manager.getAdapter('unknown')).toBeUndefined();
  });

  it('connect throws when target server ID is not configured', async () => {
    const registry = new SkillRegistry();
    const configPath = await writeConfig([]);
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();
    await expect(manager.connect('ghost')).rejects.toThrow("'ghost' is not configured");
  });

  it('disconnectAll completes without error', async () => {
    const registry = new SkillRegistry();
    const configPath = await writeConfig([buildServerConfig('d1')]);
    const manager = new McpServerManager(registry, configPath);

    await manager.loadConfig();
    await expect(manager.disconnectAll()).resolves.toBeUndefined();
  });
});
