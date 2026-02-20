export type OrchestrationJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Constraints applied to delegated sub-agent work. */
export interface DelegationConstraints {
  toolBudget: number;
  timeoutMs: number;
  maxTurns: number;
}

/** Work brief for one delegated sub-agent. */
export interface DelegationBrief {
  /** Stable node identifier within the delegation graph. */
  id: string;
  /** Upstream node IDs that must complete successfully first. */
  dependsOn?: string[];
  title: string;
  objective: string;
  scopedContext: string;
  expectedOutput: string;
  constraints: DelegationConstraints;
}

/** Context package prepared by the gateway for delegated jobs. */
export interface DelegationScope {
  sessionId: string;
  memoryContext: string;
  recentMessages: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
  }>;
}

/** One delegation request can spawn multiple jobs under the same parent turn. */
export interface DelegationRequest {
  sessionId: string;
  parentMessage: string;
  scope: DelegationScope;
  briefs: DelegationBrief[];
}

export interface OrchestrationJobSnapshot {
  id: string;
  sessionId: string;
  parentMessage: string;
  brief: DelegationBrief;
  state: OrchestrationJobState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

export interface DelegationExecutionResult {
  jobs: OrchestrationJobSnapshot[];
  summary: string;
  hasFailures: boolean;
}
