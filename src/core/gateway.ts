import { randomUUID } from 'node:crypto';
import { createSession, getSessionMessages, saveMessage } from '../services/db.js';
import { ModelRouter } from '../services/model-router.js';
import { indexConversationTurn, retrieveMemoryContext } from '../services/semantic-memory.js';
import type { GatewayHandler, InboundMessage } from '../types/messaging.js';
import { assembleContext } from './context-assembly.js';
import { LaneExecutor } from './lane-executor.js';
import type { Message, Tool } from './types.js';
import { SkillRegistry } from '../services/skill-registry.js';
import type { Skill } from '../skills/types.js';

const DEFAULT_MAX_TOOL_ROUNDS = 6;

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
}

export class Gateway implements GatewayHandler {
  readonly #router: ModelRouter;
  readonly #laneExecutor: LaneExecutor;
  readonly #registry: SkillRegistry;
  #tools: Tool[] = [];
  readonly #maxToolRounds: number;

  constructor(registry: SkillRegistry, options: GatewayOptions = {}) {
    this.#router = new ModelRouter();
    this.#registry = registry;
    this.#laneExecutor = new LaneExecutor();
    this.#maxToolRounds =
      Number.isFinite(options.maxToolRounds) && (options.maxToolRounds ?? 0) > 0
        ? Number(options.maxToolRounds)
        : DEFAULT_MAX_TOOL_ROUNDS;

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
    await this.#persistTurn(sessionId, 'user', normalizedText);

    const memoryContext = await retrieveMemoryContext(sessionId, normalizedText);
    const systemPrompt = await assembleContext(memoryContext);

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...toConversationHistory(historyRows),
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

      const toolResults = await this.#laneExecutor.executeToolCalls(assistantMessage);
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
}
