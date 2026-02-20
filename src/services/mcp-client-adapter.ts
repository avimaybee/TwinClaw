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

        const result = await this.#client.callTool({ name: toolName, arguments: args });

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

        return typeof content === 'string' ? content : JSON.stringify(content);
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

        return {
            name,
            description: `[MCP:${serverId}] ${description}`,
            parameters: (inputSchema as JsonSchema) ?? undefined,
            source: 'mcp',
            serverId,
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
}
