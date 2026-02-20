import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';
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
function serializeEmbedding(embedding) {
    const sqliteVecWithSerializer = sqliteVec;
    if (typeof sqliteVecWithSerializer.serializeFloat32 === 'function') {
        return sqliteVecWithSerializer.serializeFloat32(embedding);
    }
    return Buffer.from(new Float32Array(embedding).buffer);
}
export function createSession(sessionId) {
    const stmt = db.prepare('INSERT OR IGNORE INTO sessions (session_id) VALUES (?)');
    stmt.run(sessionId);
}
export function saveMessage(id, sessionId, role, content) {
    const stmt = db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)');
    stmt.run(id, sessionId, role, content);
}
export function getSessionMessages(sessionId) {
    const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY rowid ASC');
    return stmt.all(sessionId);
}
export function saveMemoryEmbedding(sessionId, factText, embedding) {
    const stmt = db.prepare('INSERT INTO vec_memory (embedding, session_id, fact_text) VALUES (?, ?, ?)');
    const result = stmt.run(serializeEmbedding(embedding), sessionId, factText);
    return Number(result.lastInsertRowid);
}
export function getNearestMemories(queryEmbedding, topK = 5, currentSessionId) {
    const matcher = serializeEmbedding(queryEmbedding);
    const stmt = db.prepare('SELECT rowid AS memory_rowid, session_id, fact_text, distance FROM vec_memory WHERE embedding MATCH ? AND k = ? ORDER BY distance ASC LIMIT ?');
    const rows = stmt.all(matcher, topK, topK * 3);
    if (!currentSessionId) {
        return rows.slice(0, topK);
    }
    const scoped = rows.filter((row) => row.session_id === currentSessionId);
    const global = rows.filter((row) => row.session_id !== currentSessionId);
    return [...scoped, ...global].slice(0, topK);
}
export function upsertReasoningNode(input) {
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
    stmt.run(input.nodeId, input.claimKey, input.nodeType, input.sourceRole, input.canonicalText, input.polarity, input.confidence, input.sessionId, input.sessionId);
}
export function upsertReasoningEdge(input) {
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
    stmt.run(input.edgeId, input.fromNodeId, input.toNodeId, input.relation, input.weight, input.provenance);
}
export function linkMemoryProvenance(memoryRowId, nodeId, sessionId) {
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
export function getReasoningNodesByClaimKey(claimKey) {
    const stmt = db.prepare(`
    SELECT node_id, polarity
    FROM reasoning_nodes
    WHERE claim_key = ?
    ORDER BY updated_at DESC
    LIMIT 24
  `);
    return stmt.all(claimKey);
}
export function getMemoryProvenanceRows(memoryRowIds) {
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
    return stmt.all(...memoryRowIds).map((row) => ({
        memoryRowId: Number(row.memoryRowId),
        nodeId: String(row.nodeId),
        claimKey: String(row.claimKey),
        nodeType: String(row.nodeType),
        polarity: Number(row.polarity) < 0 ? -1 : 1,
        canonicalText: String(row.canonicalText),
        updatedAt: String(row.updatedAt),
        supportsCount: Number(row.supportsCount ?? 0),
        contradictsCount: Number(row.contradictsCount ?? 0),
        dependsCount: Number(row.dependsCount ?? 0),
        derivedCount: Number(row.derivedCount ?? 0),
    }));
}
export function getReasoningEvidenceExpansion(seedNodeIds, maxDepth, limit) {
    if (seedNodeIds.length === 0 || maxDepth < 1 || limit < 1) {
        return [];
    }
    const visited = new Set(seedNodeIds);
    let frontier = new Set(seedNodeIds);
    const collected = new Map();
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
        const rows = stmt.all(...frontierIds, ...frontierIds, remaining);
        const nextFrontier = new Set();
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
export function createOrchestrationJob(id, sessionId, parentMessage, briefJson) {
    const stmt = db.prepare(`
    INSERT INTO orchestration_jobs (id, session_id, parent_message, brief_json, state, attempt)
    VALUES (?, ?, ?, ?, 'queued', 1)
  `);
    stmt.run(id, sessionId, parentMessage, briefJson);
}
export function markOrchestrationJobRunning(id, attempt) {
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
export function completeOrchestrationJob(id, output) {
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
export function failOrchestrationJob(id, error) {
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
export function cancelOrchestrationJob(id, reason) {
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
export function queueOrchestrationRetry(id, attempt, detail) {
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
export function saveOrchestrationEvent(input) {
    const stmt = db.prepare(`
    INSERT INTO orchestration_events (id, job_id, session_id, state, detail)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(input.id, input.jobId, input.sessionId, input.state, input.detail);
}
export function savePolicyAuditLog(id, sessionId, skillName, action, reason, profileId) {
    const stmt = db.prepare(`
    INSERT INTO policy_audit_logs (id, session_id, skill_name, action, reason, profile_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    stmt.run(id, sessionId, skillName, action, reason, profileId);
}
export function recordCallbackReceipt(idempotencyKey, statusCode, outcome) {
    const stmt = db.prepare(`
    INSERT OR IGNORE INTO callback_receipts (idempotency_key, status_code, outcome)
    VALUES (?, ?, ?)
  `);
    stmt.run(idempotencyKey, statusCode, outcome);
}
export function getCallbackReceipt(idempotencyKey) {
    const stmt = db.prepare(`
    SELECT idempotency_key, status_code, outcome, created_at
    FROM callback_receipts
    WHERE idempotency_key = ?
  `);
    return stmt.get(idempotencyKey);
}
// ── Delivery Queue ────────────────────────────────────────────────────────
export function enqueueDelivery(id, platform, chatId, textPayload) {
    const stmt = db.prepare(`
    INSERT INTO delivery_queue (id, platform, chat_id, text_payload, state, attempts, next_attempt_at)
    VALUES (?, ?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP)
  `);
    stmt.run(id, platform, chatId, textPayload);
}
export function getDelivery(id) {
    return db.prepare('SELECT * FROM delivery_queue WHERE id = ?').get(id);
}
export function updateDeliveryState(id, state, resolvedAt = null) {
    const stmt = db.prepare(`
    UPDATE delivery_queue
    SET state = ?, resolved_at = ?
    WHERE id = ?
  `);
    stmt.run(state, resolvedAt, id);
}
export function updateDeliveryAttempts(id, attempts, nextAttemptAt = null) {
    const stmt = db.prepare(`
    UPDATE delivery_queue
    SET attempts = ?, next_attempt_at = ?
    WHERE id = ?
  `);
    stmt.run(attempts, nextAttemptAt, id);
}
export function dequeueDeliveries(limit) {
    // Use a transaction to safely pick deliveries and mark them as 'dispatching'
    const tx = db.transaction((limit) => {
        const fetchStmt = db.prepare(`
      SELECT * FROM delivery_queue
      WHERE (state = 'queued' OR state = 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ?
    `);
        const rows = fetchStmt.all(limit);
        if (rows.length > 0) {
            const ids = rows.map((r) => r.id);
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
export function recordDeliveryAttemptStart(attemptId, deliveryId, attemptNumber, startedAt) {
    const stmt = db.prepare(`
    INSERT INTO delivery_attempts (id, delivery_id, attempt_number, started_at)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(attemptId, deliveryId, attemptNumber, startedAt);
}
export function recordDeliveryAttemptEnd(attemptId, completedAt, error, durationMs) {
    const stmt = db.prepare(`
    UPDATE delivery_attempts
    SET completed_at = ?,
        error = ?,
        duration_ms = ?
    WHERE id = ?
  `);
    stmt.run(completedAt, error, durationMs, attemptId);
}
export function getDeliveryAttempts(deliveryId) {
    return db.prepare('SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_number ASC').all(deliveryId);
}
export function getDeliveryMetrics(limit) {
    return db.prepare('SELECT * FROM delivery_queue ORDER BY created_at DESC LIMIT ?').all(limit);
}
export function getDeliveryStateCounts() {
    const rows = db
        .prepare('SELECT state, COUNT(*) as count FROM delivery_queue GROUP BY state')
        .all();
    const counts = {};
    for (const row of rows) {
        counts[row.state] = row.count;
    }
    return counts;
}
export function getDeadLetters() {
    return db
        .prepare("SELECT * FROM delivery_queue WHERE state = 'dead_letter' ORDER BY COALESCE(resolved_at, created_at) DESC")
        .all();
}
// ── MCP Audit & Health ─────────────────────────────────────────────────────
export function saveMcpHealthEvent(input) {
    const stmt = db.prepare(`
    INSERT INTO mcp_health_events (id, server_id, prev_state, new_state, reason, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    stmt.run(input.id, input.serverId, input.prevState, input.newState, input.reason, JSON.stringify(input.metrics));
}
export function saveMcpScopeAuditLog(input) {
    const stmt = db.prepare(`
    INSERT INTO mcp_scope_audit_logs (id, session_id, server_id, tool_name, scope, outcome, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    stmt.run(input.id, input.sessionId, input.serverId, input.toolName, input.scope, input.outcome, input.reason ?? null);
}
export function saveModelRoutingEvent(input, maxRows = 500) {
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
    stmt.run(input.id, input.eventType, input.modelId, input.modelName, input.provider, input.fallbackMode, input.detailJson, input.createdAt ?? new Date().toISOString());
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
export function listModelRoutingEvents(limit = 80) {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return db.prepare(`
    SELECT id, event_type, model_id, model_name, provider, fallback_mode, detail_json, created_at
    FROM model_routing_events
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(boundedLimit);
}
export function saveModelRoutingSetting(settingKey, settingValue) {
    db.prepare(`
    INSERT INTO model_routing_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(settingKey, settingValue);
}
export function getModelRoutingSetting(settingKey) {
    const row = db.prepare(`
    SELECT setting_value
    FROM model_routing_settings
    WHERE setting_key = ?
  `).get(settingKey);
    return row?.setting_value ?? null;
}
export function upsertLocalStateSnapshotRecord(input) {
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
  `).run(input.snapshotId, input.triggerType, input.status, JSON.stringify(input.scopes), input.entryCount, input.manifestPath, input.checksum, input.detail ?? null, createdAt, createdAt);
}
export function listLocalStateSnapshotRecords(limit = 40) {
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
  `).all(boundedLimit);
}
export function removeLocalStateSnapshotRecords(snapshotIds) {
    if (snapshotIds.length === 0) {
        return;
    }
    const placeholders = snapshotIds.map(() => '?').join(', ');
    db.prepare(`
    DELETE FROM local_state_snapshots
    WHERE snapshot_id IN (${placeholders})
  `).run(...snapshotIds);
}
export function saveLocalStateRestoreEvent(input) {
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
  `).run(input.id, input.snapshotId, input.outcome, input.dryRun ? 1 : 0, JSON.stringify(input.scopes), JSON.stringify(input.restoredPaths), JSON.stringify(input.skippedPaths), JSON.stringify(input.validationErrors), input.rollbackApplied ? 1 : 0, input.detail ?? null, input.createdAt ?? new Date().toISOString());
}
export function listLocalStateRestoreEvents(limit = 50) {
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
  `).all(boundedLimit);
}
export function upsertIncidentRecord(input) {
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
    stmt.run(input.id, input.incidentType, input.severity, input.status, input.summary, input.evidenceJson, input.remediationAction, input.remediationAttempts, input.cooldownUntil, input.escalated ? 1 : 0, input.recommendedActionsJson, input.resolvedAt ?? null);
}
export function appendIncidentTimelineEntry(input) {
    const stmt = db.prepare(`
    INSERT INTO incident_timeline (id, incident_id, incident_type, event_type, detail_json)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(input.id, input.incidentId, input.incidentType, input.eventType, input.detailJson);
}
export function listIncidentRecords(limit = 100, statuses = []) {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    if (!statuses.length) {
        return db
            .prepare(`
        SELECT *
        FROM incidents
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
      `)
            .all(boundedLimit);
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
        .all(...statuses, boundedLimit);
}
export function listIncidentTimeline(limit = 200) {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    return db
        .prepare(`
      SELECT *
      FROM incident_timeline
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `)
        .all(boundedLimit);
}
export function getCallbackOutcomeCounts(sinceMinutes) {
    const useWindow = Number.isFinite(sinceMinutes) && (sinceMinutes ?? 0) > 0;
    const rows = useWindow
        ? db
            .prepare(`
        SELECT outcome, COUNT(*) as count
        FROM callback_receipts
        WHERE created_at >= datetime('now', ?)
        GROUP BY outcome
      `)
            .all(`-${Math.floor(sinceMinutes ?? 0)} minutes`)
        : db
            .prepare(`
        SELECT outcome, COUNT(*) as count
        FROM callback_receipts
        GROUP BY outcome
      `)
            .all();
    return {
        accepted: rows.find((row) => row.outcome === 'accepted')?.count ?? 0,
        duplicate: rows.find((row) => row.outcome === 'duplicate')?.count ?? 0,
        rejected: rows.find((row) => row.outcome === 'rejected')?.count ?? 0,
    };
}
export function recordRuntimeUsageEvent(input) {
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
    stmt.run(input.id, input.sessionId, input.modelId, input.providerId, input.profile, input.stage, input.requestTokens, input.responseTokens, input.latencyMs, input.statusCode ?? null, input.error ?? null);
}
export function getRuntimeDailyUsageAggregate() {
    return db
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
        .get() ?? {
        request_count: 0,
        request_tokens: 0,
        response_tokens: 0,
        failure_count: 0,
        skipped_count: 0,
    };
}
export function getRuntimeSessionUsageAggregate(sessionId) {
    return db
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
        .get(sessionId) ?? {
        request_count: 0,
        request_tokens: 0,
        response_tokens: 0,
        failure_count: 0,
        skipped_count: 0,
    };
}
export function listRuntimeProviderUsageAggregates() {
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
        .all();
}
export function recordRuntimeBudgetEvent(input) {
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
    stmt.run(input.id, input.sessionId, input.severity, input.profile, input.action, input.reason, input.detailJson);
}
export function listRuntimeBudgetEvents(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return db
        .prepare(`
      SELECT *
      FROM runtime_budget_events
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `)
        .all(boundedLimit);
}
export function setRuntimeBudgetState(key, value) {
    const stmt = db.prepare(`
    INSERT INTO runtime_budget_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);
    stmt.run(key, value);
}
export function getRuntimeBudgetState(key) {
    const row = db
        .prepare(`
      SELECT value
      FROM runtime_budget_state
      WHERE key = ?
      LIMIT 1
    `)
        .get(key);
    return row?.value ?? null;
}
export function clearRuntimeBudgetState(key) {
    db.prepare('DELETE FROM runtime_budget_state WHERE key = ?').run(key);
}
