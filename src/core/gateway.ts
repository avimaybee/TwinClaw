import { randomUUID } from 'node:crypto';
import { createSession, getSessionMessages, saveMessage } from '../services/db.js';
import { ModelRouter } from '../services/model-router.js';
import { indexConversationTurn, retrieveMemoryContext } from '../services/semantic-memory.js';
import { OrchestrationService } from '../services/orchestration-service.js';
import type { GatewayHandler, InboundMessage } from '../types/messaging.js';
import type {
  DelegationBrief,
  DelegationRequest,
  OrchestrationJobSnapshot,
} from '../types/orchestration.js';
import { assembleContext } from './context-assembly.js';
import { LaneExecutor } from './lane-executor.js';
import type { Message, Tool } from './types.js';
import { SkillRegistry } from '../services/skill-registry.js';
import type { Skill } from '../skills/types.js';
import { PolicyEngine } from '../services/policy-engine.js';

const DEFAULT_MAX_TOOL_ROUNDS = 6;
const DEFAULT_DELEGATION_MIN_SCORE = 2;
const DELEGATION_KEYWORDS = [
  'complex',
  'analyze',
  'analysis',
  'reasoning',
  'investigate',
  'architecture',
  'tradeoff',
  'plan',
  'design',
  'multi-step',
  'parallel',
] as const;

type PersistedMessageRow = {
  role: string;
  content: string;
};

function isConversationRole(value: string): value is 'user' | 'assistant' | 'tool' {
  return value === 'user' || value === 'assistant' || value === 'tool';
}

function toConversationHistory(rows: PersistedMessageRow[]): Message[] {
  return rows
    .filter((row) => isConversationRole(row.role))
    .map((row) => ({
      role: row.role as 'user' | 'assistant' | 'tool',
      content: row.content,
    }));
}

function skillToTool(skill: Skill): Tool {
  return {
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters ?? {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    },
    execute: async (args) => {
      const result = await skill.execute(args);
      return result.output;
    },
  };
}

export interface GatewayOptions {
  maxToolRounds?: number;
  router?: ModelRouter;
  orchestration?: OrchestrationService;
  policyEngine?: PolicyEngine;
  enableDelegation?: boolean;
  delegationMinScore?: number;
}

export class Gateway implements GatewayHandler {
  readonly #router: ModelRouter;
  readonly #orchestration: OrchestrationService;
  readonly #laneExecutor: LaneExecutor;
  readonly #policyEngine: PolicyEngine;
  readonly #registry: SkillRegistry;
  #tools: Tool[] = [];
  readonly #maxToolRounds: number;
  readonly #enableDelegation: boolean;
  readonly #delegationMinScore: number;

  constructor(registry: SkillRegistry, options: GatewayOptions = {}) {
    this.#router = options.router ?? new ModelRouter();
    this.#orchestration = options.orchestration ?? new OrchestrationService();
    this.#policyEngine = options.policyEngine ?? new PolicyEngine();
    this.#registry = registry;
    this.#laneExecutor = new LaneExecutor();
    this.#maxToolRounds =
      Number.isFinite(options.maxToolRounds) && (options.maxToolRounds ?? 0) > 0
        ? Number(options.maxToolRounds)
        : DEFAULT_MAX_TOOL_ROUNDS;
    this.#enableDelegation = options.enableDelegation ?? true;
    this.#delegationMinScore = Math.max(
      1,
      Number(options.delegationMinScore ?? DEFAULT_DELEGATION_MIN_SCORE),
    );

    this.refreshTools();
  }

  /** Sync the gateway's tool definitions with the current state of the skill registry. */
  refreshTools(): void {
    const skills = this.#registry.list();
    this.#tools = skills.map(skillToTool);
    this.#laneExecutor.syncFromRegistry(this.#registry);
  }

  async processMessage(message: InboundMessage): Promise<string> {
    const normalizedText = message.text?.trim();
    if (!normalizedText) {
      return 'I could not find any text content to process.';
    }

    const sessionId = `${message.platform}:${message.senderId}`;
    return this.processText(sessionId, normalizedText);
  }

  async processText(sessionId: string, text: string): Promise<string> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return 'Please provide a non-empty prompt.';
    }

    createSession(sessionId);
    const historyRows = getSessionMessages(sessionId) as PersistedMessageRow[];
    const conversationHistory = toConversationHistory(historyRows);
    await this.#persistTurn(sessionId, 'user', normalizedText);

    const memoryContext = await retrieveMemoryContext(sessionId, normalizedText);
    const delegationContext = await this.#runDelegationIfNeeded(
      sessionId,
      normalizedText,
      conversationHistory,
      memoryContext,
    );
    const runtimeContext = [memoryContext, delegationContext].filter(Boolean).join('\n\n');
    const systemPrompt = await assembleContext(runtimeContext);

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: normalizedText },
    ];

    return this.#runConversationLoop(sessionId, messages);
  }

  async #runConversationLoop(sessionId: string, messages: Message[]): Promise<string> {
    // Refresh tools at the start of each loop to catch newly connected MCP servers
    this.refreshTools();

    for (let round = 0; round < this.#maxToolRounds; round++) {
      const assistantMessage = (await this.#router.createChatCompletion(
        messages,
        this.#tools,
      )) as Message;

      const assistantContent = assistantMessage.content ?? '';
      messages.push({
        role: 'assistant',
        content: assistantContent,
        tool_calls: assistantMessage.tool_calls,
      });

      await this.#persistTurn(
        sessionId,
        'assistant',
        assistantContent || '[assistant returned tool calls without text content]',
      );

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return assistantContent || 'Done.';
      }

      const toolResults = await this.#laneExecutor.executeToolCalls(assistantMessage, sessionId);
      for (const toolMessage of toolResults) {
        messages.push(toolMessage);
        await this.#persistTurn(sessionId, 'tool', toolMessage.content ?? '');
      }
    }

    return `Stopped after ${this.#maxToolRounds} tool-execution rounds without a final text response.`;
  }

  async #persistTurn(
    sessionId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
  ): Promise<void> {
    saveMessage(randomUUID(), sessionId, role, content);
    if (role !== 'tool') {
      await indexConversationTurn(sessionId, role, content);
    }
  }

  async #runDelegationIfNeeded(
    sessionId: string,
    userText: string,
    history: Message[],
    memoryContext: string,
  ): Promise<string> {
    if (!this.#enableDelegation) {
      return '';
    }

    const request = this.#planDelegationRequest(sessionId, userText, history, memoryContext);
    if (!request) {
      return '';
    }

    try {
      const result = await this.#orchestration.runDelegation(
        request,
        async ({ request: delegationRequest, job, signal }) =>
          this.#executeDelegatedJob(delegationRequest, job, signal),
      );

      const report = `Delegation report\n${result.summary}`;
      await this.#persistTurn(sessionId, 'tool', report);
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const degraded = `Delegation failed and was skipped: ${message}`;
      await this.#persistTurn(sessionId, 'tool', degraded);
      return degraded;
    }
  }

  #planDelegationRequest(
    sessionId: string,
    userText: string,
    history: Message[],
    memoryContext: string,
  ): DelegationRequest | null {
    const complexityScore = this.#scorePromptComplexity(userText);
    if (complexityScore < this.#delegationMinScore) {
      return null;
    }

    const recentMessages = history
      .slice(-6)
      .filter((message) => isConversationRole(message.role))
      .map((message) => ({
        role: message.role as 'user' | 'assistant' | 'tool',
        content: message.content ?? '',
      }));

    const recentConversationBlock = recentMessages
      .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');

    const scopedContextParts = [
      memoryContext ? `Retrieved memory context:\n${memoryContext}` : '',
      recentConversationBlock ? `Recent conversation:\n${recentConversationBlock}` : '',
    ].filter(Boolean);
    const scopedContext = scopedContextParts.join('\n\n');

    const briefs: DelegationBrief[] = [
      {
        id: 'decompose',
        dependsOn: [],
        title: 'Problem decomposition',
        objective:
          'Break down the parent request into the smallest reliable execution steps and identify critical dependencies.',
        scopedContext,
        expectedOutput:
          'Return concise numbered steps and explicitly call out blockers or unknowns.',
        constraints: {
          toolBudget: 0,
          timeoutMs: 12_000,
          maxTurns: 1,
        },
      },
      {
        id: 'risk-analysis',
        dependsOn: ['decompose'],
        title: 'Failure modes and safeguards',
        objective:
          'Identify likely failure paths, edge cases, and reliability safeguards needed before execution.',
        scopedContext,
        expectedOutput:
          'Return bullet points grouped into risks, mitigations, and monitoring signals.',
        constraints: {
          toolBudget: 0,
          timeoutMs: 12_000,
          maxTurns: 1,
        },
      },
    ];

    if (userText.length > 420) {
      briefs.push({
        id: 'synthesis',
        dependsOn: ['decompose', 'risk-analysis'],
        title: 'Integration synthesis',
        objective:
          'Produce a merged implementation outline balancing speed, correctness, and rollback safety.',
        scopedContext,
        expectedOutput:
          'Return a practical execution sequence with explicit checkpoints and fallback behavior.',
        constraints: {
          toolBudget: 0,
          timeoutMs: 14_000,
          maxTurns: 1,
        },
      });
    }

    return {
      sessionId,
      parentMessage: userText,
      scope: {
        sessionId,
        memoryContext,
        recentMessages,
      },
      briefs,
    };
  }

  #scorePromptComplexity(prompt: string): number {
    const lower = prompt.toLowerCase();
    const tokenCount = prompt.split(/\s+/).filter(Boolean).length;

    let score = 0;
    if (tokenCount >= 55) {
      score += 1;
    }

    if (/\b(and|then|after that|while)\b/.test(lower)) {
      score += 1;
    }

    for (const keyword of DELEGATION_KEYWORDS) {
      if (lower.includes(keyword)) {
        score += 1;
      }
    }

    return score;
  }

  async #executeDelegatedJob(
    request: DelegationRequest,
    job: OrchestrationJobSnapshot,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) {
      throw new Error(`Delegated job '${job.id}' was cancelled before execution.`);
    }

    const scopedMessages = request.scope.recentMessages
      .map((item, index) => `${index + 1}. ${item.role.toUpperCase()}: ${item.content}`)
      .join('\n');

    const systemPrompt = [
      'You are a focused TwinClaw sub-agent.',
      'Do not ask follow-up questions.',
      'Do not invoke tools.',
      `Expected output contract: ${job.brief.expectedOutput}`,
    ].join('\n');

    const userPrompt = [
      `Parent objective: ${request.parentMessage}`,
      `Delegated brief: ${job.brief.title}`,
      `Sub-task objective: ${job.brief.objective}`,
      `Scoped context:\n${job.brief.scopedContext}`,
      scopedMessages ? `Scoped message history:\n${scopedMessages}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const response = (await this.#router.createChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])) as Message;

    if (signal.aborted) {
      throw new Error(`Delegated job '${job.id}' was cancelled during execution.`);
    }

    const content = response.content?.trim();
    if (!content) {
      throw new Error(`Delegated job '${job.id}' returned empty content.`);
    }

    return content;
  }
}
