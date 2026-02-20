import { createHash } from 'node:crypto';
import { chunkText, EmbeddingService } from './embedding-service.js';
import {
  getMemoryProvenanceRows,
  getNearestMemories,
  getReasoningEvidenceExpansion,
  getReasoningNodesByClaimKey,
  linkMemoryProvenance,
  saveMemoryEmbedding,
  upsertReasoningEdge,
  upsertReasoningNode,
} from './db.js';
import type {
  EvidenceAwareMemoryContext,
  MemoryProvenanceRow,
  ReasoningEdgeRelation,
  ReasoningNodeType,
  ReasoningNodeUpsertInput,
} from '../types/reasoning-graph.js';

const embeddingService = new EmbeddingService();
const NEGATION_PATTERN =
  /\b(no|not|never|without|cannot|can't|won't|dont|don't|didnt|didn't|isnt|isn't|arent|aren't|wasnt|wasn't|weren't)\b/i;
const CLAIM_KEY_STOPWORDS =
  /\b(a|an|the|and|or|to|of|for|in|on|at|with|is|are|was|were|be|been|being|do|does|did|this|that|it|as|by|from|no|not|never|without|cannot|cant|wont)\b/g;
const TASK_HINT_PATTERN = /\b(todo|task|implement|fix|build|create|refactor|ship|deploy)\b/i;
const MAX_RELATION_RECONCILIATION = 12;
const MAX_GRAPH_TRAVERSAL_DEPTH = 2;

type RankedMemoryCandidate = {
  sessionId: string;
  factText: string;
  memoryRowId: number;
  score: number;
  provenance: MemoryProvenanceRow | null;
  contradictionCount: number;
};

export async function indexConversationTurn(sessionId: string, role: string, content: string): Promise<void> {
  const normalized = content.trim();
  if (!normalized) {
    return;
  }

  const chunks = chunkText(normalized);
  let previousNodeId: string | null = null;

  for (const chunk of chunks) {
    const taggedChunk = `${role.toUpperCase()}: ${chunk}`;
    const embedding = await embeddingService.embedText(taggedChunk);
    if (!embedding) {
      continue;
    }

    const memoryRowId = saveMemoryEmbedding(sessionId, taggedChunk, embedding);
    const node = buildReasoningNode(sessionId, role, taggedChunk);
    upsertReasoningNode(node);
    linkMemoryProvenance(memoryRowId, node.nodeId, sessionId);

    if (previousNodeId && previousNodeId !== node.nodeId) {
      upsertReasoningEdge({
        edgeId: stableId('edge', `${previousNodeId}|${node.nodeId}|derived_from`),
        fromNodeId: previousNodeId,
        toNodeId: node.nodeId,
        relation: 'derived_from',
        weight: 0.55,
        provenance: `session:${sessionId}:turn-sequence`,
      });
    }
    previousNodeId = node.nodeId;

    reconcileClaimRelations(node);
  }
}

export async function retrieveEvidenceAwareMemoryContext(
  sessionId: string,
  prompt: string,
  topK = 5,
): Promise<EvidenceAwareMemoryContext> {
  const embedding = await embeddingService.embedText(prompt);
  if (!embedding) {
    return {
      context: '',
      diagnostics: ['Memory retrieval skipped because prompt embedding could not be generated.'],
      conflictCount: 0,
      hitCount: 0,
    };
  }

  const candidateLimit = Math.max(topK * 3, topK);
  const nearest = getNearestMemories(embedding, candidateLimit, sessionId);
  if (nearest.length === 0) {
    return {
      context: '',
      diagnostics: ['Memory retrieval found no nearest candidates for the active session scope.'],
      conflictCount: 0,
      hitCount: 0,
    };
  }

  const memoryRowIds = nearest.map((item) => item.memory_rowid);
  const provenanceRows = getMemoryProvenanceRows(memoryRowIds);
  const provenanceByMemoryId = new Map<number, MemoryProvenanceRow>(
    provenanceRows.map((row) => [row.memoryRowId, row]),
  );

  const seedNodeIds = Array.from(new Set(provenanceRows.map((row) => row.nodeId)));
  const graphExpansionLimit = Math.max(12, topK * 6);
  const expandedEdges = getReasoningEvidenceExpansion(
    seedNodeIds,
    MAX_GRAPH_TRAVERSAL_DEPTH,
    graphExpansionLimit,
  );
  const graphRelationCounts = buildGraphRelationCounts(expandedEdges);

  const ranked = nearest
    .map((candidate) =>
      scoreCandidate(candidate.session_id, candidate.fact_text, candidate.memory_rowid, candidate.distance, {
        provenance: provenanceByMemoryId.get(candidate.memory_rowid) ?? null,
        graphRelationCounts,
      }),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));

  const conflictCount = ranked.filter((candidate) => candidate.contradictionCount > 0).length;
  const lines = ranked.map((candidate, index) => formatEvidenceLine(index, candidate));
  const conflictNote =
    conflictCount > 0
      ? `\nPotential contradiction signals were detected in ${conflictCount} retrieved item(s).`
      : '';

  return {
    context: `Retrieved evidence-backed memories:\n${lines.join('\n')}${conflictNote}`,
    diagnostics: [
      `Hybrid memory retrieval ranked ${nearest.length} vector candidates down to ${ranked.length} evidence-backed items.`,
      `Graph traversal depth=${MAX_GRAPH_TRAVERSAL_DEPTH} collected ${expandedEdges.length} relation edge(s).`,
      conflictCount > 0
        ? `Detected contradiction signals in ${conflictCount} candidate(s).`
        : 'No contradiction signals detected in selected evidence set.',
    ],
    conflictCount,
    hitCount: ranked.length,
  };
}

export async function retrieveMemoryContext(sessionId: string, prompt: string, topK = 5): Promise<string> {
  const result = await retrieveEvidenceAwareMemoryContext(sessionId, prompt, topK);
  return result.context;
}

function buildReasoningNode(sessionId: string, role: string, content: string): ReasoningNodeUpsertInput {
  const claimKey = normalizeClaimKey(content);
  const polarity = detectPolarity(content);
  return {
    nodeId: stableId('node', `${claimKey}|${polarity}`),
    claimKey,
    nodeType: inferNodeType(role, content),
    sourceRole: role.toLowerCase(),
    canonicalText: content.trim(),
    polarity,
    confidence: 0.68,
    sessionId,
  };
}

function normalizeClaimKey(content: string): string {
  const normalized = content
    .replace(/^[A-Z]+:\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutNegation = normalized
    .replace(
      /\b(no|not|never|without|cannot|cant|wont|dont|didnt|isnt|arent|wasnt|werent)\b/g,
      ' ',
    )
    .replace(CLAIM_KEY_STOPWORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const claim = withoutNegation || normalized;
  return claim.slice(0, 180).trim();
}

function inferNodeType(role: string, content: string): ReasoningNodeType {
  if (role.toLowerCase() === 'tool') {
    return 'artifact';
  }

  if (TASK_HINT_PATTERN.test(content)) {
    return 'task';
  }

  return 'fact';
}

function detectPolarity(content: string): 1 | -1 {
  return NEGATION_PATTERN.test(content) ? -1 : 1;
}

function stableId(prefix: string, seed: string): string {
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 20);
  return `${prefix}:${digest}`;
}

function reconcileClaimRelations(node: ReasoningNodeUpsertInput): void {
  const related = getReasoningNodesByClaimKey(node.claimKey)
    .filter((item) => item.node_id !== node.nodeId)
    .slice(0, MAX_RELATION_RECONCILIATION);

  for (const item of related) {
    const relation: ReasoningEdgeRelation = item.polarity === node.polarity ? 'supports' : 'contradicts';
    const provenance = `claim:${node.claimKey.slice(0, 40)}`;
    upsertReasoningEdge({
      edgeId: stableId('edge', `${item.node_id}|${node.nodeId}|${relation}`),
      fromNodeId: item.node_id,
      toNodeId: node.nodeId,
      relation,
      weight: relation === 'supports' ? 0.72 : 0.9,
      provenance,
    });

    if (relation === 'supports' || relation === 'contradicts') {
      upsertReasoningEdge({
        edgeId: stableId('edge', `${node.nodeId}|${item.node_id}|${relation}`),
        fromNodeId: node.nodeId,
        toNodeId: item.node_id,
        relation,
        weight: relation === 'supports' ? 0.72 : 0.9,
        provenance,
      });
    }
  }
}

function buildGraphRelationCounts(
  edges: ReturnType<typeof getReasoningEvidenceExpansion>,
): Map<string, { supports: number; contradicts: number; depends: number; derived: number }> {
  const counts = new Map<string, { supports: number; contradicts: number; depends: number; derived: number }>();

  const increment = (nodeId: string, relation: ReasoningEdgeRelation): void => {
    const current = counts.get(nodeId) ?? { supports: 0, contradicts: 0, depends: 0, derived: 0 };
    if (relation === 'supports') {
      current.supports += 1;
    } else if (relation === 'contradicts') {
      current.contradicts += 1;
    } else if (relation === 'depends_on') {
      current.depends += 1;
    } else if (relation === 'derived_from') {
      current.derived += 1;
    }
    counts.set(nodeId, current);
  };

  for (const edge of edges) {
    increment(edge.fromNodeId, edge.relation);
    increment(edge.toNodeId, edge.relation);
  }

  return counts;
}

function scoreCandidate(
  sessionId: string,
  factText: string,
  memoryRowId: number,
  distance: number,
  options: {
    provenance: MemoryProvenanceRow | null;
    graphRelationCounts: Map<string, { supports: number; contradicts: number; depends: number; derived: number }>;
  },
): RankedMemoryCandidate {
  const provenance = options.provenance;
  const vectorScore = 1 / (1 + Math.max(0, distance));
  const graphCounts = provenance
    ? options.graphRelationCounts.get(provenance.nodeId) ?? {
        supports: 0,
        contradicts: 0,
        depends: 0,
        derived: 0,
      }
    : { supports: 0, contradicts: 0, depends: 0, derived: 0 };
  const supports = (provenance?.supportsCount ?? 0) + graphCounts.supports;
  const contradicts = (provenance?.contradictsCount ?? 0) + graphCounts.contradicts;
  const depends = (provenance?.dependsCount ?? 0) + graphCounts.depends;
  const derived = (provenance?.derivedCount ?? 0) + graphCounts.derived;
  const relationScore = Math.min(1, supports * 0.2 + depends * 0.11 + derived * 0.08);
  const recencyScore = estimateRecencyScore(provenance?.updatedAt);
  const contradictionPenalty = Math.min(0.35, contradicts * 0.08);
  const score = vectorScore * 0.62 + relationScore * 0.26 + recencyScore * 0.12 - contradictionPenalty;

  return {
    sessionId,
    factText,
    memoryRowId,
    score,
    provenance,
    contradictionCount: contradicts,
  };
}

function estimateRecencyScore(updatedAt?: string): number {
  if (!updatedAt) {
    return 0.5;
  }

  const timestamp = Date.parse(updatedAt.replace(' ', 'T'));
  if (!Number.isFinite(timestamp)) {
    return 0.5;
  }

  const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
  if (ageHours <= 1) {
    return 1;
  }
  if (ageHours <= 24) {
    return 0.82;
  }
  if (ageHours <= 24 * 7) {
    return 0.67;
  }
  return 0.48;
}

function formatEvidenceLine(index: number, candidate: RankedMemoryCandidate): string {
  const snippet = candidate.factText.length > 220
    ? `${candidate.factText.slice(0, 217)}...`
    : candidate.factText;
  const nodeRef = candidate.provenance?.nodeId.slice(0, 18) ?? 'unlinked';
  const claimRef = candidate.provenance?.claimKey.slice(0, 28) ?? 'unlinked';
  return (
    `${index + 1}. (${candidate.sessionId}) ${snippet}\n` +
    `   provenance=[memory:${candidate.memoryRowId} node:${nodeRef} claim:${claimRef}] score=${candidate.score.toFixed(3)}`
  );
}
