import { randomUUID } from 'node:crypto';
import {
  cancelOrchestrationJob,
  completeOrchestrationJob,
  createOrchestrationJob,
  failOrchestrationJob,
  markOrchestrationJobRunning,
  queueOrchestrationRetry,
  saveOrchestrationEvent,
} from './db.js';
import {
  DelegationBrief,
  DelegationExecutionResult,
  DelegationRequest,
  OrchestrationJobSnapshot,
  OrchestrationJobState,
} from '../types/orchestration.js';
import { logThought } from '../utils/logger.js';

const DEFAULT_MAX_CONCURRENT_JOBS = 2;
const DEFAULT_JOB_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 1;
const DEFAULT_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 3;
const DEFAULT_MAX_GRAPH_NODES = 8;
const DEFAULT_MAX_GRAPH_DEPTH = 4;

const ALLOWED_TRANSITIONS: Record<OrchestrationJobState, OrchestrationJobState[]> = {
  queued: ['running', 'cancelled'],
  running: ['queued', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

type RuntimeJob = OrchestrationJobSnapshot & {
  nodeId: string;
  abortController: AbortController;
};

type DelegationGraph = {
  jobsByNodeId: Map<string, RuntimeJob>;
  dependentsByNodeId: Map<string, string[]>;
  unmetDependencies: Map<string, Set<string>>;
  pendingNodes: Set<string>;
  topologicalOrder: string[];
};

export interface DelegationExecutionInput {
  request: DelegationRequest;
  job: OrchestrationJobSnapshot;
  signal: AbortSignal;
}

export type DelegationExecutor = (input: DelegationExecutionInput) => Promise<string>;

export interface OrchestrationServiceOptions {
  maxConcurrentJobs?: number;
  jobTimeoutMs?: number;
  maxRetryAttempts?: number;
  failureCircuitBreakerThreshold?: number;
  maxGraphNodes?: number;
  maxGraphDepth?: number;
}

export class OrchestrationService {
  readonly #maxConcurrentJobs: number;
  readonly #jobTimeoutMs: number;
  readonly #maxRetryAttempts: number;
  readonly #failureCircuitBreakerThreshold: number;
  readonly #maxGraphNodes: number;
  readonly #maxGraphDepth: number;
  readonly #jobs: Map<string, RuntimeJob> = new Map();
  #consecutiveFailures = 0;

  constructor(options: OrchestrationServiceOptions = {}) {
    this.#maxConcurrentJobs = Math.max(
      1,
      Number(options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS),
    );
    this.#jobTimeoutMs = Math.max(1_000, Number(options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS));
    this.#maxRetryAttempts = Math.max(
      0,
      Number(options.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS),
    );
    this.#failureCircuitBreakerThreshold = Math.max(
      1,
      Number(options.failureCircuitBreakerThreshold ?? DEFAULT_FAILURE_CIRCUIT_BREAKER_THRESHOLD),
    );
    this.#maxGraphNodes = Math.max(1, Number(options.maxGraphNodes ?? DEFAULT_MAX_GRAPH_NODES));
    this.#maxGraphDepth = Math.max(1, Number(options.maxGraphDepth ?? DEFAULT_MAX_GRAPH_DEPTH));
  }

  observe(jobId: string): OrchestrationJobSnapshot | undefined {
    const job = this.#jobs.get(jobId);
    return job ? this.#snapshot(job) : undefined;
  }

  cancel(jobId: string, reason = 'Cancelled by runtime operator.'): boolean {
    const job = this.#jobs.get(jobId);
    if (!job || this.#isTerminal(job.state)) {
      return false;
    }

    job.abortController.abort();
    this.#transition(job, 'cancelled', reason);
    return true;
  }

  async runDelegation(
    request: DelegationRequest,
    executor: DelegationExecutor,
  ): Promise<DelegationExecutionResult> {
    if (request.briefs.length === 0) {
      return {
        jobs: [],
        summary: 'Delegation skipped: no briefs were provided.',
        hasFailures: false,
      };
    }

    if (this.#consecutiveFailures >= this.#failureCircuitBreakerThreshold) {
      const summary =
        'Delegation circuit-breaker is open after repeated failures; execution was blocked.';
      await logThought(`[Orchestration] ${summary}`);
      return {
        jobs: [],
        summary,
        hasFailures: true,
      };
    }

    const graph = this.#buildGraph(request);
    await this.#runGraph(graph, request, executor);

    const snapshots = graph.topologicalOrder
      .map((nodeId) => graph.jobsByNodeId.get(nodeId))
      .filter((job): job is RuntimeJob => !!job)
      .map((job) => this.#snapshot(job));
    const hasFailures = snapshots.some((job) => job.state === 'failed' || job.state === 'cancelled');
    const summary = this.#buildSummary(snapshots);

    await logThought(
      `[Orchestration] Delegation finished for session '${request.sessionId}' with ${snapshots.length} job(s).`,
    );

    return {
      jobs: snapshots,
      summary,
      hasFailures,
    };
  }

  #createJob(request: DelegationRequest, brief: DelegationBrief): RuntimeJob {
    const timestamp = new Date().toISOString();
    const job: RuntimeJob = {
      id: randomUUID(),
      nodeId: brief.id,
      sessionId: request.sessionId,
      parentMessage: request.parentMessage,
      brief,
      state: 'queued',
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      abortController: new AbortController(),
    };

    this.#jobs.set(job.id, job);
    createOrchestrationJob(job.id, job.sessionId, job.parentMessage, JSON.stringify(job.brief));
    this.#recordEvent(job, 'queued', `Queued delegation job '${brief.title}'.`);
    return job;
  }

  #buildGraph(request: DelegationRequest): DelegationGraph {
    if (request.briefs.length > this.#maxGraphNodes) {
      throw new Error(
        `[Orchestration] Delegation graph has ${request.briefs.length} nodes, exceeding maxGraphNodes=${this.#maxGraphNodes}.`,
      );
    }

    const briefsById = new Map<string, DelegationBrief>();
    const dependentsByNodeId = new Map<string, string[]>();
    const unmetDependencies = new Map<string, Set<string>>();

    for (const brief of request.briefs) {
      const nodeId = brief.id.trim();
      if (!nodeId) {
        throw new Error('[Orchestration] Delegation brief id must be a non-empty string.');
      }
      if (briefsById.has(nodeId)) {
        throw new Error(`[Orchestration] Duplicate delegation node id '${nodeId}'.`);
      }

      briefsById.set(nodeId, { ...brief, id: nodeId });
      dependentsByNodeId.set(nodeId, []);
    }

    for (const brief of briefsById.values()) {
      const deps = brief.dependsOn ?? [];
      const normalizedDeps = deps.map((dep) => dep.trim()).filter(Boolean);
      if (normalizedDeps.some((dep) => dep === brief.id)) {
        throw new Error(`[Orchestration] Node '${brief.id}' cannot depend on itself.`);
      }

      for (const dep of normalizedDeps) {
        if (!briefsById.has(dep)) {
          throw new Error(
            `[Orchestration] Node '${brief.id}' depends on missing node '${dep}'.`,
          );
        }
        dependentsByNodeId.get(dep)?.push(brief.id);
      }

      unmetDependencies.set(brief.id, new Set(normalizedDeps));
    }

    const topologicalOrder = this.#topologicalSort(briefsById, dependentsByNodeId, unmetDependencies);
    if (topologicalOrder.length !== briefsById.size) {
      throw new Error('[Orchestration] Delegation graph contains one or more dependency cycles.');
    }

    const depth = this.#computeGraphDepth(topologicalOrder, briefsById);
    if (depth > this.#maxGraphDepth) {
      throw new Error(
        `[Orchestration] Delegation graph depth ${depth} exceeds maxGraphDepth=${this.#maxGraphDepth}.`,
      );
    }

    const jobsByNodeId = new Map<string, RuntimeJob>();
    for (const brief of briefsById.values()) {
      const job = this.#createJob(request, brief);
      jobsByNodeId.set(brief.id, job);
    }

    return {
      jobsByNodeId,
      dependentsByNodeId,
      unmetDependencies,
      pendingNodes: new Set(briefsById.keys()),
      topologicalOrder,
    };
  }

  #topologicalSort(
    briefsById: Map<string, DelegationBrief>,
    dependentsByNodeId: Map<string, string[]>,
    unmetDependencies: Map<string, Set<string>>,
  ): string[] {
    const inDegree = new Map<string, number>();
    for (const [nodeId, deps] of unmetDependencies) {
      inDegree.set(nodeId, deps.size);
    }

    const queue = [...briefsById.keys()].filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0);
    const ordered: string[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId) {
        continue;
      }
      ordered.push(nodeId);

      const children = dependentsByNodeId.get(nodeId) ?? [];
      for (const child of children) {
        const next = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, next);
        if (next === 0) {
          queue.push(child);
        }
      }
    }

    return ordered;
  }

  #computeGraphDepth(order: string[], briefsById: Map<string, DelegationBrief>): number {
    const depths = new Map<string, number>();
    let maxDepth = 0;

    for (const nodeId of order) {
      const deps = briefsById.get(nodeId)?.dependsOn ?? [];
      const depth = deps.length === 0
        ? 1
        : Math.max(...deps.map((dep) => depths.get(dep) ?? 1)) + 1;
      depths.set(nodeId, depth);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  async #runGraph(
    graph: DelegationGraph,
    request: DelegationRequest,
    executor: DelegationExecutor,
  ): Promise<void> {
    while (graph.pendingNodes.size > 0) {
      if (this.#consecutiveFailures >= this.#failureCircuitBreakerThreshold) {
        this.#cancelPendingGraphNodes(
          graph,
          'Cancelled because orchestration circuit-breaker opened.',
        );
        return;
      }

      const readyJobs = this.#selectReadyJobs(graph);
      if (readyJobs.length === 0) {
        this.#cancelPendingGraphNodes(
          graph,
          'Cancelled due to unresolved dependencies after upstream failures.',
        );
        return;
      }

      for (const batch of this.#chunkJobs(readyJobs, this.#maxConcurrentJobs)) {
        const outcomes = await Promise.all(
          batch.map((job) => this.#executeGraphJob(job, request, executor)),
        );

        for (const outcome of outcomes) {
          if (outcome.retryRequested) {
            continue;
          }

          graph.pendingNodes.delete(outcome.job.nodeId);

          if (outcome.job.state === 'completed') {
            this.#releaseDependents(outcome.job.nodeId, graph);
            continue;
          }

          if (outcome.job.state === 'failed' || outcome.job.state === 'cancelled') {
            this.#cancelDependents(
              outcome.job.nodeId,
              graph,
              outcome.job.error ?? 'Upstream dependency failed.',
            );
          }
        }
      }
    }
  }

  #selectReadyJobs(graph: DelegationGraph): RuntimeJob[] {
    const ready: RuntimeJob[] = [];

    for (const nodeId of graph.pendingNodes) {
      const job = graph.jobsByNodeId.get(nodeId);
      if (!job || job.state !== 'queued') {
        continue;
      }

      const unmet = graph.unmetDependencies.get(nodeId);
      if (!unmet || unmet.size === 0) {
        ready.push(job);
      }
    }

    ready.sort((a, b) => a.brief.id.localeCompare(b.brief.id));
    return ready;
  }

  async #executeGraphJob(
    job: RuntimeJob,
    request: DelegationRequest,
    executor: DelegationExecutor,
  ): Promise<{ job: RuntimeJob; retryRequested: boolean }> {
    if (this.#consecutiveFailures >= this.#failureCircuitBreakerThreshold) {
      this.#transition(job, 'cancelled', 'Cancelled because orchestration circuit-breaker opened.');
      return { job, retryRequested: false };
    }

    const retryRequested = await this.#executeJob(job, request, executor);
    return { job, retryRequested };
  }

  #releaseDependents(completedNodeId: string, graph: DelegationGraph): void {
    const dependents = graph.dependentsByNodeId.get(completedNodeId) ?? [];

    for (const childNodeId of dependents) {
      if (!graph.pendingNodes.has(childNodeId)) {
        continue;
      }

      const unmet = graph.unmetDependencies.get(childNodeId);
      if (!unmet || !unmet.has(completedNodeId)) {
        continue;
      }

      unmet.delete(completedNodeId);
      const childJob = graph.jobsByNodeId.get(childNodeId);
      if (!childJob) {
        continue;
      }

      if (unmet.size === 0) {
        this.#recordEvent(
          childJob,
          'queued',
          `All dependencies resolved for node '${childNodeId}'.`,
        );
      } else {
        this.#recordEvent(
          childJob,
          'queued',
          `Dependency '${completedNodeId}' resolved for node '${childNodeId}'. Remaining: ${[...unmet].join(', ')}`,
        );
      }
    }
  }

  #cancelDependents(failedNodeId: string, graph: DelegationGraph, reason: string): void {
    const queue = [...(graph.dependentsByNodeId.get(failedNodeId) ?? [])];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId || !graph.pendingNodes.has(nodeId)) {
        continue;
      }

      const job = graph.jobsByNodeId.get(nodeId);
      if (!job || this.#isTerminal(job.state)) {
        graph.pendingNodes.delete(nodeId);
        continue;
      }

      this.#transition(
        job,
        'cancelled',
        `Cancelled because dependency '${failedNodeId}' did not complete successfully. ${reason}`,
      );
      graph.pendingNodes.delete(nodeId);

      const descendants = graph.dependentsByNodeId.get(nodeId) ?? [];
      queue.push(...descendants);
    }
  }

  #cancelPendingGraphNodes(graph: DelegationGraph, reason: string): void {
    for (const nodeId of [...graph.pendingNodes]) {
      const job = graph.jobsByNodeId.get(nodeId);
      if (!job || this.#isTerminal(job.state)) {
        graph.pendingNodes.delete(nodeId);
        continue;
      }
      this.#transition(job, 'cancelled', reason);
      graph.pendingNodes.delete(nodeId);
    }
  }

  #chunkJobs(jobs: RuntimeJob[], size: number): RuntimeJob[][] {
    const chunks: RuntimeJob[][] = [];
    for (let index = 0; index < jobs.length; index += size) {
      chunks.push(jobs.slice(index, index + size));
    }
    return chunks;
  }

  async #executeJob(
    job: RuntimeJob,
    request: DelegationRequest,
    executor: DelegationExecutor,
  ): Promise<boolean> {
    this.#transition(job, 'running', `Starting attempt ${job.attempt}.`);

    try {
      const output = await this.#executeWithTimeout(job, request, executor);
      this.#transition(job, 'completed', `Attempt ${job.attempt} completed.`, output);
      this.#consecutiveFailures = 0;
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canRetry = job.attempt <= this.#maxRetryAttempts;
      if (canRetry) {
        job.attempt += 1;
        this.#transition(job, 'queued', `Attempt failed; retrying. Reason: ${message}`);
        return true;
      }

      this.#transition(job, 'failed', `Attempt ${job.attempt} failed: ${message}`);
      this.#consecutiveFailures += 1;
      return false;
    }
  }

  async #executeWithTimeout(
    job: RuntimeJob,
    request: DelegationRequest,
    executor: DelegationExecutor,
  ): Promise<string> {
    const timeoutMs = job.brief.constraints.timeoutMs > 0
      ? job.brief.constraints.timeoutMs
      : this.#jobTimeoutMs;

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        job.abortController.abort();
        reject(new Error(`Delegated job timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        executor({
          request,
          job: this.#snapshot(job),
          signal: job.abortController.signal,
        }),
        timeoutPromise,
      ]);
      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  #transition(
    job: RuntimeJob,
    nextState: OrchestrationJobState,
    detail: string,
    output?: string,
  ): void {
    const allowed = ALLOWED_TRANSITIONS[job.state];
    if (!allowed.includes(nextState)) {
      throw new Error(
        `[Orchestration] Illegal transition ${job.state} -> ${nextState} for job ${job.id}.`,
      );
    }

    job.state = nextState;
    job.updatedAt = new Date().toISOString();

    if (nextState === 'running') {
      job.startedAt = job.startedAt ?? job.updatedAt;
      markOrchestrationJobRunning(job.id, job.attempt);
    } else if (nextState === 'completed') {
      job.completedAt = job.updatedAt;
      job.output = output ?? '';
      completeOrchestrationJob(job.id, job.output);
    } else if (nextState === 'failed') {
      job.completedAt = job.updatedAt;
      job.error = detail;
      failOrchestrationJob(job.id, detail);
    } else if (nextState === 'cancelled') {
      job.completedAt = job.updatedAt;
      job.error = detail;
      cancelOrchestrationJob(job.id, detail);
    } else {
      queueOrchestrationRetry(job.id, job.attempt, detail);
    }

    this.#recordEvent(job, nextState, detail);
  }

  #recordEvent(job: RuntimeJob, state: OrchestrationJobState, detail: string): void {
    saveOrchestrationEvent({
      id: randomUUID(),
      jobId: job.id,
      sessionId: job.sessionId,
      state,
      detail,
    });
  }

  #snapshot(job: RuntimeJob): OrchestrationJobSnapshot {
    return {
      id: job.id,
      sessionId: job.sessionId,
      parentMessage: job.parentMessage,
      brief: job.brief,
      state: job.state,
      attempt: job.attempt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      output: job.output,
      error: job.error,
    };
  }

  #buildSummary(jobs: OrchestrationJobSnapshot[]): string {
    const completed = jobs.filter((job) => job.state === 'completed').length;
    const failed = jobs.filter((job) => job.state === 'failed').length;
    const cancelled = jobs.filter((job) => job.state === 'cancelled').length;

    const lines = jobs.map((job) => {
      const suffix = job.state === 'completed'
        ? (job.output ?? '').slice(0, 280)
        : (job.error ?? 'No error detail captured.');
      return `- ${job.brief.title} [${job.state}] ${suffix}`;
    });

    return [
      `Delegation summary: ${completed} completed, ${failed} failed, ${cancelled} cancelled.`,
      ...lines,
    ].join('\n');
  }

  #isTerminal(state: OrchestrationJobState): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  }
}
