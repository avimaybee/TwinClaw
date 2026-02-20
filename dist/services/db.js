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

  -- Virtual table for vector search
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(
  embedding float[${MEMORY_EMBEDDING_DIM}],
    session_id TEXT,
    fact_text TEXT
  );
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
    stmt.run(serializeEmbedding(embedding), sessionId, factText);
}
export function getNearestMemories(queryEmbedding, topK = 5, currentSessionId) {
    const matcher = serializeEmbedding(queryEmbedding);
    const stmt = db.prepare('SELECT session_id, fact_text, distance FROM vec_memory WHERE embedding MATCH ? AND k = ? ORDER BY distance ASC LIMIT ?');
    const rows = stmt.all(matcher, topK, topK * 3);
    if (!currentSessionId) {
        return rows.slice(0, topK);
    }
    const scoped = rows.filter((row) => row.session_id === currentSessionId);
    const global = rows.filter((row) => row.session_id !== currentSessionId);
    return [...scoped, ...global].slice(0, topK);
}
