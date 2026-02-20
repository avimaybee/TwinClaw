import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpClientAdapter } from './mcp-client-adapter.js';
import type { SkillRegistry } from './skill-registry.js';
import type { McpConfig, McpServerConfig, McpServerSnapshot } from '../types/mcp.js';
import { logThought } from '../utils/logger.js';

const DEFAULT_CONFIG_PATH = path.resolve('mcp-servers.json');

/**
 * Manages multiple MCP server connections.
 *
 * Reads a configuration file listing MCP servers, creates an adapter
 * for each enabled server, and orchestrates connect/disconnect lifecycle.
 * Failed connections are isolated — one server's failure doesn't affect others.
 *
 * Usage:
 * ```ts
 * const manager = new McpServerManager(registry);
 * await manager.loadConfig();
 * await manager.connectAll();
 *
 * // Later:
 * await manager.disconnectAll();
 * ```
 */
export class McpServerManager {
    readonly #registry: SkillRegistry;
    readonly #adapters: Map<string, McpClientAdapter> = new Map();
    #configPath: string;

    constructor(registry: SkillRegistry, configPath?: string) {
        this.#registry = registry;
        this.#configPath = configPath ?? DEFAULT_CONFIG_PATH;
    }

    /** Load MCP server configuration from the config file. */
    async loadConfig(): Promise<McpServerConfig[]> {
        try {
            const raw = await readFile(this.#configPath, 'utf8');
            const config: McpConfig = JSON.parse(raw);

            if (!Array.isArray(config.servers)) {
                console.warn('[McpServerManager] Config file has no servers array.');
                return [];
            }

            const enabledServers = config.servers.filter((s) => s.enabled !== false);

            for (const serverConfig of enabledServers) {
                if (this.#adapters.has(serverConfig.id)) {
                    console.warn(
                        `[McpServerManager] Duplicate server ID '${serverConfig.id}' — skipping.`,
                    );
                    continue;
                }

                const adapter = new McpClientAdapter(serverConfig, this.#registry);
                this.#adapters.set(serverConfig.id, adapter);
            }

            await logThought(
                `[McpServerManager] Loaded ${enabledServers.length} server(s) from config.`,
            );

            return enabledServers;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(
                    `[McpServerManager] Config file not found at ${this.#configPath}. No MCP servers will be loaded.`,
                );
                return [];
            }

            console.error('[McpServerManager] Failed to load config:', message);
            await logThought(`[McpServerManager] Config load failed: ${message}`);
            return [];
        }
    }

    /** Connect all configured servers that have autoConnect enabled. */
    async connectAll(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const adapter of this.#adapters.values()) {
            // Connect with error isolation — one failure doesn't block others
            promises.push(
                adapter.connect().catch((err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(
                        `[McpServerManager] Failed to connect '${adapter.id}':`,
                        message,
                    );
                }),
            );
        }

        await Promise.allSettled(promises);

        const snapshots = this.listServers();
        const connected = snapshots.filter((s) => s.state === 'connected').length;
        const total = snapshots.length;

        await logThought(
            `[McpServerManager] Connection complete: ${connected}/${total} servers connected.`,
        );
    }

    /** Connect a specific server by ID. */
    async connect(serverId: string): Promise<void> {
        const adapter = this.#adapters.get(serverId);
        if (!adapter) {
            throw new Error(`[McpServerManager] Server '${serverId}' is not configured.`);
        }
        await adapter.connect();
    }

    /** Disconnect a specific server by ID. */
    async disconnect(serverId: string): Promise<void> {
        const adapter = this.#adapters.get(serverId);
        if (!adapter) return;
        await adapter.disconnect();
    }

    /** Disconnect all servers gracefully. */
    async disconnectAll(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const adapter of this.#adapters.values()) {
            promises.push(adapter.disconnect());
        }

        await Promise.allSettled(promises);
        await logThought('[McpServerManager] All MCP servers disconnected.');
    }

    /** Return snapshots of all managed MCP servers. */
    listServers(): McpServerSnapshot[] {
        return [...this.#adapters.values()].map((a) => a.snapshot());
    }

    /** Get a specific adapter by ID (for direct tool calls). */
    getAdapter(serverId: string): McpClientAdapter | undefined {
        return this.#adapters.get(serverId);
    }
}
