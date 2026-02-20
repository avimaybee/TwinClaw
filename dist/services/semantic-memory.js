import { chunkText, EmbeddingService } from './embedding-service.js';
import { getNearestMemories, saveMemoryEmbedding } from './db.js';
const embeddingService = new EmbeddingService();
export async function indexConversationTurn(sessionId, role, content) {
    const normalized = content.trim();
    if (!normalized) {
        return;
    }
    const chunks = chunkText(normalized);
    for (const chunk of chunks) {
        const taggedChunk = `${role.toUpperCase()}: ${chunk}`;
        const embedding = await embeddingService.embedText(taggedChunk);
        if (!embedding) {
            continue;
        }
        saveMemoryEmbedding(sessionId, taggedChunk, embedding);
    }
}
export async function retrieveMemoryContext(sessionId, prompt, topK = 5) {
    const embedding = await embeddingService.embedText(prompt);
    if (!embedding) {
        return '';
    }
    const nearest = getNearestMemories(embedding, topK, sessionId);
    if (nearest.length === 0) {
        return '';
    }
    const lines = nearest.map((item, index) => `${index + 1}. (${item.session_id}) ${item.fact_text}`);
    return `Retrieved memories:\n${lines.join('\n')}`;
}
