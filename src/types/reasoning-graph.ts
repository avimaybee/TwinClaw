export type ReasoningNodeType = 'entity' | 'fact' | 'task' | 'artifact';

export type ReasoningEdgeRelation =
  | 'supports'
  | 'contradicts'
  | 'depends_on'
  | 'derived_from';

export interface ReasoningNodeUpsertInput {
  nodeId: string;
  claimKey: string;
  nodeType: ReasoningNodeType;
  sourceRole: string;
  canonicalText: string;
  polarity: 1 | -1;
  confidence: number;
  sessionId: string;
}

export interface ReasoningEdgeUpsertInput {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: ReasoningEdgeRelation;
  weight: number;
  provenance: string;
}

export interface MemoryProvenanceRow {
  memoryRowId: number;
  nodeId: string;
  claimKey: string;
  nodeType: ReasoningNodeType;
  polarity: 1 | -1;
  canonicalText: string;
  updatedAt: string;
  supportsCount: number;
  contradictsCount: number;
  dependsCount: number;
  derivedCount: number;
}

export interface ReasoningEdgeRow {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: ReasoningEdgeRelation;
  weight: number;
  provenance: string;
  updatedAt: string;
}

export interface EvidenceAwareMemoryContext {
  context: string;
  diagnostics: string[];
  conflictCount: number;
  hitCount: number;
}
