import { logToolCall } from '../utils/logger.js';
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
    parseArguments(args) {
        try {
            return JSON.parse(args);
        }
        catch {
            console.warn(`[LaneExecutor] Failed to parse arguments: ${args}`);
            return {};
        }
    }
    async executeToolCalls(message) {
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
                try {
                    console.log(`[LaneExecutor] Executing ${toolName} with args:`, args);
                    const result = await tool.execute(args);
                    content = typeof result === 'string' ? result : JSON.stringify(result);
                    await logToolCall(toolName, args, content);
                }
                catch (error) {
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
