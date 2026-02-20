import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Skill } from '../skills/types.js';
import type {
    McpServerConfig,
    McpConnectionState,
    McpServerSnapshot,
    JsonSchema,
} from '../types/mcp.js';
import { logThought } from '../utils/logger.js';
import type { SkillRegistry } from './skill-registry.js';
import { saveMcpHealthEvent, saveMcpScopeAuditLog } from './db.js';
import { randomUUID } from 'node:crypto';

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000; // 30 seconds
const SUCCESS_THRESHOLD = 2; // 2 consecutive successes to close half-open

// Symbols for testing access
export const INTERNAL_STATE = Symbol('INTERNAL_STATE');
export const INTERNAL_METRICS = Symbol('INTERNAL_METRICS');
export const INTERNAL_CLIENT = Symbol('INTERNAL_CLIENT');
export const INTERNAL_CONVERT = Symbol('INTERNAL_CONVERT');

/**
 * Manages the lifecycle of a single MCP server connection.
 *
 * - Launches the server as a subprocess via stdio transport.
 * - Discovers available tools using `list_tools()`.
 * - Converts MCP tools into TwinClaw's `Skill` contract.
 * - Registers/unregisters tools in the shared `SkillRegistry`.
 * - Provides `callTool()` for executing MCP tools.
 */
export class McpClientAdapter {
    readonly #config: McpServerConfig;
    readonly #registry: SkillRegistry;
    #client: Client | null = null;
    #transport: StdioClientTransport | null = null;
    #state: McpConnectionState = 'disconnected';
    #lastError: string | null = null;
    #toolCount = 0;

    // Health tracking
    #circuitState: 'closed' | 'open' | 'half-open' = 'closed';
    #metrics = {
        failureCount: 0,
        latencySpikes: 0,
        timeoutCount: 0,
        lastFailureTime: null as string | null,
        consecutiveSuccesses: 0,
    };

    /** @internal Exposure for tests only */
    get [INTERNAL_STATE]() { return this.#circuitState; }
    set [INTERNAL_STATE](v: 'closed' | 'open' | 'half-open') { this.#circuitState = v; }

    /** @internal Exposure for tests only */
    get [INTERNAL_METRICS]() { return this.#metrics; }

    /** @internal Exposure for tests only */
    get [INTERNAL_CLIENT]() { return this.#client; }

    /** @internal Exposure for tests only */
    [INTERNAL_CONVERT](name: string, desc: string, schema: unknown) {
        return this.#convertToSkill(name, desc, schema);
    }


    constructor(config: McpServerConfig, registry: SkillRegistry) {
        this.#config = config;
        this.#registry = registry;
    }

    get id(): string {
        return this.#config.id;
    }

    get state(): McpConnectionState {
        return this.#state;
    }

    /** Return a read-only snapshot of this adapter's status. */
    snapshot(): McpServerSnapshot {
        return {
            id: this.#config.id,
            name: this.#config.name,
            state: this.#state,
            toolCount: this.#toolCount,
            lastError: this.#lastError,
            health: this.#healthSnapshot(),
        };
    }

    #healthSnapshot() {
        let remainingCooldown = 0;
        if (this.#circuitState === 'open' && this.#metrics.lastFailureTime) {
            const lastFail = new Date(this.#metrics.lastFailureTime).getTime();
            remainingCooldown = Math.max(0, COOLDOWN_MS - (Date.now() - lastFail));
        }

        return {
            state: this.#circuitState,
            metrics: { ...this.#metrics },
            remainingCooldownMs: remainingCooldown,
        };
    }

    /** Connect to the MCP server and discover its tools. */
    async connect(): Promise<void> {
        if (this.#state === 'connected' || this.#state === 'connecting') return;

        this.#state = 'connecting';
        this.#lastError = null;

        try {
            await logThought(
                `[McpClientAdapter] Connecting to MCP server '${this.#config.id}' (${this.#config.command} ${this.#config.args.join(' ')})`,
            );

            this.#transport = new StdioClientTransport({
                command: this.#config.command,
                args: this.#config.args,
                env: this.#config.env as Record<string, string> | undefined,
            });

            this.#client = new Client({
                name: `twinclaw-${this.#config.id}`,
                version: '1.0.0',
            });

            await this.#client.connect(this.#transport);

            // Discover and register tools
            await this.#discoverTools();

            this.#state = 'connected';
            await logThought(
                `[McpClientAdapter] Connected to '${this.#config.id}' — ${this.#toolCount} tools available.`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.#state = 'error';
            this.#lastError = message;
            console.error(
                `[McpClientAdapter] Failed to connect to '${this.#config.id}':`,
                message,
            );
            await logThought(
                `[McpClientAdapter] Connection to '${this.#config.id}' failed: ${message}`,
            );
        }
    }

    /** Disconnect from the MCP server and unregister its tools. */
    async disconnect(): Promise<void> {
        // Unregister all tools from this server
        const removed = this.#registry.unregisterByServer(this.#config.id);
        this.#toolCount = 0;

        try {
            await this.#client?.close();
        } catch {
            // Best-effort cleanup
        }

        this.#client = null;
        this.#transport = null;
        this.#state = 'disconnected';

        await logThought(
            `[McpClientAdapter] Disconnected from '${this.#config.id}' — removed ${removed} tools.`,
        );
    }

    /** Execute a tool call on the MCP server. */
    async callTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<string> {
        if (!this.#client || this.#state !== 'connected') {
            throw new Error(
                `MCP server '${this.#config.id}' is not connected (state: ${this.#state}).`,
            );
        }

        await logThought(
            `[McpClientAdapter] Calling tool '${toolName}' on MCP server '${this.#config.id}'.`,
        );

        // Check circuit state before execution
        this.#checkCircuitTransition();
        if (this.#circuitState === 'open') {
            throw new Error(
                `MCP server '${this.#config.id}' is unavailable (Circuit OPEN). Failure count: ${this.#metrics.failureCount}`,
            );
        }

        const start = Date.now();
        try {
            const result = await this.#client.callTool({ name: toolName, arguments: args });
            const latency = Date.now() - start;

            this.#recordSuccess(latency);

            // MCP tool results come as an array of content blocks
            const content = result.content;
            if (Array.isArray(content)) {
                return content
                    .map((block) => {
                        if (typeof block === 'object' && block !== null && 'text' in block) {
                            return String(block.text);
                        }
                        return JSON.stringify(block);
                    })
                    .join('\n');
            }

            const output = typeof content === 'string' ? content : JSON.stringify(content);
            return output;
        } catch (err) {
            this.#recordFailure(err);
            throw err;
        }
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    /** Discover tools from the MCP server and register them in the skill registry. */
    async #discoverTools(): Promise<void> {
        if (!this.#client) return;

        const response = await this.#client.listTools();
        const tools = response.tools;

        for (const tool of tools) {
            const skill = this.#convertToSkill(tool.name, tool.description ?? '', tool.inputSchema);
            this.#registry.register(skill);
        }

        this.#toolCount = tools.length;
    }

    /** Convert an MCP tool's metadata into TwinClaw's Skill interface. */
    #convertToSkill(
        name: string,
        description: string,
        inputSchema: unknown,
    ): Skill {
        const serverId = this.#config.id;
        const adapter = this; // Capture reference for the closure

        const defaultScope = this.#config.capabilities?.defaultScope ?? 'unclassified';
        const mcpScope = this.#config.capabilities?.tools?.[name] ?? defaultScope;

        return {
            name,
            description: `[MCP:${serverId}] ${description}`,
            parameters: (inputSchema as JsonSchema) ?? undefined,
            source: 'mcp',
            serverId,
            mcpScope,
            adapter,
            async execute(input: Record<string, unknown>) {
                try {
                    const output = await adapter.callTool(name, input);
                    return { ok: true, output };
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    return { ok: false, output: `MCP tool error: ${message}` };
                }
            },
        };
    }

    /** Audit a scope-blocked action. */
    auditScopeBlock(sessionId: string | null, toolName: string, scope: string, reason: string): void {
        saveMcpScopeAuditLog({
            id: randomUUID(),
            sessionId,
            serverId: this.#config.id,
            toolName,
            scope,
            outcome: 'denied',
            reason,
        });
    }

    /** Audit a scope-allowed action. */
    auditScopeAllow(sessionId: string | null, toolName: string, scope: string): void {
        saveMcpScopeAuditLog({
            id: randomUUID(),
            sessionId,
            serverId: this.#config.id,
            toolName,
            scope,
            outcome: 'allowed',
        });
    }

    #checkCircuitTransition(): void {
        if (this.#circuitState === 'open' && this.#metrics.lastFailureTime) {
            const lastFail = new Date(this.#metrics.lastFailureTime).getTime();
            if (Date.now() - lastFail > COOLDOWN_MS) {
                const prevState = this.#circuitState;
                this.#circuitState = 'half-open';

                saveMcpHealthEvent({
                    id: randomUUID(),
                    serverId: this.#config.id,
                    prevState,
                    newState: this.#circuitState,
                    reason: 'Cooldown expired',
                    metrics: { ...this.#metrics },
                });

                logThought(
                    `[McpClientAdapter] Circuit for '${this.#config.id}' transitioned to HALF-OPEN (cooldown expired).`,
                ).catch(() => { });
            }
        }
    }

    #recordSuccess(latencyMs: number): void {
        this.#metrics.consecutiveSuccesses++;

        // Latency spikes (> 10s)
        if (latencyMs > 10_000) {
            this.#metrics.latencySpikes++;
        }

        if (this.#circuitState === 'half-open' && this.#metrics.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
            const prevState = this.#circuitState;
            this.#circuitState = 'closed';
            this.#metrics.failureCount = 0; // Reset failures on full recovery

            saveMcpHealthEvent({
                id: randomUUID(),
                serverId: this.#config.id,
                prevState,
                newState: this.#circuitState,
                reason: 'Success threshold reached in half-open state',
                metrics: { ...this.#metrics },
            });

            logThought(
                `[McpClientAdapter] Circuit for '${this.#config.id}' transitioned to CLOSED (full recovery achieved).`,
            ).catch(() => { });
        }
    }

    #recordFailure(err: unknown): void {
        this.#metrics.failureCount++;
        this.#metrics.lastFailureTime = new Date().toISOString();
        this.#metrics.consecutiveSuccesses = 0;

        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('timeout')) {
            this.#metrics.timeoutCount++;
        }

        if (this.#circuitState !== 'open' && this.#metrics.failureCount >= FAILURE_THRESHOLD) {
            const prevState = this.#circuitState;
            this.#circuitState = 'open';

            saveMcpHealthEvent({
                id: randomUUID(),
                serverId: this.#config.id,
                prevState,
                newState: this.#circuitState,
                reason: `Failure threshold reached: ${message}`,
                metrics: { ...this.#metrics },
            });

            logThought(
                `[McpClientAdapter] Circuit for '${this.#config.id}' transitioned to OPEN (failure threshold ${FAILURE_THRESHOLD} reached). Last error: ${message}`,
            ).catch(() => { });
        }
    }
}
