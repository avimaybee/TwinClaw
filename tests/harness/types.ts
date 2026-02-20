import { Message } from '../../src/core/types.js';

export interface ExpectedToolCall {
    name: string;
    args?: Record<string, unknown>;
}

export interface ReplayTurn {
    userMessage: string;

    /** 
     * The mock messages the router should return for this turn. 
     * Since a single user message can result in multiple tool executions (rounds), 
     * provide an array of mock responses matching the expected agent rounds.
     * The final mock message should be simple text.
     */
    mockRouterResponses: Message[];

    /** Simulator overrides to run before this turn. */
    simulateRateLimits?: number;
    simulateTransportError?: number;
    simulatePolicyProfile?: import('../../src/types/policy.js').PolicyProfile;

    /** Asserts that these tool calls were generated and executed. */
    expectToolCalls?: ExpectedToolCall[];

    /** Asserts that the final gateway output string contains these substrings. */
    expectResponseContains?: string[];
}

export interface ReplayScenario {
    id: string;
    description: string;
    turns: ReplayTurn[];
}
