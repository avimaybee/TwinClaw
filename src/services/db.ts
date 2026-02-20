import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';
import type {
  MemoryProvenanceRow,
  ReasoningEdgeRow,
  ReasoningEdgeUpsertInput,
  ReasoningNodeUpsertInput,
} from '../types/reasoning-graph.js';
import type {
  CallbackOutcomeCounts,
  IncidentRemediationAction,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '../types/incident.js';
import type {
  LocalStateBackupScope,
  LocalStateBackupTrigger,
  LocalStateRestoreStatus,
} from '../types/local-state-backup.js';
import type {
  ModelRoutingEventType,
  ModelRoutingFallbackMode,
} from '../types/model-routing.js';
import type {
  RuntimeBudgetAction,
  RuntimeBudgetProfile,
  RuntimeBudgetSeverity,
  RuntimeUsageStage,
} from '../types/runtime-budget.js';

const DB_PATH = path.resolve('memory/twinclaw.db');
const MEMORY_EMBEDDING_DIM = Number(process.env.MEMORY_EMBEDDING_DIM ?? '1536') || 1536;

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

// Load sqlite-vec C extension
sqliteVec.load(db);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    content TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
  );

  CREATE TABLE IF NOT EXISTS orchestration_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_message TEXT NOT NULL,
    brief_json TEXT NOT NULL,
    state TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    output TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
  );

  CREATE TABLE IF NOT EXISTS orchestration_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    state TEXT NOT NULL,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES orchestration_jobs(id),
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
  );

  -- Virtual table for vector search
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(
    embedding float[${MEMORY_EMBEDDING_DIM}],
    session_id TEXT,
    fact_text TEXT
  );

  CREATE TABLE IF NOT EXISTS reasoning_nodes (
    node_id TEXT PRIMARY KEY,
    claim_key TEXT NOT NULL,
    node_type TEXT NOT NULL,
    source_role TEXT NOT NULL,
    canonical_text TEXT NOT NULL,
    polarity INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 0.5,
    first_session_id TEXT NOT NULL,
    last_session_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_reasoning_nodes_claim_key
    ON reasoning_nodes(claim_key);

  CREATE INDEX IF NOT EXISTS idx_reasoning_nodes_updated_at
    ON reasoning_nodes(updated_at DESC);

  CREATE TABLE IF NOT EXISTS reasoning_edges (
    edge_id TEXT PRIMARY KEY,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    provenance TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_node_id) REFERENCES reasoning_nodes(node_id),
    FOREIGN KEY(to_node_id) REFERENCES reasoning_nodes(node_id),
    UNIQUE(from_node_id, to_node_id, relation)
  );

  CREATE INDEX IF NOT EXISTS idx_reasoning_edges_from
    ON reasoning_edges(from_node_id);

  CREATE INDEX IF NOT EXISTS idx_reasoning_edges_to
    ON reasoning_edges(to_node_id);

  CREATE TABLE IF NOT EXISTS memory_provenance (
    memory_rowid INTEGER PRIMARY KEY,
    node_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(node_id) REFERENCES reasoning_nodes(node_id)
  );

  CREATE TABLE IF NOT EXISTS policy_audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    skill_name TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS callback_receipts (
    idempotency_key TEXT PRIMARY KEY,
    status_code INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS delivery_queue (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    text_payload TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at DATETIME,
    resolved_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS delivery_attempts (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error TEXT,
    duration_ms INTEGER,
    FOREIGN KEY(delivery_id) REFERENCES delivery_queue(id)
  );

  CREATE TABLE IF NOT EXISTS mcp_health_events (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    prev_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS mcp_scope_audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    server_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    outcome TEXT NOT NULL, -- 'allowed' | 'denied'
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS model_routing_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    model_id TEXT,
    model_name TEXT,
    provider TEXT,
    fallback_mode TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_model_routing_events_created
    ON model_routing_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS model_routing_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS local_state_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    entry_count INTEGER NOT NULL,
    manifest_path TEXT NOT NULL,
    checksum TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS local_state_restore_events (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT,
    outcome TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 0,
    scopes_json TEXT NOT NULL,
    restored_paths_json TEXT NOT NULL,
    skipped_paths_json TEXT NOT NULL,
    validation_errors_json TEXT NOT NULL,
    rollback_applied INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_local_state_snapshots_created
    ON local_state_snapshots(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_local_state_restore_events_created
    ON local_state_restore_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    incident_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    remediation_action TEXT NOT NULL DEFAULT 'none',
    remediation_attempts INTEGER NOT NULL DEFAULT 0,
    cooldown_until DATETIME,
    escalated INTEGER NOT NULL DEFAULT 0,
    recommended_actions_json TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS incident_timeline (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    incident_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(incident_id) REFERENCES incidents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_incidents_status_updated
    ON incidents(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_incident_timeline_created
    ON incident_timeline(created_at DESC);

  CREATE TABLE IF NOT EXISTS runtime_usage_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    model_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    profile TEXT NOT NULL,
    stage TEXT NOT NULL,
    request_tokens INTEGER NOT NULL DEFAULT 0,
    response_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS runtime_budget_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    severity TEXT NOT NULL,
    profile TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS runtime_budget_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_usage_events_created
    ON runtime_usage_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runtime_usage_events_provider
    ON runtime_usage_events(provider_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runtime_budget_events_created
    ON runtime_budget_events(created_at DESC);
`);

export type MemoryRow = {
  memory_rowid: number;
  session_id: string;
  fact_text: string;
  distance: number;
};

function serializeEmbedding(embedding: number[]): unknown {
  const sqliteVecWithSerializer = sqliteVec as unknown as {
    serializeFloat32?: (value: number[]) => unknown;
  };

  if (typeof sqliteVecWithSerializer.serializeFloat32 === 'function') {
    return sqliteVecWithSerializer.serializeFloat32(embedding);
  }

  return Buffer.from(new Float32Array(embedding).buffer);
}

export function createSession(sessionId: string) {
  const stmt = db.prepare('INSERT OR IGNORE INTO sessions (session_id) VALUES (?)');
  stmt.run(sessionId);
}

export function saveMessage(id: string, sessionId: string, role: string, content: string) {
  const stmt = db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)');
  stmt.run(id, sessionId, role, content);
}

export function getSessionMessages(sessionId: string) {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY rowid ASC');
  return stmt.all(sessionId);
}

export function saveMemoryEmbedding(sessionId: string, factText: string, embedding: number[]): number {
  const stmt = db.prepare('INSERT INTO vec_memory (embedding, session_id, fact_text) VALUES (?, ?, ?)');
  const result = stmt.run(serializeEmbedding(embedding), sessionId, factText) as { lastInsertRowid: number | bigint };
  return Number(result.lastInsertRowid);
}

export function getNearestMemories(queryEmbedding: number[], topK = 5, currentSessionId?: string): MemoryRow[] {
  const matcher = serializeEmbedding(queryEmbedding);

  const stmt = db.prepare(
    'SELECT rowid AS memory_rowid, session_id, fact_text, distance FROM vec_memory WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?'
  );

  const rows = stmt.all(matcher, topK * 3) as MemoryRow[];
  if (!currentSessionId) {
    return rows.slice(0, topK);
  }

  const scoped = rows.filter((row) => row.session_id === currentSessionId);
  const global = rows.filter((row) => row.session_id !== currentSessionId);
  return [...scoped, ...global].slice(0, topK);
}

export function upsertReasoningNode(input: ReasoningNodeUpsertInput): void {
  const stmt = db.prepare(`
    INSERT INTO reasoning_nodes (
      node_id,
      claim_key,
      node_type,
      source_role,
      canonical_text,
      polarity,
      confidence,
      first_session_id,
      last_session_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      claim_key = excluded.claim_key,
      node_type = excluded.node_type,
      source_role = excluded.source_role,
      canonical_text = excluded.canonical_text,
      polarity = excluded.polarity,
      confidence = excluded.confidence,
      last_session_id = excluded.last_session_id,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    input.nodeId,
    input.claimKey,
    input.nodeType,
    input.sourceRole,
    input.canonicalText,
    input.polarity,
    input.confidence,
    input.sessionId,
    input.sessionId,
  );
}

export function upsertReasoningEdge(input: ReasoningEdgeUpsertInput): void {
  const stmt = db.prepare(`
    INSERT INTO reasoning_edges (
      edge_id,
      from_node_id,
      to_node_id,
      relation,
      weight,
      provenance
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_node_id, to_node_id, relation) DO UPDATE SET
      weight = excluded.weight,
      provenance = excluded.provenance,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    input.edgeId,
    input.fromNodeId,
    input.toNodeId,
    input.relation,
    input.weight,
    input.provenance,
  );
}

export function linkMemoryProvenance(memoryRowId: number, nodeId: string, sessionId: string): void {
  const stmt = db.prepare(`
    INSERT INTO memory_provenance (memory_rowid, node_id, session_id)
    VALUES (?, ?, ?)
    ON CONFLICT(memory_rowid) DO UPDATE SET
      node_id = excluded.node_id,
      session_id = excluded.session_id,
      created_at = CURRENT_TIMESTAMP
  `);
  stmt.run(memoryRowId, nodeId, sessionId);
}

export function getReasoningNodesByClaimKey(claimKey: string): Array<{ node_id: string; polarity: number }> {
  const stmt = db.prepare(`
    SELECT node_id, polarity
    FROM reasoning_nodes
    WHERE claim_key = ?
    ORDER BY updated_at DESC
    LIMIT 24
  `);

  return stmt.all(claimKey) as Array<{ node_id: string; polarity: number }>;
}

export function getMemoryProvenanceRows(memoryRowIds: number[]): MemoryProvenanceRow[] {
  if (memoryRowIds.length === 0) {
    return [];
  }

  const placeholders = memoryRowIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT
      mp.memory_rowid AS memoryRowId,
      mp.node_id AS nodeId,
      rn.claim_key AS claimKey,
      rn.node_type AS nodeType,
      rn.polarity AS polarity,
      rn.canonical_text AS canonicalText,
      rn.updated_at AS updatedAt,
      SUM(CASE WHEN re.relation = 'supports' THEN 1 ELSE 0 END) AS supportsCount,
      SUM(CASE WHEN re.relation = 'contradicts' THEN 1 ELSE 0 END) AS contradictsCount,
      SUM(CASE WHEN re.relation = 'depends_on' THEN 1 ELSE 0 END) AS dependsCount,
      SUM(CASE WHEN re.relation = 'derived_from' THEN 1 ELSE 0 END) AS derivedCount
    FROM memory_provenance mp
    INNER JOIN reasoning_nodes rn ON rn.node_id = mp.node_id
    LEFT JOIN reasoning_edges re ON re.from_node_id = rn.node_id OR re.to_node_id = rn.node_id
    WHERE mp.memory_rowid IN (${placeholders})
    GROUP BY
      mp.memory_rowid,
      mp.node_id,
      rn.claim_key,
      rn.node_type,
      rn.polarity,
      rn.canonical_text,
      rn.updated_at
  `);

  return (stmt.all(...memoryRowIds) as Array<Record<string, unknown>>).map((row) => ({
    memoryRowId: Number(row.memoryRowId),
    nodeId: String(row.nodeId),
    claimKey: String(row.claimKey),
    nodeType: String(row.nodeType) as MemoryProvenanceRow['nodeType'],
    polarity: Number(row.polarity) < 0 ? -1 : 1,
    canonicalText: String(row.canonicalText),
    updatedAt: String(row.updatedAt),
    supportsCount: Number(row.supportsCount ?? 0),
    contradictsCount: Number(row.contradictsCount ?? 0),
    dependsCount: Number(row.dependsCount ?? 0),
    derivedCount: Number(row.derivedCount ?? 0),
  }));
}

export function getReasoningEvidenceExpansion(
  seedNodeIds: string[],
  maxDepth: number,
  limit: number,
): ReasoningEdgeRow[] {
  if (seedNodeIds.length === 0 || maxDepth < 1 || limit < 1) {
    return [];
  }

  const visited = new Set<string>(seedNodeIds);
  let frontier = new Set<string>(seedNodeIds);
  const collected = new Map<string, ReasoningEdgeRow>();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (frontier.size === 0 || collected.size >= limit) {
      break;
    }

    const frontierIds = Array.from(frontier);
    const placeholders = frontierIds.map(() => '?').join(', ');
    const remaining = Math.max(1, limit - collected.size);

    const stmt = db.prepare(`
      SELECT edge_id, from_node_id, to_node_id, relation, weight, provenance, updated_at
      FROM reasoning_edges
      WHERE from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(...frontierIds, ...frontierIds, remaining) as Array<{
      edge_id: string;
      from_node_id: string;
      to_node_id: string;
      relation: ReasoningEdgeRow['relation'];
      weight: number;
      provenance: string;
      updated_at: string;
    }>;

    const nextFrontier = new Set<string>();
    for (const row of rows) {
      if (!collected.has(row.edge_id)) {
        collected.set(row.edge_id, {
          edgeId: row.edge_id,
          fromNodeId: row.from_node_id,
          toNodeId: row.to_node_id,
          relation: row.relation,
          weight: row.weight,
          provenance: row.provenance,
          updatedAt: row.updated_at,
        });
      }

      if (!visited.has(row.from_node_id)) {
        visited.add(row.from_node_id);
        nextFrontier.add(row.from_node_id);
      }
      if (!visited.has(row.to_node_id)) {
        visited.add(row.to_node_id);
        nextFrontier.add(row.to_node_id);
      }
    }

    frontier = nextFrontier;
  }

  return Array.from(collected.values()).slice(0, limit);
}

export type OrchestrationEventInput = {
  id: string;
  jobId: string;
  sessionId: string;
  state: string;
  detail: string;
};

export function createOrchestrationJob(
  id: string,
  sessionId: string,
  parentMessage: string,
  briefJson: string,
): void {
  const stmt = db.prepare(`
    INSERT INTO orchestration_jobs (id, session_id, parent_message, brief_json, state, attempt)
    VALUES (?, ?, ?, ?, 'queued', 1)
  `);
  stmt.run(id, sessionId, parentMessage, briefJson);
}

export function markOrchestrationJobRunning(id: string, attempt: number): void {
  const stmt = db.prepare(`
    UPDATE orchestration_jobs
    SET state = 'running',
        attempt = ?,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(attempt, id);
}

export function completeOrchestrationJob(id: string, output: string): void {
  const stmt = db.prepare(`
    UPDATE orchestration_jobs
    SET state = 'completed',
        output = ?,
        error = NULL,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(output, id);
}

export function failOrchestrationJob(id: string, error: string): void {
  const stmt = db.prepare(`
    UPDATE orchestration_jobs
    SET state = 'failed',
        error = ?,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(error, id);
}

export function cancelOrchestrationJob(id: string, reason: string): void {
  const stmt = db.prepare(`
    UPDATE orchestration_jobs
    SET state = 'cancelled',
        error = ?,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(reason, id);
}

export function queueOrchestrationRetry(id: string, attempt: number, detail: string): void {
  const stmt = db.prepare(`
    UPDATE orchestration_jobs
    SET state = 'queued',
        attempt = ?,
        error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(attempt, detail, id);
}

export function saveOrchestrationEvent(input: OrchestrationEventInput): void {
  const stmt = db.prepare(`
    INSERT INTO orchestration_events (id, job_id, session_id, state, detail)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(input.id, input.jobId, input.sessionId, input.state, input.detail);
}

export function savePolicyAuditLog(
  id: string,
  sessionId: string | null,
  skillName: string,
  action: string,
  reason: string,
  profileId: string
): void {
  const stmt = db.prepare(`
    INSERT INTO policy_audit_logs (id, session_id, skill_name, action, reason, profile_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, sessionId, skillName, action, reason, profileId);
}

// ── Callback Idempotency ───────────────────────────────────────────────────

export interface CallbackReceipt {
  idempotency_key: string;
  status_code: number;
  outcome: 'accepted' | 'duplicate' | 'rejected';
  created_at: string;
}

export function recordCallbackReceipt(
  idempotencyKey: string,
  statusCode: number,
  outcome: 'accepted' | 'duplicate' | 'rejected'
): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO callback_receipts (idempotency_key, status_code, outcome)
    VALUES (?, ?, ?)
  `);
  stmt.run(idempotencyKey, statusCode, outcome);
}

export function getCallbackReceipt(idempotencyKey: string): CallbackReceipt | undefined {
  const stmt = db.prepare(`
    SELECT idempotency_key, status_code, outcome, created_at
    FROM callback_receipts
    WHERE idempotency_key = ?
  `);
  return stmt.get(idempotencyKey) as CallbackReceipt | undefined;
}

// ── Delivery Queue ────────────────────────────────────────────────────────

export function enqueueDelivery(id: string, platform: string, chatId: string, textPayload: string): void {
  const stmt = db.prepare(`
    INSERT INTO delivery_queue (id, platform, chat_id, text_payload, state, attempts, next_attempt_at)
    VALUES (?, ?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP)
  `);
  stmt.run(id, platform, chatId, textPayload);
}

export function getDelivery(id: string): any {
  return db.prepare('SELECT * FROM delivery_queue WHERE id = ?').get(id);
}

export function updateDeliveryState(id: string, state: string, resolvedAt: string | null = null): void {
  const stmt = db.prepare(`
    UPDATE delivery_queue
    SET state = ?, resolved_at = ?
    WHERE id = ?
  `);
  stmt.run(state, resolvedAt, id);
}

export function updateDeliveryAttempts(id: string, attempts: number, nextAttemptAt: string | null = null): void {
  const stmt = db.prepare(`
    UPDATE delivery_queue
    SET attempts = ?, next_attempt_at = ?
    WHERE id = ?
  `);
  stmt.run(attempts, nextAttemptAt, id);
}

export function dequeueDeliveries(limit: number): any[] {
  // Use a transaction to safely pick deliveries and mark them as 'dispatching'
  const tx = db.transaction((limit: number) => {
    const fetchStmt = db.prepare(`
      SELECT * FROM delivery_queue
      WHERE (state = 'queued' OR state = 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ?
    `);
    const rows = fetchStmt.all(limit) as any[];

    if (rows.length > 0) {
      const ids = rows.map((r: any) => r.id);
      const updateStmt = db.prepare(`
        UPDATE delivery_queue
        SET state = 'dispatching',
            attempts = attempts + 1
        WHERE id IN (${ids.map(() => '?').join(',')})
      `);
      updateStmt.run(...ids);

      // Return the incremented attempt counts so callers dont have to guess
      for (const row of rows) {
        row.state = 'dispatching';
        row.attempts += 1;
      }
    }
    return rows;
  });
  return tx(limit);
}

export function recordDeliveryAttemptStart(attemptId: string, deliveryId: string, attemptNumber: number, startedAt: string): void {
  const stmt = db.prepare(`
    INSERT INTO delivery_attempts (id, delivery_id, attempt_number, started_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(attemptId, deliveryId, attemptNumber, startedAt);
}

export function recordDeliveryAttemptEnd(attemptId: string, completedAt: string, error: string | null, durationMs: number): void {
  const stmt = db.prepare(`
    UPDATE delivery_attempts
    SET completed_at = ?,
        error = ?,
        duration_ms = ?
    WHERE id = ?
  `);
  stmt.run(completedAt, error, durationMs, attemptId);
}

export function getDeliveryAttempts(deliveryId: string): any[] {
  return db.prepare('SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_number ASC').all(deliveryId) as any[];
}

export function getDeliveryMetrics(limit: number): any[] {
  return db.prepare('SELECT * FROM delivery_queue ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

export function getDeliveryStateCounts(): Record<string, number> {
  const rows = db
    .prepare('SELECT state, COUNT(*) as count FROM delivery_queue GROUP BY state')
    .all() as Array<{ state: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.state] = row.count;
  }

  return counts;
}

export function getDeadLetters(): any[] {
  return db
    .prepare(
      "SELECT * FROM delivery_queue WHERE state = 'dead_letter' ORDER BY COALESCE(resolved_at, created_at) DESC",
    )
    .all() as any[];
}

// ── MCP Audit & Health ─────────────────────────────────────────────────────

export function saveMcpHealthEvent(input: {
  id: string;
  serverId: string;
  prevState: string;
  newState: string;
  reason: string;
  metrics: any;
}): void {
  const stmt = db.prepare(`
    INSERT INTO mcp_health_events (id, server_id, prev_state, new_state, reason, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(input.id, input.serverId, input.prevState, input.newState, input.reason, JSON.stringify(input.metrics));
}

export function saveMcpScopeAuditLog(input: {
  id: string;
  sessionId: string | null;
  serverId: string;
  toolName: string;
  scope: string;
  outcome: string;
  reason?: string;
}): void {
  const stmt = db.prepare(`
    INSERT INTO mcp_scope_audit_logs (id, session_id, server_id, tool_name, scope, outcome, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(input.id, input.sessionId, input.serverId, input.toolName, input.scope, input.outcome, input.reason ?? null);
}

// ── Model Routing Telemetry ────────────────────────────────────────────────

export interface ModelRoutingEventRow {
  id: string;
  event_type: ModelRoutingEventType;
  model_id: string | null;
  model_name: string | null;
  provider: string | null;
  fallback_mode: ModelRoutingFallbackMode;
  detail_json: string;
  created_at: string;
}

export interface ModelRoutingEventInput {
  id: string;
  eventType: ModelRoutingEventType;
  modelId: string | null;
  modelName: string | null;
  provider: string | null;
  fallbackMode: ModelRoutingFallbackMode;
  detailJson: string;
  createdAt?: string;
}

export function saveModelRoutingEvent(input: ModelRoutingEventInput, maxRows = 500): void {
  const stmt = db.prepare(`
    INSERT INTO model_routing_events (
      id,
      event_type,
      model_id,
      model_name,
      provider,
      fallback_mode,
      detail_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    input.id,
    input.eventType,
    input.modelId,
    input.modelName,
    input.provider,
    input.fallbackMode,
    input.detailJson,
    input.createdAt ?? new Date().toISOString(),
  );

  const boundedLimit = Math.max(50, Math.floor(maxRows));
  db.prepare(`
    DELETE FROM model_routing_events
    WHERE id IN (
      SELECT id
      FROM model_routing_events
      ORDER BY datetime(created_at) DESC
      LIMIT -1 OFFSET ?
    )
  `).run(boundedLimit);
}

export function listModelRoutingEvents(limit = 80): ModelRoutingEventRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db.prepare(`
    SELECT id, event_type, model_id, model_name, provider, fallback_mode, detail_json, created_at
    FROM model_routing_events
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(boundedLimit) as ModelRoutingEventRow[];
}

export function saveModelRoutingSetting(settingKey: string, settingValue: string): void {
  db.prepare(`
    INSERT INTO model_routing_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(settingKey, settingValue);
}

export function getModelRoutingSetting(settingKey: string): string | null {
  const row = db.prepare(`
    SELECT setting_value
    FROM model_routing_settings
    WHERE setting_key = ?
  `).get(settingKey) as { setting_value: string } | undefined;
  return row?.setting_value ?? null;
}

// ── Local State Backup & Restore ─────────────────────────────────────────────

export interface LocalStateSnapshotRecordRow {
  snapshot_id: string;
  trigger_type: LocalStateBackupTrigger;
  status: 'ready' | 'failed' | 'pruned';
  scopes_json: string;
  entry_count: number;
  manifest_path: string;
  checksum: string | null;
  detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalStateSnapshotRecordInput {
  snapshotId: string;
  triggerType: LocalStateBackupTrigger;
  status: 'ready' | 'failed' | 'pruned';
  scopes: LocalStateBackupScope[];
  entryCount: number;
  manifestPath: string;
  checksum: string | null;
  detail?: string | null;
  createdAt?: string;
}

export interface LocalStateRestoreEventRow {
  id: string;
  snapshot_id: string | null;
  outcome: LocalStateRestoreStatus;
  dry_run: number;
  scopes_json: string;
  restored_paths_json: string;
  skipped_paths_json: string;
  validation_errors_json: string;
  rollback_applied: number;
  detail: string | null;
  created_at: string;
}

export interface LocalStateRestoreEventInput {
  id: string;
  snapshotId: string | null;
  outcome: LocalStateRestoreStatus;
  dryRun: boolean;
  scopes: LocalStateBackupScope[];
  restoredPaths: string[];
  skippedPaths: string[];
  validationErrors: string[];
  rollbackApplied: boolean;
  detail?: string | null;
  createdAt?: string;
}

export function upsertLocalStateSnapshotRecord(input: LocalStateSnapshotRecordInput): void {
  const createdAt = input.createdAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO local_state_snapshots (
      snapshot_id,
      trigger_type,
      status,
      scopes_json,
      entry_count,
      manifest_path,
      checksum,
      detail,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_id) DO UPDATE SET
      trigger_type = excluded.trigger_type,
      status = excluded.status,
      scopes_json = excluded.scopes_json,
      entry_count = excluded.entry_count,
      manifest_path = excluded.manifest_path,
      checksum = excluded.checksum,
      detail = excluded.detail,
      updated_at = excluded.updated_at
  `).run(
    input.snapshotId,
    input.triggerType,
    input.status,
    JSON.stringify(input.scopes),
    input.entryCount,
    input.manifestPath,
    input.checksum,
    input.detail ?? null,
    createdAt,
    createdAt,
  );
}

export function listLocalStateSnapshotRecords(limit = 40): LocalStateSnapshotRecordRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db.prepare(`
    SELECT
      snapshot_id,
      trigger_type,
      status,
      scopes_json,
      entry_count,
      manifest_path,
      checksum,
      detail,
      created_at,
      updated_at
    FROM local_state_snapshots
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(boundedLimit) as LocalStateSnapshotRecordRow[];
}

export function removeLocalStateSnapshotRecords(snapshotIds: string[]): void {
  if (snapshotIds.length === 0) {
    return;
  }
  const placeholders = snapshotIds.map(() => '?').join(', ');
  db.prepare(`
    DELETE FROM local_state_snapshots
    WHERE snapshot_id IN (${placeholders})
  `).run(...snapshotIds);
}

export function saveLocalStateRestoreEvent(input: LocalStateRestoreEventInput): void {
  db.prepare(`
    INSERT INTO local_state_restore_events (
      id,
      snapshot_id,
      outcome,
      dry_run,
      scopes_json,
      restored_paths_json,
      skipped_paths_json,
      validation_errors_json,
      rollback_applied,
      detail,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.snapshotId,
    input.outcome,
    input.dryRun ? 1 : 0,
    JSON.stringify(input.scopes),
    JSON.stringify(input.restoredPaths),
    JSON.stringify(input.skippedPaths),
    JSON.stringify(input.validationErrors),
    input.rollbackApplied ? 1 : 0,
    input.detail ?? null,
    input.createdAt ?? new Date().toISOString(),
  );
}

export function listLocalStateRestoreEvents(limit = 50): LocalStateRestoreEventRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db.prepare(`
    SELECT
      id,
      snapshot_id,
      outcome,
      dry_run,
      scopes_json,
      restored_paths_json,
      skipped_paths_json,
      validation_errors_json,
      rollback_applied,
      detail,
      created_at
    FROM local_state_restore_events
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(boundedLimit) as LocalStateRestoreEventRow[];
}

// ── Incident Detection & Auto-Remediation ───────────────────────────────────

export interface IncidentRecordRow {
  id: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  evidence_json: string;
  remediation_action: IncidentRemediationAction;
  remediation_attempts: number;
  cooldown_until: string | null;
  escalated: number;
  recommended_actions_json: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface IncidentRecordInput {
  id: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  evidenceJson: string;
  remediationAction: IncidentRemediationAction;
  remediationAttempts: number;
  cooldownUntil: string | null;
  escalated: boolean;
  recommendedActionsJson: string;
  resolvedAt?: string | null;
}

export interface IncidentTimelineRow {
  id: string;
  incident_id: string;
  incident_type: IncidentType;
  event_type: string;
  detail_json: string;
  created_at: string;
}

export function upsertIncidentRecord(input: IncidentRecordInput): void {
  const stmt = db.prepare(`
    INSERT INTO incidents (
      id,
      incident_type,
      severity,
      status,
      summary,
      evidence_json,
      remediation_action,
      remediation_attempts,
      cooldown_until,
      escalated,
      recommended_actions_json,
      resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      severity = excluded.severity,
      status = excluded.status,
      summary = excluded.summary,
      evidence_json = excluded.evidence_json,
      remediation_action = excluded.remediation_action,
      remediation_attempts = excluded.remediation_attempts,
      cooldown_until = excluded.cooldown_until,
      escalated = excluded.escalated,
      recommended_actions_json = excluded.recommended_actions_json,
      resolved_at = excluded.resolved_at,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    input.id,
    input.incidentType,
    input.severity,
    input.status,
    input.summary,
    input.evidenceJson,
    input.remediationAction,
    input.remediationAttempts,
    input.cooldownUntil,
    input.escalated ? 1 : 0,
    input.recommendedActionsJson,
    input.resolvedAt ?? null,
  );
}

export function appendIncidentTimelineEntry(input: {
  id: string;
  incidentId: string;
  incidentType: IncidentType;
  eventType: string;
  detailJson: string;
}): void {
  const stmt = db.prepare(`
    INSERT INTO incident_timeline (id, incident_id, incident_type, event_type, detail_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(input.id, input.incidentId, input.incidentType, input.eventType, input.detailJson);
}

export function listIncidentRecords(limit = 100, statuses: IncidentStatus[] = []): IncidentRecordRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  if (!statuses.length) {
    return db
      .prepare(`
        SELECT *
        FROM incidents
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
      `)
      .all(boundedLimit) as IncidentRecordRow[];
  }

  const placeholders = statuses.map(() => '?').join(', ');
  return db
    .prepare(`
      SELECT *
      FROM incidents
      WHERE status IN (${placeholders})
      ORDER BY datetime(updated_at) DESC
      LIMIT ?
    `)
    .all(...statuses, boundedLimit) as IncidentRecordRow[];
}

export function listIncidentTimeline(limit = 200): IncidentTimelineRow[] {
  const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
  return db
    .prepare(`
      SELECT *
      FROM incident_timeline
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `)
    .all(boundedLimit) as IncidentTimelineRow[];
}

export function getCallbackOutcomeCounts(sinceMinutes?: number): CallbackOutcomeCounts {
  const useWindow = Number.isFinite(sinceMinutes) && (sinceMinutes ?? 0) > 0;
  const rows = useWindow
    ? (db
      .prepare(`
        SELECT outcome, COUNT(*) as count
        FROM callback_receipts
        WHERE created_at >= datetime('now', ?)
        GROUP BY outcome
      `)
      .all(`-${Math.floor(sinceMinutes ?? 0)} minutes`) as Array<{ outcome: string; count: number }>)
    : (db
      .prepare(`
        SELECT outcome, COUNT(*) as count
        FROM callback_receipts
        GROUP BY outcome
      `)
      .all() as Array<{ outcome: string; count: number }>);

  return {
    accepted: rows.find((row) => row.outcome === 'accepted')?.count ?? 0,
    duplicate: rows.find((row) => row.outcome === 'duplicate')?.count ?? 0,
    rejected: rows.find((row) => row.outcome === 'rejected')?.count ?? 0,
  };
}

// ── Runtime Budget Governance ────────────────────────────────────────────────

export interface RuntimeUsageAggregateRow {
  request_count: number;
  request_tokens: number;
  response_tokens: number;
  failure_count: number;
  skipped_count: number;
}

export interface RuntimeProviderUsageAggregateRow extends RuntimeUsageAggregateRow {
  provider_id: string;
}

export interface RuntimeBudgetEventRow {
  id: string;
  session_id: string | null;
  severity: RuntimeBudgetSeverity;
  profile: RuntimeBudgetProfile;
  action: RuntimeBudgetAction;
  reason: string;
  detail_json: string;
  created_at: string;
}

export interface RuntimeUsageEventInput {
  id: string;
  sessionId: string | null;
  modelId: string;
  providerId: string;
  profile: RuntimeBudgetProfile;
  stage: RuntimeUsageStage;
  requestTokens: number;
  responseTokens: number;
  latencyMs: number;
  statusCode?: number | null;
  error?: string | null;
}

export interface RuntimeBudgetEventInput {
  id: string;
  sessionId: string | null;
  severity: RuntimeBudgetSeverity;
  profile: RuntimeBudgetProfile;
  action: RuntimeBudgetAction;
  reason: string;
  detailJson: string;
}

export function recordRuntimeUsageEvent(input: RuntimeUsageEventInput): void {
  const stmt = db.prepare(`
    INSERT INTO runtime_usage_events (
      id,
      session_id,
      model_id,
      provider_id,
      profile,
      stage,
      request_tokens,
      response_tokens,
      latency_ms,
      status_code,
      error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    input.id,
    input.sessionId,
    input.modelId,
    input.providerId,
    input.profile,
    input.stage,
    input.requestTokens,
    input.responseTokens,
    input.latencyMs,
    input.statusCode ?? null,
    input.error ?? null,
  );
}

export function getRuntimeDailyUsageAggregate(): RuntimeUsageAggregateRow {
  return (db
    .prepare(`
      SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(request_tokens), 0) AS request_tokens,
        COALESCE(SUM(response_tokens), 0) AS response_tokens,
        COALESCE(SUM(CASE WHEN stage = 'failure' THEN 1 ELSE 0 END), 0) AS failure_count,
        COALESCE(SUM(CASE WHEN stage = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_count
      FROM runtime_usage_events
      WHERE date(created_at) = date('now')
    `)
    .get() as RuntimeUsageAggregateRow) ?? {
    request_count: 0,
    request_tokens: 0,
    response_tokens: 0,
    failure_count: 0,
    skipped_count: 0,
  };
}

export function getRuntimeSessionUsageAggregate(sessionId: string): RuntimeUsageAggregateRow {
  return (db
    .prepare(`
      SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(request_tokens), 0) AS request_tokens,
        COALESCE(SUM(response_tokens), 0) AS response_tokens,
        COALESCE(SUM(CASE WHEN stage = 'failure' THEN 1 ELSE 0 END), 0) AS failure_count,
        COALESCE(SUM(CASE WHEN stage = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_count
      FROM runtime_usage_events
      WHERE session_id = ?
    `)
    .get(sessionId) as RuntimeUsageAggregateRow) ?? {
    request_count: 0,
    request_tokens: 0,
    response_tokens: 0,
    failure_count: 0,
    skipped_count: 0,
  };
}

export function listRuntimeProviderUsageAggregates(): RuntimeProviderUsageAggregateRow[] {
  return db
    .prepare(`
      SELECT
        provider_id,
        COUNT(*) AS request_count,
        COALESCE(SUM(request_tokens), 0) AS request_tokens,
        COALESCE(SUM(response_tokens), 0) AS response_tokens,
        COALESCE(SUM(CASE WHEN stage = 'failure' THEN 1 ELSE 0 END), 0) AS failure_count,
        COALESCE(SUM(CASE WHEN stage = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_count
      FROM runtime_usage_events
      WHERE date(created_at) = date('now')
      GROUP BY provider_id
      ORDER BY request_count DESC, provider_id ASC
    `)
    .all() as RuntimeProviderUsageAggregateRow[];
}

export function recordRuntimeBudgetEvent(input: RuntimeBudgetEventInput): void {
  const stmt = db.prepare(`
    INSERT INTO runtime_budget_events (
      id,
      session_id,
      severity,
      profile,
      action,
      reason,
      detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    input.id,
    input.sessionId,
    input.severity,
    input.profile,
    input.action,
    input.reason,
    input.detailJson,
  );
}

export function listRuntimeBudgetEvents(limit = 100): RuntimeBudgetEventRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db
    .prepare(`
      SELECT *
      FROM runtime_budget_events
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `)
    .all(boundedLimit) as RuntimeBudgetEventRow[];
}

export function setRuntimeBudgetState(key: string, value: string): void {
  const stmt = db.prepare(`
    INSERT INTO runtime_budget_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(key, value);
}

export function getRuntimeBudgetState(key: string): string | null {
  const row = db
    .prepare(`
      SELECT value
      FROM runtime_budget_state
      WHERE key = ?
      LIMIT 1
    `)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function clearRuntimeBudgetState(key: string): void {
  db.prepare('DELETE FROM runtime_budget_state WHERE key = ?').run(key);
}
