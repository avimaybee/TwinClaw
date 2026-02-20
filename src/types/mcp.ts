import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';

/** JSON Schema object for describing tool parameters. */
export interface JsonSchema {
    type: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    description?: string;
    items?: JsonSchema;
    enum?: string[];
    default?: unknown;
    [key: string]: unknown;
}

/** Capability scope limiting the operations an MCP tool can perform. */
export type McpCapabilityScope = 'read-only' | 'write-limited' | 'high-risk' | 'unclassified';

/** Configuration for capability scopes on an MCP server. */
export interface McpServerCapabilities {
    /** Default scope for tools that aren't explicitly configured. @default 'unclassified' -> blocks by default */
    defaultScope?: McpCapabilityScope;
    /** Map of explicit tool names to their granted capability scope. */
    tools?: Record<string, McpCapabilityScope>;
}

/** Transport mechanism for connecting to an MCP server. */
export type McpTransportType = 'stdio' | 'sse';

/** Configuration for a single MCP server connection. */
export interface McpServerConfig {
    /** Unique identifier for this server (e.g. 'github', 'filesystem'). */
    id: string;
    /** Human-readable name for display. */
    name: string;
    /** Description of what this server provides. */
    description: string;
    /** Transport type. Currently only 'stdio' is implemented. */
    transport: McpTransportType;
    /** Command to launch the server (e.g. 'npx', 'node'). */
    command: string;
    /** Arguments to pass to the command. */
    args: string[];
    /** Optional environment variables to set for the subprocess. */
    env?: Record<string, string>;
    /** Whether to auto-connect this server on startup. @default true */
    autoConnect?: boolean;
    /** Whether this server is currently enabled. @default true */
    enabled?: boolean;
    /** Explicit capability scopes for this server. */
    capabilities?: McpServerCapabilities;
}

/** Top-level configuration file shape for MCP servers. */
export interface McpConfig {
    servers: McpServerConfig[];
}

/** Represents a tool discovered from an MCP server. */
export interface McpDiscoveredTool {
    /** Which MCP server this tool came from. */
    serverId: string;
    /** The raw MCP tool metadata from list_tools(). */
    mcpTool: McpTool;
}

/** Connection state for an MCP server. */
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Health circuit state for an MCP server. */
export type McpCircuitState = 'closed' | 'open' | 'half-open';

/** Health metrics for an MCP server. */
export interface McpHealthMetrics {
    failureCount: number;
    latencySpikes: number;
    timeoutCount: number;
    lastFailureTime: string | null;
    consecutiveSuccesses: number;
}

/** Read-only snapshot of an MCP server's health. */
export interface McpHealthSnapshot {
    state: McpCircuitState;
    metrics: McpHealthMetrics;
    remainingCooldownMs: number;
}

/** Read-only snapshot of an MCP server's status. */
export interface McpServerSnapshot {
    id: string;
    name: string;
    state: McpConnectionState;
    toolCount: number;
    lastError: string | null;
    health: McpHealthSnapshot;
}

/**
 * Minimal audit interface for MCP scope enforcement.
 * Implemented by McpClientAdapter — typed here to break the circular dependency
 * between lane-executor/skills and the services layer.
 */
export interface McpScopeAuditAdapter {
    auditScopeBlock(sessionId: string | null, toolName: string, scope: string, reason: string): void;
    auditScopeAllow(sessionId: string | null, toolName: string, scope: string): void;
}
