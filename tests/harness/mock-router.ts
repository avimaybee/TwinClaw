import { ModelRouter } from '../../src/services/model-router.js';
import { Message, Tool } from '../../src/core/types.js';

export class MockModelRouter extends ModelRouter {
    private mockResponses: Message[] = [];
    public recordedToolCalls: { name: string; args: any }[] = [];
    public routingAttempts: number = 0;

    // Configurable error injection for Resilience Scenarios
    public throwErrorOnCall: number | null = null;
    public rateLimitSimulations: number = 0;

    private originalFetch = globalThis.fetch;

    constructor() {
        // Use aggressive_fallback + no-op sleep to avoid real wait delays in tests
        super({ fallbackMode: 'aggressive_fallback', sleep: async () => undefined });
    }

    public setMockResponses(responses: Message[]) {
        this.mockResponses = [...responses];
    }

    public clearMocks() {
        this.mockResponses = [];
        this.recordedToolCalls = [];
        this.routingAttempts = 0;
        this.throwErrorOnCall = null;
        this.rateLimitSimulations = 0;
    }

    public attachFetchMock() {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            if (!input.toString().includes('chat/completions')) {
                return this.originalFetch(input, init);
            }

            this.routingAttempts++;

            if (this.rateLimitSimulations > 0) {
                this.rateLimitSimulations--;
                return new Response('Rate limit', { status: 429 });
            }

            if (this.throwErrorOnCall === this.routingAttempts) {
                throw new Error('Simulated Transport Failure');
            }

            const nextResponse = this.mockResponses.shift();
            if (!nextResponse) {
                throw new Error('MockModelRouter: No more mock responses queued by the test runner.');
            }

            if (nextResponse.tool_calls) {
                for (const call of nextResponse.tool_calls) {
                    let parsedArgs = {};
                    if (call.function.arguments) {
                        try {
                            parsedArgs = JSON.parse(call.function.arguments as string);
                        } catch {
                            // Keep as string or empty obj if invalid JSON
                            parsedArgs = call.function.arguments;
                        }
                    }
                    this.recordedToolCalls.push({ name: call.function.name, args: parsedArgs });
                }
            }

            return new Response(JSON.stringify({
                choices: [{ message: nextResponse }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;
    }

    public detachFetchMock() {
        globalThis.fetch = this.originalFetch;
    }
}
