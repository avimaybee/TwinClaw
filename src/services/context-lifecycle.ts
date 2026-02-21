import type { Message } from '../core/types.js';
import { getConfigValue } from '../config/config-loader.js';
import type {
  ContextBudgetConfig,
  ContextHistoryPlan,
  ContextSectionResult,
  IndexedConversationMessage,
  RuntimeContextPlan,
} from '../types/context-budget.js';

const CHARS_PER_TOKEN = 4;

const DEFAULT_CONTEXT_BUDGET_CONFIG: ContextBudgetConfig = {
  totalBudgetTokens: 6_000,
  systemBudgetTokens: 1_800,
  historyBudgetTokens: 1_600,
  memoryBudgetTokens: 1_100,
  delegationBudgetTokens: 900,
  lifecycleBudgetTokens: 600,
  hotMessageLimit: 16,
  warmMessageLimit: 28,
  memoryTopKMin: 2,
  memoryTopKMax: 8,
  tokensPerMemoryItem: 130,
  maxSummaryEntries: 12,
  summarySnippetChars: 180,
};

export function estimateTokenCount(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / CHARS_PER_TOKEN));
}

export function resolveContextBudgetConfig(
  overrides: Partial<ContextBudgetConfig> = {},
): ContextBudgetConfig {
  const configured: ContextBudgetConfig = {
    totalBudgetTokens: readIntEnv('CONTEXT_BUDGET_TOTAL_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.totalBudgetTokens),
    systemBudgetTokens: readIntEnv('CONTEXT_BUDGET_SYSTEM_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.systemBudgetTokens),
    historyBudgetTokens: readIntEnv('CONTEXT_BUDGET_HISTORY_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.historyBudgetTokens),
    memoryBudgetTokens: readIntEnv('CONTEXT_BUDGET_MEMORY_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.memoryBudgetTokens),
    delegationBudgetTokens: readIntEnv('CONTEXT_BUDGET_DELEGATION_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.delegationBudgetTokens),
    lifecycleBudgetTokens: readIntEnv('CONTEXT_BUDGET_LIFECYCLE_TOKENS', DEFAULT_CONTEXT_BUDGET_CONFIG.lifecycleBudgetTokens),
    hotMessageLimit: readIntEnv('CONTEXT_HOT_MESSAGE_LIMIT', DEFAULT_CONTEXT_BUDGET_CONFIG.hotMessageLimit),
    warmMessageLimit: readIntEnv('CONTEXT_WARM_MESSAGE_LIMIT', DEFAULT_CONTEXT_BUDGET_CONFIG.warmMessageLimit),
    memoryTopKMin: readIntEnv('CONTEXT_MEMORY_TOPK_MIN', DEFAULT_CONTEXT_BUDGET_CONFIG.memoryTopKMin),
    memoryTopKMax: readIntEnv('CONTEXT_MEMORY_TOPK_MAX', DEFAULT_CONTEXT_BUDGET_CONFIG.memoryTopKMax),
    tokensPerMemoryItem: readIntEnv('CONTEXT_MEMORY_TOKENS_PER_ITEM', DEFAULT_CONTEXT_BUDGET_CONFIG.tokensPerMemoryItem),
    maxSummaryEntries: readIntEnv('CONTEXT_SUMMARY_MAX_ENTRIES', DEFAULT_CONTEXT_BUDGET_CONFIG.maxSummaryEntries),
    summarySnippetChars: readIntEnv('CONTEXT_SUMMARY_SNIPPET_CHARS', DEFAULT_CONTEXT_BUDGET_CONFIG.summarySnippetChars),
  };

  const merged: ContextBudgetConfig = {
    ...DEFAULT_CONTEXT_BUDGET_CONFIG,
    ...configured,
    ...overrides,
  };

  const memoryTopKMin = Math.max(1, merged.memoryTopKMin);
  const memoryTopKMax = Math.max(memoryTopKMin, merged.memoryTopKMax);

  return {
    ...merged,
    totalBudgetTokens: Math.max(1_000, merged.totalBudgetTokens),
    systemBudgetTokens: Math.max(200, merged.systemBudgetTokens),
    historyBudgetTokens: Math.max(200, merged.historyBudgetTokens),
    memoryBudgetTokens: Math.max(100, merged.memoryBudgetTokens),
    delegationBudgetTokens: Math.max(100, merged.delegationBudgetTokens),
    lifecycleBudgetTokens: Math.max(80, merged.lifecycleBudgetTokens),
    hotMessageLimit: Math.max(1, merged.hotMessageLimit),
    warmMessageLimit: Math.max(0, merged.warmMessageLimit),
    memoryTopKMin,
    memoryTopKMax,
    tokensPerMemoryItem: Math.max(20, merged.tokensPerMemoryItem),
    maxSummaryEntries: Math.max(1, merged.maxSummaryEntries),
    summarySnippetChars: Math.max(40, merged.summarySnippetChars),
  };
}

export class ContextLifecycleOrchestrator {
  readonly #config: ContextBudgetConfig;

  constructor(overrides: Partial<ContextBudgetConfig> = {}) {
    this.#config = resolveContextBudgetConfig(overrides);
  }

  get config(): ContextBudgetConfig {
    return this.#config;
  }

  estimateTokens(value: string): number {
    return estimateTokenCount(value);
  }

  planHistoryWindow(conversationHistory: Message[]): ContextHistoryPlan {
    const indexed = conversationHistory.map<IndexedConversationMessage>((message, index) => ({
      index: index + 1,
      message,
    }));

    const hotStart = Math.max(0, indexed.length - this.#config.hotMessageLimit);
    const warmStart = Math.max(0, hotStart - this.#config.warmMessageLimit);

    const hotCandidates = indexed.slice(hotStart);
    const warmCandidates = indexed.slice(warmStart, hotStart);
    const archivedCandidates = indexed.slice(0, warmStart);

    const selectedHot: IndexedConversationMessage[] = [];
    const overflowToWarm: IndexedConversationMessage[] = [];
    let hotTokens = 0;

    for (let pointer = hotCandidates.length - 1; pointer >= 0; pointer -= 1) {
      const candidate = hotCandidates[pointer];
      if (!candidate) {
        continue;
      }

      const candidateTokens = this.#estimateMessageTokens(candidate.message);
      const withinBudget = hotTokens + candidateTokens <= this.#config.historyBudgetTokens;

      if (selectedHot.length === 0 || withinBudget) {
        selectedHot.push(candidate);
        hotTokens += candidateTokens;
      } else {
        overflowToWarm.push(candidate);
      }
    }

    selectedHot.reverse();
    overflowToWarm.reverse();

    const warmPool = [...warmCandidates, ...overflowToWarm].sort((a, b) => a.index - b.index);
    const hotHistory = selectedHot.map((entry) => entry.message);
    const warmSummary = this.#buildTierSummary('warm', warmPool);
    const archivedSummary = this.#buildArchivedSummary(archivedCandidates);

    const unusedHistoryTokens = Math.max(0, this.#config.historyBudgetTokens - hotTokens);
    const memoryBudgetTokens = this.#config.memoryBudgetTokens + Math.floor(unusedHistoryTokens / 2);
    const derivedTopK = Math.floor(memoryBudgetTokens / this.#config.tokensPerMemoryItem);
    const memoryTopK = clamp(derivedTopK, this.#config.memoryTopKMin, this.#config.memoryTopKMax);

    const diagnostics: string[] = [];
    if (overflowToWarm.length > 0) {
      diagnostics.push(
        `Shifted ${overflowToWarm.length} recent message(s) from hot tier to warm summary due to history budget limits.`,
      );
    }
    if (archivedCandidates.length > 0) {
      diagnostics.push(
        `Archived ${archivedCandidates.length} older message(s) into compact provenance summaries.`,
      );
    }
    diagnostics.push(
      `Adaptive memory retrieval depth selected topK=${memoryTopK} using memory budget ${memoryBudgetTokens} tokens.`,
    );

    const warmSummaryTokens = this.estimateTokens(warmSummary);
    const archivedSummaryTokens = this.estimateTokens(archivedSummary);

    return {
      hotHistory,
      warmSummary,
      archivedSummary,
      memoryTopK,
      diagnostics,
      stats: {
        totalHistoryMessages: indexed.length,
        hotMessages: hotHistory.length,
        warmMessages: warmPool.length,
        archivedMessages: archivedCandidates.length,
        hotTokens,
        warmSummaryTokens,
        archivedSummaryTokens,
        historyBudgetTokens: this.#config.historyBudgetTokens,
        memoryBudgetTokens,
        memoryTopK,
        wasCompacted: overflowToWarm.length > 0 || archivedCandidates.length > 0,
      },
    };
  }

  planRuntimeContext(input: {
    memoryContext: string;
    delegationContext: string;
    warmSummary: string;
    archivedSummary: string;
  }): RuntimeContextPlan {
    const memory = this.#compactSection(
      'memory context',
      input.memoryContext,
      this.#config.memoryBudgetTokens,
    );
    const delegation = this.#compactSection(
      'delegation context',
      input.delegationContext,
      this.#config.delegationBudgetTokens,
    );

    const lifecycleBudgetTokens = this.#config.lifecycleBudgetTokens;
    let warmBudgetTokens = Math.floor(lifecycleBudgetTokens * 0.65);
    let archivedBudgetTokens = lifecycleBudgetTokens - warmBudgetTokens;

    if (warmBudgetTokens < 40) {
      warmBudgetTokens = 40;
      archivedBudgetTokens = Math.max(0, lifecycleBudgetTokens - warmBudgetTokens);
    }

    if (archivedBudgetTokens < 30) {
      archivedBudgetTokens = Math.min(30, lifecycleBudgetTokens);
      warmBudgetTokens = Math.max(0, lifecycleBudgetTokens - archivedBudgetTokens);
    }

    const warm = this.#compactSection('warm tier summary', input.warmSummary, warmBudgetTokens);
    const archived = this.#compactSection(
      'archived tier summary',
      input.archivedSummary,
      archivedBudgetTokens,
    );

    const sections: string[] = [];
    if (memory.content) {
      sections.push(`### RETRIEVED MEMORIES\n${memory.content}`);
    }
    if (delegation.content) {
      sections.push(`### DELEGATION CONTEXT\n${delegation.content}`);
    }
    if (warm.content) {
      sections.push(`### WARM MEMORY SUMMARY\n${warm.content}`);
    }
    if (archived.content) {
      sections.push(`### ARCHIVED MEMORY SUMMARY\n${archived.content}`);
    }

    const diagnostics = [memory, delegation, warm, archived]
      .filter((section) => section.wasCompacted || section.wasOmitted)
      .map((section) => section.note ?? `${section.label} was compacted.`);

    const totalTokens =
      memory.usedTokens + delegation.usedTokens + warm.usedTokens + archived.usedTokens;

    return {
      runtimeContext: sections.join('\n\n'),
      diagnostics,
      sections: {
        memory,
        delegation,
        warm,
        archived,
      },
      stats: {
        memoryTokens: memory.usedTokens,
        delegationTokens: delegation.usedTokens,
        warmTokens: warm.usedTokens,
        archivedTokens: archived.usedTokens,
        totalTokens,
        wasCompacted: [memory, delegation, warm, archived].some(
          (section) => section.wasCompacted || section.wasOmitted,
        ),
      },
    };
  }

  compactSystemPrompt(systemPrompt: string): ContextSectionResult {
    return this.#compactSection('system prompt', systemPrompt, this.#config.systemBudgetTokens);
  }

  #compactSection(
    label: string,
    source: string,
    budgetTokens: number,
  ): ContextSectionResult {
    const normalized = source.trim();
    const originalTokens = this.estimateTokens(normalized);
    if (!normalized || originalTokens === 0) {
      return {
        label,
        content: '',
        originalTokens: 0,
        usedTokens: 0,
        wasCompacted: false,
        wasOmitted: false,
      };
    }

    if (originalTokens <= budgetTokens) {
      return {
        label,
        content: normalized,
        originalTokens,
        usedTokens: originalTokens,
        wasCompacted: false,
        wasOmitted: false,
      };
    }

    const budgetChars = Math.max(120, budgetTokens * CHARS_PER_TOKEN);
    if (budgetChars < 160) {
      const omitted = `[${label} omitted: insufficient budget (${budgetTokens} tokens).]`;
      return {
        label,
        content: omitted,
        originalTokens,
        usedTokens: this.estimateTokens(omitted),
        wasCompacted: true,
        wasOmitted: true,
        note: `${label} omitted because budget ${budgetTokens} tokens was below safe compaction threshold.`,
      };
    }

    const headChars = Math.max(48, Math.floor(budgetChars * 0.72));
    const tailChars = Math.max(32, Math.floor(budgetChars * 0.18));
    const head = normalized.slice(0, headChars).trimEnd();
    const tail = normalized.slice(-tailChars).trimStart();
    const compacted = `${head}\n...[${label} compacted ${originalTokens}→~${budgetTokens} tokens]...\n${tail}`;

    return {
      label,
      content: compacted,
      originalTokens,
      usedTokens: this.estimateTokens(compacted),
      wasCompacted: true,
      wasOmitted: false,
      note: `${label} compacted from ${originalTokens} tokens to fit budget ${budgetTokens}.`,
    };
  }

  #buildTierSummary(
    label: 'warm',
    entries: IndexedConversationMessage[],
  ): string {
    if (entries.length === 0) {
      return '';
    }

    const selected = entries.slice(-this.#config.maxSummaryEntries);
    const omittedCount = Math.max(0, entries.length - selected.length);

    const lines = selected.map((entry) => {
      const role = entry.message.role.toUpperCase();
      const snippet = this.#snippet(entry.message.content ?? '[no text]');
      return `- [#${entry.index}] ${role}: ${snippet}`;
    });

    if (omittedCount > 0) {
      lines.unshift(`- ${omittedCount} additional ${label} turn(s) omitted for compactness.`);
    }

    return [`${label.toUpperCase()} tier summary (${entries.length} turn(s))`, ...lines].join('\n');
  }

  #buildArchivedSummary(entries: IndexedConversationMessage[]): string {
    if (entries.length === 0) {
      return '';
    }

    const head = entries.slice(0, Math.min(2, entries.length));
    const tail = entries.slice(Math.max(2, entries.length - 2));
    const sampled = [...head, ...tail]
      .sort((a, b) => a.index - b.index)
      .filter((entry, index, arr) => index === 0 || arr[index - 1]?.index !== entry.index);

    const lines = sampled.map((entry) => {
      const role = entry.message.role.toUpperCase();
      const snippet = this.#snippet(entry.message.content ?? '[no text]');
      return `- [#${entry.index}] ${role}: ${snippet}`;
    });

    return [
      `ARCHIVED tier summary (${entries.length} turn(s) outside hot/warm retention windows)`,
      ...lines,
    ].join('\n');
  }

  #snippet(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '[empty]';
    }

    if (normalized.length <= this.#config.summarySnippetChars) {
      return normalized;
    }

    return `${normalized.slice(0, this.#config.summarySnippetChars - 3)}...`;
  }

  #estimateMessageTokens(message: Message): number {
    const content = message.content ?? '';
    return this.estimateTokens(`${message.role.toUpperCase()}: ${content}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readIntEnv(name: string, fallback: number): number {
  const raw = getConfigValue(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.floor(parsed);
}
