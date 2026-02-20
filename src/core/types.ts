export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolCallResponse {
    tool_call_id: string;
    role: 'tool';
    name: string;
    content: string;
}

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, any>;
    mcpScope?: string;
    serverId?: string;
    execute: (args: Record<string, any>) => Promise<any>;
}

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface ModelConfig {
    id: string;
    model: string;
    baseURL: string;
    apiKeyEnvName: string;
}
