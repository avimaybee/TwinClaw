import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db, createSession } from '../../src/services/db.js';

vi.mock('../../src/services/embedding-service.js', () => {
  class MockEmbeddingService {
    async embedText(input: string): Promise<number[]> {
      const vector = new Array<number>(1536).fill(0);
      for (let i = 0; i < Math.min(input.length, 256); i += 1) {
        const code = input.charCodeAt(i) || 0;
        vector[i] = (code % 97) / 97;
      }
      return vector;
    }
  }

  return {
    EmbeddingService: MockEmbeddingService,
    chunkText: (content: string, chunkSize = 900, overlap = 120): string[] => {
      const source = content.replace(/\s+/g, ' ').trim();
      if (!source) {
        return [];
      }

      const chunks: string[] = [];
      let index = 0;
      while (index < source.length) {
        const end = Math.min(index + chunkSize, source.length);
        chunks.push(source.slice(index, end));
        if (end >= source.length) {
          break;
        }
        index = Math.max(end - overlap, index + 1);
      }
      return chunks;
    },
  };
});

async function loadSemanticMemory() {
  return import('../../src/services/semantic-memory.js');
}

describe('Reasoning graph memory retrieval', () => {
  it('upserts stable reasoning nodes and links multiple memory rows to one claim', async () => {
    const { indexConversationTurn } = await loadSemanticMemory();
    const token = `graph-${randomUUID()}`;
    const sessionA = `test:reasoning:${randomUUID()}`;
    const sessionB = `test:reasoning:${randomUUID()}`;
    const sharedClaim = `Deployment ${token} remains stable under load.`;

    createSession(sessionA);
    createSession(sessionB);

    await indexConversationTurn(sessionA, 'user', sharedClaim);
    await indexConversationTurn(sessionB, 'assistant', sharedClaim);

    const nodes = db
      .prepare('SELECT node_id FROM reasoning_nodes WHERE canonical_text LIKE ?')
      .all(`%${token}%`) as Array<{ node_id: string }>;
    expect(nodes).toHaveLength(1);

    const provenanceStats = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM memory_provenance mp
         INNER JOIN reasoning_nodes rn ON rn.node_id = mp.node_id
         WHERE rn.canonical_text LIKE ?`,
      )
      .get(`%${token}%`) as { total: number };
    expect(provenanceStats.total).toBe(2);
  });

  it('detects contradictory claims and surfaces conflict diagnostics', async () => {
    const { indexConversationTurn, retrieveEvidenceAwareMemoryContext } = await loadSemanticMemory();
    const token = `conflict-${randomUUID()}`;
    const sessionId = `test:reasoning:${randomUUID()}`;
    createSession(sessionId);

    await indexConversationTurn(sessionId, 'user', `Service ${token} is available for writes.`);
    await indexConversationTurn(sessionId, 'assistant', `Service ${token} is not available for writes.`);

    const retrieval = await retrieveEvidenceAwareMemoryContext(
      sessionId,
      `Is service ${token} available for writes?`,
      4,
    );

    expect(retrieval.conflictCount).toBeGreaterThan(0);
    expect(retrieval.context).toContain('Potential contradiction signals');
    expect(retrieval.diagnostics.some((item) => item.includes('Detected contradiction signals'))).toBe(
      true,
    );
  });

  it('includes provenance references and bounded graph traversal diagnostics', async () => {
    const { indexConversationTurn, retrieveEvidenceAwareMemoryContext } = await loadSemanticMemory();
    const token = `traversal-${randomUUID()}`;
    const sessionId = `test:reasoning:${randomUUID()}`;
    createSession(sessionId);

    const longThread = `Timeline ${token}: ${'step '.repeat(420)}`;
    await indexConversationTurn(sessionId, 'user', longThread);

    const retrieval = await retrieveEvidenceAwareMemoryContext(sessionId, `Summarize ${token}`, 3);

    expect(retrieval.hitCount).toBeGreaterThan(0);
    expect(retrieval.context).toContain('provenance=[memory:');
    expect(retrieval.diagnostics.some((item) => item.includes('Graph traversal depth=2'))).toBe(true);
  });
});
