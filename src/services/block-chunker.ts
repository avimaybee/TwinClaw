export interface BlockChunkerOptions {
    minChars: number;
    maxChars: number;
    breakOn: 'paragraph' | 'sentence';
    coalesce: boolean;
}

interface ChunkResult {
    chunks: string[];
    wasSplit: boolean;
}

const DEFAULT_OPTIONS: BlockChunkerOptions = {
    minChars: 50,
    maxChars: 800,
    breakOn: 'paragraph',
    coalesce: true,
};

const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
const CODE_FENCE_START = '```';
const CODE_FENCE_END = '```';

export class EmbeddedBlockChunker {
    readonly #minChars: number;
    readonly #maxChars: number;
    readonly #breakOn: 'paragraph' | 'sentence';
    readonly #coalesce: boolean;

    constructor(options: Partial<BlockChunkerOptions> = {}) {
        this.#minChars = Math.max(1, Math.floor(options.minChars ?? DEFAULT_OPTIONS.minChars));
        this.#maxChars = Math.max(this.#minChars + 1, Math.floor(options.maxChars ?? DEFAULT_OPTIONS.maxChars));
        this.#breakOn = options.breakOn ?? DEFAULT_OPTIONS.breakOn;
        this.#coalesce = options.coalesce ?? DEFAULT_OPTIONS.coalesce;
    }

    get minChars(): number {
        return this.#minChars;
    }

    get maxChars(): number {
        return this.#maxChars;
    }

    chunk(text: string): string[] {
        if (!text || text.trim().length === 0) {
            return [];
        }

        const result = this.#chunkText(text);

        if (this.#coalesce) {
            return this.#coalesceChunks(result.chunks);
        }

        return result.chunks;
    }

    #chunkText(text: string): ChunkResult {
        const codeBlockRanges = this.#findCodeBlockRanges(text);

        if (this.#breakOn === 'paragraph') {
            return this.#chunkByParagraph(text, codeBlockRanges);
        }

        return this.#chunkBySentence(text, codeBlockRanges);
    }

    #findCodeBlockRanges(text: string): Array<{ start: number; end: number }> {
        const ranges: Array<{ start: number; end: number }> = [];
        let match: RegExpExecArray | null;

        CODE_FENCE_PATTERN.lastIndex = 0;
        while ((match = CODE_FENCE_PATTERN.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }

        return ranges;
    }

    #isInsideCodeBlock(index: number, ranges: Array<{ start: number; end: number }>): boolean {
        for (const range of ranges) {
            if (index >= range.start && index < range.end) {
                return true;
            }
        }
        return false;
    }

    #chunkByParagraph(text: string, codeBlockRanges: Array<{ start: number; end: number }>): ChunkResult {
        const paragraphs = text.split(/\n\n+/);
        const chunks: string[] = [];
        let currentChunk = '';
        let wasSplit = false;

        for (const paragraph of paragraphs) {
            const trimmed = paragraph.trim();
            if (!trimmed) continue;

            const wouldExceed = currentChunk.length + trimmed.length + 2 > this.#maxChars;

            if (wouldExceed && currentChunk.length >= this.#minChars) {
                chunks.push(currentChunk.trim());
                currentChunk = trimmed;
                wasSplit = true;
            } else if (wouldExceed && currentChunk.length > 0) {
                const sentenceChunks = this.#chunkBySentence(trimmed, codeBlockRanges);
                if (sentenceChunks.wasSplit) {
                    wasSplit = true;
                }
                for (const sentence of sentenceChunks.chunks) {
                    if (currentChunk.length + sentence.length + 1 <= this.#maxChars) {
                        currentChunk += (currentChunk ? ' ' : '') + sentence;
                    } else {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = sentence;
                        wasSplit = true;
                    }
                }
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return { chunks, wasSplit };
    }

    #chunkBySentence(text: string, codeBlockRanges: Array<{ start: number; end: number }>): ChunkResult {
        const sentenceEndPattern = /([.!?])\s+/g;
        const chunks: string[] = [];
        let currentChunk = '';
        let wasSplit = false;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        const globalIndex = text;

        sentenceEndPattern.lastIndex = 0;
        while ((match = sentenceEndPattern.exec(globalIndex)) !== null) {
            const sentenceEnd = match.index + 1;
            const sentence = globalIndex.slice(lastIndex, sentenceEnd).trim();

            if (!sentence) {
                lastIndex = match.index + match[0].length;
                continue;
            }

            const wouldExceed = currentChunk.length + sentence.length + 1 > this.#maxChars;

            if (wouldExceed && currentChunk.length >= this.#minChars) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
                wasSplit = true;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }

            lastIndex = match.index + match[0].length;
        }

        const remaining = globalIndex.slice(lastIndex).trim();
        if (remaining) {
            if (currentChunk.length + remaining.length + 1 <= this.#maxChars) {
                currentChunk += (currentChunk ? ' ' : '') + remaining;
            } else {
                if (currentChunk) chunks.push(currentChunk.trim());
                currentChunk = remaining;
                wasSplit = true;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return { chunks, wasSplit };
    }

    #coalesceChunks(chunks: string[]): string[] {
        if (chunks.length <= 1) return chunks;

        const result: string[] = [];

        for (const chunk of chunks) {
            const lastChunk = result[result.length - 1];

            if (lastChunk && lastChunk.length < this.#minChars && lastChunk.length + chunk.length + 1 <= this.#maxChars) {
                result[result.length - 1] = lastChunk + ' ' + chunk;
            } else if (chunk.length < this.#minChars && result.length === 0) {
                result.push(chunk);
            } else if (chunk.length < this.#minChars && result.length > 0) {
                result[result.length - 1] = result[result.length - 1] + ' ' + chunk;
            } else {
                result.push(chunk);
            }
        }

        return result;
    }

    static ensureCodeFenceClosed(text: string): string {
        const openCount = (text.match(/```/g) || []).length;
        if (openCount % 2 === 1) {
            return text + '\n```';
        }
        return text;
    }
}
