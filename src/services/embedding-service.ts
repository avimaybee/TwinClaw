import { getSecretVaultService } from './secret-vault.js';
import { getConfigValue } from '../config/config-loader.js';

type EmbeddingProvider = 'openai' | 'ollama';

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'mxbai-embed-large';

function normalizeEmbeddingLength(embedding: number[], expectedDimensions: number): number[] {
    if (embedding.length === expectedDimensions) {
        return embedding;
    }

    if (embedding.length > expectedDimensions) {
        return embedding.slice(0, expectedDimensions);
    }

    return [...embedding, ...new Array(expectedDimensions - embedding.length).fill(0)];
}

export class EmbeddingService {
    private readonly expectedDimensions: number;

    constructor() {
        const configuredDimensions = Number(getConfigValue('MEMORY_EMBEDDING_DIM') ?? '1536');
        this.expectedDimensions = Number.isFinite(configuredDimensions) && configuredDimensions > 0
            ? configuredDimensions
            : 1536;
    }

    public async embedText(input: string): Promise<number[] | null> {
        const normalizedInput = input.trim();
        if (!normalizedInput) {
            return null;
        }

        const providers = this.getProviderOrder();
        for (const provider of providers) {
            try {
                const embedding = provider === 'ollama'
                    ? await this.embedWithOllama(normalizedInput)
                    : await this.embedWithOpenAI(normalizedInput);

                if (embedding.length > 0) {
                    return normalizeEmbeddingLength(embedding, this.expectedDimensions);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[EmbeddingService] Provider '${provider}' failed: ${message}`);
            }
        }

        return null;
    }

    private getProviderOrder(): EmbeddingProvider[] {
        const configured = (getConfigValue('EMBEDDING_PROVIDER') ?? '').toLowerCase().trim();
        if (configured === 'ollama') {
            return ['ollama', 'openai'];
        }

        if (configured === 'openai') {
            return ['openai', 'ollama'];
        }

        return ['openai', 'ollama'];
    }

    private async embedWithOpenAI(input: string): Promise<number[]> {
        const secretVault = getSecretVaultService();
        const apiKey = secretVault.readSecret('EMBEDDING_API_KEY') ?? secretVault.readSecret('OPENAI_API_KEY') ?? '';
        if (!apiKey) {
            throw new Error('Missing EMBEDDING_API_KEY or OPENAI_API_KEY.');
        }

        const endpoint = getConfigValue('EMBEDDING_API_URL') ?? DEFAULT_OPENAI_URL;
        const model = getConfigValue('EMBEDDING_MODEL') ?? DEFAULT_OPENAI_MODEL;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                input,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI embeddings request failed (${response.status}).`);
        }

        const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
        const embedding = data.data?.[0]?.embedding;

        if (!Array.isArray(embedding)) {
            throw new Error('OpenAI embeddings response did not contain an embedding array.');
        }

        return embedding;
    }

    private async embedWithOllama(input: string): Promise<number[]> {
        const baseUrl = getConfigValue('OLLAMA_BASE_URL') ?? DEFAULT_OLLAMA_URL;
        const model = getConfigValue('OLLAMA_EMBEDDING_MODEL') ?? DEFAULT_OLLAMA_MODEL;
        const endpoint = `${baseUrl.replace(/\/$/, '')}/api/embeddings`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                prompt: input,
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama embeddings request failed (${response.status}).`);
        }

        const data = await response.json() as { embedding?: number[] };
        if (!Array.isArray(data.embedding)) {
            throw new Error('Ollama embeddings response did not contain an embedding array.');
        }

        return data.embedding;
    }
}

export function chunkText(content: string, chunkSize = 900, overlap = 120): string[] {
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
}
