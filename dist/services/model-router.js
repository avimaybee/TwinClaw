export class ModelRouter {
    models;
    constructor() {
        this.models = [
            {
                id: 'primary',
                model: 'zai-org/GLM-5-FP8',
                baseURL: 'https://api.us-west-2.modal.direct/v1/chat/completions',
                apiKeyEnvName: 'MODAL_API_KEY'
            },
            {
                id: 'fallback_1',
                model: 'stepfun/step-3.5-flash:free',
                baseURL: 'https://openrouter.ai/api/v1/chat/completions',
                apiKeyEnvName: 'OPENROUTER_API_KEY'
            },
            {
                id: 'fallback_2',
                model: 'gemini-flash-lite-latest',
                baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                apiKeyEnvName: 'GEMINI_API_KEY'
            }
        ];
    }
    getApiKey(envName) {
        const key = process.env[envName];
        if (!key) {
            console.warn(`Warning: API key ${envName} is not set in environment.`);
            return '';
        }
        return key;
    }
    async createChatCompletion(messages, tools) {
        let lastError = null;
        // Format tools if provided
        const formattedTools = tools?.length ? tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        })) : undefined;
        // Simple shuffle try-fallback routing loop
        for (const config of this.models) {
            const apiKey = this.getApiKey(config.apiKeyEnvName);
            if (!apiKey)
                continue;
            const payload = {
                model: config.model,
                messages: messages,
            };
            if (formattedTools) {
                payload.tools = formattedTools;
                payload.tool_choice = 'auto';
            }
            console.log(`[Router] Attempting request using model: ${config.model}`);
            try {
                const response = await fetch(config.baseURL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        // OpenRouter recommended headers
                        ...(config.id === 'fallback_1' ? { 'HTTP-Referer': 'https://twinclaw.ai', 'X-Title': 'TwinClaw' } : {})
                    },
                    body: JSON.stringify(payload)
                });
                if (response.status === 429) {
                    console.log(`[Router] Rate limit (429) hit for ${config.model}. Falling back...`);
                    lastError = new Error(`429 Too Many Requests: ${config.model}`);
                    continue; // Try next model
                }
                if (!response.ok) {
                    const errText = await response.text();
                    console.error(`[Router] Error from ${config.model}: ${response.status} ${errText}`);
                    lastError = new Error(`HTTP ${response.status}: ${errText}`);
                    continue; // Optionally fallback on arbitrary server errors too
                }
                const data = await response.json();
                return data.choices[0].message;
            }
            catch (err) {
                console.error(`[Router] Exception using ${config.model}: ${err.message}`);
                lastError = err;
                continue;
            }
        }
        throw new Error(`All configured models exhausted or failed. Last error: ${lastError?.message}`);
    }
}
