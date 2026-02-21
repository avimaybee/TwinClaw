import type { JsonSchema, McpCapabilityScope, McpScopeAuditAdapter } from '../types/mcp.js';

export interface SkillExecutionResult {
  ok: boolean;
  output: string;
}

/** Source origin of a skill — local builtin or MCP-backed. */
export type SkillSource = 'builtin' | 'mcp';
export type SkillGroup = `group:${string}`;

export interface Skill {
  name: string;
  description: string;
  /** Native tool grouping (for example: group:fs, group:runtime). */
  group?: SkillGroup;
  /** Optional legacy aliases that should resolve to this canonical skill. */
  aliases?: string[];
  /** JSON Schema describing the tool's input parameters. */
  parameters?: JsonSchema;
  /** Where this skill originates from. @default 'builtin' */
  source?: SkillSource;
  /** If source is 'mcp', which server ID provides this tool. */
  serverId?: string;
  /** If source is 'mcp', the adapter instance for auditing/health. */
  adapter?: McpScopeAuditAdapter;
  /** If source is 'mcp', what capability scope this tool has. */
  mcpScope?: McpCapabilityScope;
  execute(input: Record<string, unknown>): Promise<SkillExecutionResult>;
}
