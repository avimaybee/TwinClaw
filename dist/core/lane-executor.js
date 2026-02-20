import { logToolCall, scrubSensitiveText } from '../utils/logger.js';
/** Convert a Skill (from the registry) into the internal Tool format used by LaneExecutor. */
function skillToTool(skill) {
    return {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters ?? {},
        mcpScope: skill.mcpScope,
        serverId: skill.serverId,
        adapter: skill.adapter,
        execute: async (args) => {
            const result = await skill.execute(args);
            return result.output;
        },
    };
}
export class LaneExecutor {
    tools = new Map();
    constructor(tools = []) {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
        }
    }
    registerTool(tool) {
        this.tools.set(tool.name, tool);
    }
    /**
     * Pull all skills from a SkillRegistry and merge them into the tool map.
     * Existing tools with the same name are overwritten.
     */
    syncFromRegistry(registry) {
        const skills = registry.list();
        for (const skill of skills) {
            this.tools.set(skill.name, skillToTool(skill));
        }
    }
    parseArguments(args) {
        try {
            return JSON.parse(args);
        }
        catch {
            console.warn(`[LaneExecutor] Failed to parse arguments: ${scrubSensitiveText(args)}`);
            return {};
        }
    }
    async executeToolCalls(message, sessionId, policyEngine) {
        if (!message.tool_calls || message.tool_calls.length === 0) {
            return [];
        }
        const results = [];
        // Lane-Based Execution: Execute tools serially in an await loop
        for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const args = this.parseArguments(toolCall.function.arguments);
            const tool = this.tools.get(toolName);
            let content = '';
            if (!tool) {
                console.warn(`[LaneExecutor] Tool not found: ${toolName}`);
                content = `Error: Tool '${toolName}' is not registered or unavailable.`;
                await logToolCall(toolName, args, content);
            }
            else {
                let allowed = true;
                let decision = policyEngine ? policyEngine.evaluate(sessionId, toolName) : null;
                // 1. MCP Scope Enforcement (Applies before or alongside PolicyEngine)
                if (tool.serverId && tool.mcpScope) {
                    if (tool.mcpScope === 'unclassified') {
                        content = `Access Denied: MCP tool '${toolName}' is unclassified (secure default). Capability Profile: ${tool.mcpScope}`;
                        allowed = false;
                        tool.adapter?.auditScopeBlock(sessionId, toolName, tool.mcpScope, 'Secure default for unclassified tools');
                    }
                    else if (tool.mcpScope === 'high-risk') {
                        // High-risk blocked-by-default: Needs explicit policy allow, not a fallback
                        const isFallback = decision ? decision.reason.includes('Fell back to') : true;
                        if (isFallback) {
                            content = `Access Denied: MCP tool '${toolName}' is 'high-risk' and blocked by default. Requires explicit allow rule. Capability Profile: ${tool.mcpScope}`;
                            allowed = false;
                            tool.adapter?.auditScopeBlock(sessionId, toolName, tool.mcpScope, 'High-risk tools require explicit allow rule');
                        }
                    }
                    if (allowed) {
                        tool.adapter?.auditScopeAllow(sessionId, toolName, tool.mcpScope);
                    }
                }
                // 2. Policy Governance Baseline
                if (allowed && decision && decision.action === 'deny') {
                    content = `Access Denied: Tool '${toolName}' is blocked by policy. Reason: ${decision.reason}`;
                    allowed = false;
                }
                if (!allowed) {
                    console.warn(`[LaneExecutor] Blocked tool ${toolName}: ${content}`);
                    await logToolCall(toolName, args, content);
                }
                if (allowed) {
                    try {
                        console.log(`[LaneExecutor] Executing ${toolName} with args: ${scrubSensitiveText(JSON.stringify(args))}`);
                        const result = await tool.execute(args);
                        content = typeof result === 'string' ? result : JSON.stringify(result);
                        await logToolCall(toolName, args, content);
                    }
                    catch (error) {
                        const rawMessage = error instanceof Error ? error.message : String(error);
                        const sanitizedMessage = scrubSensitiveText(rawMessage);
                        console.error(`[LaneExecutor] Tool ${toolName} failed: ${sanitizedMessage}`);
                        content = `Error executing tool: ${sanitizedMessage}`;
                        await logToolCall(toolName, args, content);
                    }
                }
            }
            results.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolName,
                content: content,
            });
        }
        return results;
    }
}
