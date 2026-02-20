import { describe, expect, it } from 'vitest';
import { ContextLifecycleOrchestrator } from '../../src/services/context-lifecycle.js';
import type { Message } from '../../src/core/types.js';

describe('ContextLifecycleOrchestrator', () => {
  it('selects adaptive memory topK based on available budget', () => {
    const orchestrator = new ContextLifecycleOrchestrator({
      historyBudgetTokens: 600,
      memoryBudgetTokens: 800,
      tokensPerMemoryItem: 100,
      memoryTopKMin: 2,
      memoryTopKMax: 10,
      hotMessageLimit: 8,
      warmMessageLimit: 8,
    });

    const history = buildHistory(6, 'short');
    const plan = orchestrator.planHistoryWindow(history);

    expect(plan.hotHistory.length).toBe(6);
    expect(plan.memoryTopK).toBe(10);
    expect(plan.stats.wasCompacted).toBe(false);
  });

  it('partitions conversation into hot/warm/archived tiers with provenance summaries', () => {
    const orchestrator = new ContextLifecycleOrchestrator({
      historyBudgetTokens: 80,
      hotMessageLimit: 8,
      warmMessageLimit: 6,
      maxSummaryEntries: 4,
      summarySnippetChars: 40,
      memoryTopKMin: 1,
      memoryTopKMax: 6,
    });

    const history = buildHistory(20, 'very long content that will force compaction');
    const plan = orchestrator.planHistoryWindow(history);

    expect(plan.stats.hotMessages).toBeLessThanOrEqual(8);
    expect(plan.stats.warmMessages).toBeGreaterThan(0);
    expect(plan.stats.archivedMessages).toBeGreaterThan(0);
    expect(plan.warmSummary).toContain('WARM tier summary');
    expect(plan.warmSummary).toContain('[#');
    expect(plan.archivedSummary).toContain('ARCHIVED tier summary');
    expect(plan.stats.wasCompacted).toBe(true);
  });

  it('compacts runtime context sections when segment budgets are exceeded', () => {
    const orchestrator = new ContextLifecycleOrchestrator({
      memoryBudgetTokens: 40,
      delegationBudgetTokens: 30,
      lifecycleBudgetTokens: 40,
      summarySnippetChars: 60,
    });

    const huge = 'x'.repeat(2_000);
    const runtimePlan = orchestrator.planRuntimeContext({
      memoryContext: huge,
      delegationContext: huge,
      warmSummary: huge,
      archivedSummary: huge,
    });

    expect(runtimePlan.stats.wasCompacted).toBe(true);
    expect(runtimePlan.sections.memory.wasCompacted).toBe(true);
    expect(runtimePlan.sections.delegation.wasCompacted).toBe(true);
    expect(runtimePlan.runtimeContext).toContain('compacted');
  });

  it('compacts oversized system prompts within configured limits', () => {
    const orchestrator = new ContextLifecycleOrchestrator({
      systemBudgetTokens: 70,
    });

    const section = orchestrator.compactSystemPrompt('system '.repeat(600));

    expect(section.wasCompacted).toBe(true);
    expect(section.usedTokens).toBeLessThan(section.originalTokens);
    expect(section.content).toContain('system prompt compacted');
  });
});

function buildHistory(size: number, payload: string): Message[] {
  const roles: Array<Message['role']> = ['user', 'assistant', 'tool'];

  return Array.from({ length: size }, (_, index) => ({
    role: roles[index % roles.length] ?? 'user',
    content: `${index + 1}:${payload} ${'segment '.repeat(12)}`,
  }));
}
