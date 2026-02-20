import type { Message } from '../core/types.js';

export interface ContextBudgetConfig {
  totalBudgetTokens: number;
  systemBudgetTokens: number;
  historyBudgetTokens: number;
  memoryBudgetTokens: number;
  delegationBudgetTokens: number;
  lifecycleBudgetTokens: number;
  hotMessageLimit: number;
  warmMessageLimit: number;
  memoryTopKMin: number;
  memoryTopKMax: number;
  tokensPerMemoryItem: number;
  maxSummaryEntries: number;
  summarySnippetChars: number;
}

export interface IndexedConversationMessage {
  index: number;
  message: Message;
}

export interface ContextSectionResult {
  label: string;
  content: string;
  originalTokens: number;
  usedTokens: number;
  wasCompacted: boolean;
  wasOmitted: boolean;
  note?: string;
}

export interface ContextHistoryStats {
  totalHistoryMessages: number;
  hotMessages: number;
  warmMessages: number;
  archivedMessages: number;
  hotTokens: number;
  warmSummaryTokens: number;
  archivedSummaryTokens: number;
  historyBudgetTokens: number;
  memoryBudgetTokens: number;
  memoryTopK: number;
  wasCompacted: boolean;
}

export interface ContextHistoryPlan {
  hotHistory: Message[];
  warmSummary: string;
  archivedSummary: string;
  memoryTopK: number;
  diagnostics: string[];
  stats: ContextHistoryStats;
}

export interface RuntimeContextStats {
  memoryTokens: number;
  delegationTokens: number;
  warmTokens: number;
  archivedTokens: number;
  totalTokens: number;
  wasCompacted: boolean;
}

export interface RuntimeContextPlan {
  runtimeContext: string;
  diagnostics: string[];
  sections: {
    memory: ContextSectionResult;
    delegation: ContextSectionResult;
    warm: ContextSectionResult;
    archived: ContextSectionResult;
  };
  stats: RuntimeContextStats;
}
