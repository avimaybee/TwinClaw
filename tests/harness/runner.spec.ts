import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Gateway } from '../../src/core/gateway.js';
import { SkillRegistry } from '../../src/services/skill-registry.js';
import { createBuiltinSkills } from '../../src/skills/builtin.js';
import { MockModelRouter } from './mock-router.js';
import { PolicyEngine } from '../../src/services/policy-engine.js';
import { ReplayScenario } from './types.js';
import { randomUUID } from 'node:crypto';
import { OrchestrationService } from '../../src/services/orchestration-service.js';
import type { DelegationBrief, DelegationRequest } from '../../src/types/orchestration.js';
import { createSession } from '../../src/services/db.js';

describe('Replay Harness Execution Runner', () => {
    let mockRouter: MockModelRouter;
    let gateway: Gateway;
    let registry: SkillRegistry;
    let policyEngine: PolicyEngine;

    beforeEach(() => {
        // Ensure the real ModelRouter parses these endpoints for fallback routing
        process.env.MODAL_API_KEY = 'test_modal_key';
        process.env.OPENROUTER_API_KEY = 'test_openrouter_key';
        process.env.GEMINI_API_KEY = 'test_gemini_key';

        mockRouter = new MockModelRouter();
        registry = new SkillRegistry();
        policyEngine = new PolicyEngine();
        // Keep it self-contained for testing scenarios by adding built-ins
        registry.registerMany(createBuiltinSkills());

        // Pass our deterministic mock router
        gateway = new Gateway(registry, {
            router: mockRouter,
            maxToolRounds: 5,
            enableDelegation: false,
            policyEngine
        });
        mockRouter.attachFetchMock();
    });

    afterEach(() => {
        mockRouter.detachFetchMock();
        delete process.env.MODAL_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;
    });

    const runScenario = async (scenario: ReplayScenario) => {
        const sessionId = `test:scenario:${scenario.id}:${randomUUID()}`;

        for (const turn of scenario.turns) {
            mockRouter.clearMocks();
            mockRouter.setMockResponses(turn.mockRouterResponses);

            if (turn.simulateRateLimits) mockRouter.rateLimitSimulations = turn.simulateRateLimits;
            if (turn.simulateTransportError) mockRouter.throwErrorOnCall = turn.simulateTransportError;
            if (turn.simulatePolicyProfile) {
                policyEngine.setSessionOverride(sessionId, turn.simulatePolicyProfile);
            }

            const finalResponse = await gateway.processText(sessionId, turn.userMessage);

            // Assertions
            if (turn.expectResponseContains) {
                for (const expectedSubstring of turn.expectResponseContains) {
                    expect(finalResponse).toContain(expectedSubstring);
                }
            }

            if (turn.expectToolCalls) {
                // Check if all expected tool calls were requested by the LLM (and tracked by our mock router)
                const trackedCalls = mockRouter.recordedToolCalls;
                for (const expected of turn.expectToolCalls) {
                    const match = trackedCalls.find(c => c.name === expected.name);
                    expect(match).toBeDefined();
                    if (expected.args) {
                        try {
                            expect(match?.args).toMatchObject(expected.args);
                        } catch (e) {
                            // If argument validation fails, re-throw with context
                            throw new Error(`Tool call ${expected.name} argument mismatch.\nExpected: ${JSON.stringify(expected.args)}\nActual: ${JSON.stringify(match?.args)}`);
                        }
                    }
                }
            }
        }
    };

    it('Scenario 1: Simple greeting without tool calls', async () => {
        const simpleGreeting: ReplayScenario = {
            id: 'simple-greeting',
            description: 'Agent returns simple greeting text with no tools requested.',
            turns: [
                {
                    userMessage: 'Hello TwinClaw!',
                    mockRouterResponses: [
                        { role: 'assistant', content: 'Greetings! How can I assist you in the system today?' }
                    ],
                    expectResponseContains: ['Greetings!', 'assist you']
                }
            ]
        };

        await runScenario(simpleGreeting);
    });

    it('Scenario 2: Single Tool Call Execution (read_file)', async () => {
        const toolExecutionScenario: ReplayScenario = {
            id: 'mocked-tool-execution',
            description: 'Agent decides to call a skill, the lane executor runs it, then the agent responds.',
            turns: [
                {
                    userMessage: 'Read my identity',
                    mockRouterResponses: [
                        // Round 1: Model requests a tool call
                        {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                {
                                    id: 'call_mocked123',
                                    type: 'function',
                                    function: {
                                        name: 'read_file',
                                        arguments: '{"filePath":"identity/identity.md"}'
                                    }
                                }
                            ]
                        },
                        // Round 2: After the tool runs, the model summarizes the result
                        {
                            role: 'assistant',
                            content: 'I have read your identity from identity/identity.md. You are the Commander.'
                        }
                    ],
                    expectToolCalls: [
                        { name: 'read_file', args: { filePath: 'identity/identity.md' } }
                    ],
                    expectResponseContains: ['I have read your identity', 'Commander']
                }
            ]
        };

        await runScenario(toolExecutionScenario);
    });

    it('Scenario 3: Router Rate Limit (429) Resiliency', async () => {
        // Simulates 429 once, Gateway should retry natively with next model
        const failScenario: ReplayScenario = {
            id: 'mocked-429-fallback',
            description: 'Agent gracefully recovers after a simulated 429 Too Many Requests error.',
            turns: [
                {
                    userMessage: 'Test rate limit',
                    mockRouterResponses: [
                        { role: 'assistant', content: 'I am back online.' }
                    ],
                    simulateRateLimits: 1,
                    expectResponseContains: ['I am back online.']
                }
            ]
        };

        await runScenario(failScenario);
        expect(mockRouter.routingAttempts).toBe(2); // Failed once, succeeded next
    });

    it('Scenario 4: Guardrail - Bounded Tool Loop Limit', async () => {
        // Tests the Gateway forcibly halting runaway recursion
        const runawayScenario: ReplayScenario = {
            id: 'mocked-runaway-loop',
            description: 'Gateway restricts runaway recursive tool execution.',
            turns: [
                {
                    userMessage: 'Calculate Pi infinitely',
                    mockRouterResponses: [
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_4', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_5', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
                        { role: 'assistant', content: null, tool_calls: [{ id: 'call_6', type: 'function', function: { name: 'list_files', arguments: '{}' } }] }
                    ],
                    expectResponseContains: ['Stopped after 5 tool-execution rounds without a final text response']
                }
            ]
        };

        await runScenario(runawayScenario);
    });

    it('Scenario 5: Skill Execution Degradation', async () => {
        // Assume calling an invalid path or failing tool. LaneExecutor should catch it and return it as a string to the model.
        const errorScenario: ReplayScenario = {
            id: 'mocked-tool-error',
            description: 'Agent decides to call a skill, but the execution fails. The failure is returned gracefully.',
            turns: [
                {
                    userMessage: 'Read secret.txt',
                    mockRouterResponses: [
                        {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"filePath":"invalid/missing.txt"}' } }]
                        },
                        // Model gets tool error, apologizes gracefully
                        {
                            role: 'assistant',
                            content: 'I apologize, but that file could not be read. (Error: ENOENT)'
                        }
                    ],
                    expectResponseContains: ['I apologize', 'could not be read']
                }
            ]
        };

        await runScenario(errorScenario);
    });

    it('Scenario 6: Tool Policy Governance', async () => {
        // Enforces that execution blocked by policy is prevented and fed back
        const policyScenario: ReplayScenario = {
            id: 'mocked-tool-policy',
            description: 'Agent decides to call a skill, but policy blocks it.',
            turns: [
                {
                    userMessage: 'Read secret.txt',
                    simulatePolicyProfile: {
                        id: 'strict-profile',
                        defaultAction: 'deny',
                        rules: [{ skillName: 'read_file', action: 'deny', reason: 'User not authorized to read files' }]
                    },
                    mockRouterResponses: [
                        {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"filePath":"secret.txt"}' } }]
                        },
                        // Model gets policy blocked error, apologizes gracefully
                        {
                            role: 'assistant',
                            content: 'I apologize, but I am blocked by your policy profile from reading files. (Reason: User not authorized to read files)'
                        }
                    ],
                    expectResponseContains: ['policy profile', 'User not authorized']
                }
            ]
        };

        await runScenario(policyScenario);
    });
});

describe('Delegation DAG Runtime', () => {
    const buildBrief = (id: string, dependsOn: string[] = []): DelegationBrief => ({
        id,
        dependsOn,
        title: `Node ${id}`,
        objective: `Execute node ${id}`,
        scopedContext: 'test context',
        expectedOutput: 'Return completion details.',
        constraints: {
            toolBudget: 0,
            timeoutMs: 2_000,
            maxTurns: 1,
        },
    });

    const buildRequest = (briefs: DelegationBrief[]): DelegationRequest => {
        const sessionId = `test:dag:${randomUUID()}`;
        createSession(sessionId);

        return {
            sessionId,
            parentMessage: 'Validate delegation graph behavior',
            scope: {
                sessionId: `test:scope:${randomUUID()}`,
                memoryContext: '',
                recentMessages: [],
            },
            briefs,
        };
    };

    it('rejects graphs with missing dependencies', async () => {
        const service = new OrchestrationService({ maxRetryAttempts: 0 });
        const request = buildRequest([buildBrief('node-a', ['node-z'])]);

        await expect(
            service.runDelegation(request, async () => 'unreachable'),
        ).rejects.toThrow("depends on missing node 'node-z'");
    });

    it('rejects cyclic delegation graphs', async () => {
        const service = new OrchestrationService({ maxRetryAttempts: 0 });
        const request = buildRequest([
            buildBrief('node-a', ['node-b']),
            buildBrief('node-b', ['node-a']),
        ]);

        await expect(
            service.runDelegation(request, async () => 'unreachable'),
        ).rejects.toThrow('contains one or more dependency cycles');
    });

    it('executes nodes in dependency order', async () => {
        const service = new OrchestrationService({ maxConcurrentJobs: 3, maxRetryAttempts: 0 });
        const executionOrder: string[] = [];
        const request = buildRequest([
            buildBrief('node-c', ['node-b']),
            buildBrief('node-a'),
            buildBrief('node-b', ['node-a']),
        ]);

        const result = await service.runDelegation(request, async ({ job }) => {
            executionOrder.push(job.brief.id);
            return `completed:${job.brief.id}`;
        });

        expect(executionOrder).toEqual(['node-a', 'node-b', 'node-c']);
        expect(result.jobs.map((job) => job.brief.id)).toEqual(['node-a', 'node-b', 'node-c']);
        expect(result.jobs.every((job) => job.state === 'completed')).toBe(true);
    });

    it('cancels dependent nodes when an upstream node fails', async () => {
        const service = new OrchestrationService({ maxRetryAttempts: 0 });
        const request = buildRequest([
            buildBrief('root'),
            buildBrief('child', ['root']),
            buildBrief('grandchild', ['child']),
        ]);

        const result = await service.runDelegation(request, async ({ job }) => {
            if (job.brief.id === 'root') {
                throw new Error('root-failure');
            }
            return `completed:${job.brief.id}`;
        });

        const states = Object.fromEntries(result.jobs.map((job) => [job.brief.id, job.state]));
        expect(states.root).toBe('failed');
        expect(states.child).toBe('cancelled');
        expect(states.grandchild).toBe('cancelled');
        expect(result.hasFailures).toBe(true);
    });

    it('retries within configured boundaries and succeeds on second attempt', async () => {
        const service = new OrchestrationService({ maxRetryAttempts: 1 });
        const request = buildRequest([buildBrief('retry-node')]);
        let attempts = 0;

        const result = await service.runDelegation(request, async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('transient-error');
            }
            return 'recovered';
        });

        expect(attempts).toBe(2);
        expect(result.jobs[0]?.state).toBe('completed');
        expect(result.jobs[0]?.attempt).toBe(2);
    });
});
