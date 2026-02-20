import { Tool, ToolCall, Message } from './types.js';
import { logToolCall } from '../utils/logger.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { Skill } from '../skills/types.js';

/** Convert a Skill (from the registry) into the internal Tool format used by LaneExecutor. */
function skillToTool(skill: Skill): Tool {
    return {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters ?? {},
        execute: async (args: Record<string, unknown>) => {
            const result = await skill.execute(args);
            return result.output;
        },
    };
}

export class LaneExecutor {
    private tools: Map<string, Tool> = new Map();

    constructor(tools: Tool[] = []) {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
        }
    }

    public registerTool(tool: Tool) {
        this.tools.set(tool.name, tool);
    }

    /**
     * Pull all skills from a SkillRegistry and merge them into the tool map.
     * Existing tools with the same name are overwritten.
     */
    public syncFromRegistry(registry: SkillRegistry): void {
        const skills = registry.list();
        for (const skill of skills) {
            this.tools.set(skill.name, skillToTool(skill));
        }
    }

    private parseArguments(args: string): any {
        try {
            return JSON.parse(args);
        } catch {
            console.warn(`[LaneExecutor] Failed to parse arguments: ${args}`);
            return {};
        }
    }

    public async executeToolCalls(message: Message): Promise<Message[]> {
        if (!message.tool_calls || message.tool_calls.length === 0) {
            return [];
        }

        const results: Message[] = [];

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
            } else {
                try {
                    console.log(`[LaneExecutor] Executing ${toolName} with args:`, args);
                    const result = await tool.execute(args);
                    content = typeof result === 'string' ? result : JSON.stringify(result);
                    await logToolCall(toolName, args, content);
                } catch (error: any) {
                    console.error(`[LaneExecutor] Tool ${toolName} failed:`, error);
                    content = `Error executing tool: ${error.message}`;
                    await logToolCall(toolName, args, content);
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
