
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    McpClientAdapter,
    INTERNAL_STATE,
    INTERNAL_METRICS,
    INTERNAL_CLIENT,
    INTERNAL_CONVERT
} from '../../src/services/mcp-client-adapter.js';
import { SkillRegistry } from '../../src/services/skill-registry.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServerConfig } from '../../src/types/mcp.js';

// Mock the MCP Client
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
    const ClientMock = vi.fn();
    ClientMock.prototype.connect = vi.fn().mockResolvedValue(undefined);
    ClientMock.prototype.close = vi.fn().mockResolvedValue(undefined);
    ClientMock.prototype.listTools = vi.fn().mockResolvedValue({ tools: [{ name: 'test_tool', description: 'Test Tool', inputSchema: {} }] });
    ClientMock.prototype.callTool = vi.fn();
    return { Client: ClientMock };
});

// Mock database to avoid real SQLite during unit tests
vi.mock('../../src/services/db.js', () => ({
    saveMcpHealthEvent: vi.fn(),
    saveMcpScopeAuditLog: vi.fn(),
    saveOrchestrationEvent: vi.fn(),
    saveMessage: vi.fn(),
    createSession: vi.fn(),
    savePolicyAuditLog: vi.fn(),
}));

describe('McpCapabilityScopes & HealthCircuits', () => {
    let registry: SkillRegistry;
    let config: McpServerConfig;

    beforeEach(() => {
        registry = new SkillRegistry();
        config = {
            id: 'test-server',
            name: 'Test Server',
            description: 'A test server',
            transport: 'stdio',
            command: 'node',
            args: ['test.js'],
            capabilities: {
                defaultScope: 'read-only',
                tools: {
                    'write_tool': 'write-limited',
                    'danger_tool': 'high-risk',
                    'unknown_tool': 'unclassified'
                }
            }
        };
        vi.clearAllMocks();
    });

    describe('Capability Scopes', () => {
        it('assigns correct scopes to discovered tools', async () => {
            const adapter = new McpClientAdapter(config, registry);
            await adapter.connect();

            const readSkill = registry.get('test_tool');
            expect(readSkill?.mcpScope).toBe('read-only');

            const writeSkill = adapter[INTERNAL_CONVERT]('write_tool', 'Write things', {});
            expect(writeSkill.mcpScope).toBe('write-limited');

            const dangerSkill = adapter[INTERNAL_CONVERT]('danger_tool', 'Danger!', {});
            expect(dangerSkill.mcpScope).toBe('high-risk');

            const unclassifiedSkill = adapter[INTERNAL_CONVERT]('unknown_tool', '?', {});
            expect(unclassifiedSkill.mcpScope).toBe('unclassified');
        });
    });

    describe('Health Circuits', () => {
        it('opens circuit after repeated failures', async () => {
            const adapter = new McpClientAdapter(config, registry);
            await adapter.connect();

            const clientInstance = adapter[INTERNAL_CLIENT];
            (clientInstance!.callTool as any).mockRejectedValue(new Error('Connection timeout'));

            // threshold is 5
            for (let i = 0; i < 4; i++) {
                await expect(adapter.callTool('test_tool', {})).rejects.toThrow();
                expect(adapter.snapshot().health.state).toBe('closed');
            }

            // 5th failure opens the circuit
            await expect(adapter.callTool('test_tool', {})).rejects.toThrow();
            expect(adapter.snapshot().health.state).toBe('open');
            expect(adapter.snapshot().health.metrics.failureCount).toBe(5);
        });

        it('blocks execution when circuit is open', async () => {
            const adapter = new McpClientAdapter(config, registry);
            await adapter.connect(); // Initialized state: connected

            adapter[INTERNAL_STATE] = 'open';
            adapter[INTERNAL_METRICS].lastFailureTime = new Date().toISOString();

            await expect(adapter.callTool('test_tool', {})).rejects.toThrow(/unavailable|OPEN/i);
        });

        it('transitions to half-open after cooldown', async () => {
            vi.useFakeTimers();
            const adapter = new McpClientAdapter(config, registry);
            await adapter.connect();

            adapter[INTERNAL_STATE] = 'open';
            // Set last failure to 1 minute ago
            const oneMinAgo = new Date(Date.now() - 60000).toISOString();
            adapter[INTERNAL_METRICS].lastFailureTime = oneMinAgo;

            // Trigger transition check via callTool
            try { await adapter.callTool('test_tool', {}); } catch { }

            expect(adapter.snapshot().health.state).toBe('half-open');
            vi.useRealTimers();
        });

        it('closes circuit after successes in half-open state', async () => {
            const adapter = new McpClientAdapter(config, registry);
            await adapter.connect();
            adapter[INTERNAL_STATE] = 'half-open';

            const clientInstance = adapter[INTERNAL_CLIENT];
            (clientInstance!.callTool as any).mockResolvedValue({ content: [{ text: 'OK' }] });

            // SUCCESS_THRESHOLD is 2
            await adapter.callTool('test_tool', {});
            expect(adapter.snapshot().health.state).toBe('half-open');

            await adapter.callTool('test_tool', {});
            expect(adapter.snapshot().health.state).toBe('closed');
            expect(adapter.snapshot().health.metrics.failureCount).toBe(0);
        });
    });
});
