/**
 * Voice Mirror Memory System - Memory Manager
 * Main orchestrator that ties together all memory components
 *
 * Features:
 * - Lazy initialization (only loads on first search)
 * - Embedding provider with auto-fallback
 * - Hash-based incremental indexing
 * - Hybrid search (70% vector + 30% BM25)
 */

const path = require('path');
const MarkdownStore = require('./MarkdownStore');
const SQLiteIndex = require('./SQLiteIndex');
const Chunker = require('./Chunker');
const { createEmbeddingProvider } = require('./embeddings');
const { hybridSearch, searchWithFallback } = require('./search/hybrid');
const { searchKeyword } = require('./search/keyword');
const { getMemoryDir, generateId } = require('./utils');

/**
 * @typedef {Object} MemoryManagerConfig
 * @property {string} [memoryDir] - Override memory directory
 * @property {string} [embeddingProvider='auto'] - 'auto' | 'local' | 'openai' | 'gemini'
 * @property {string} [openaiApiKey] - OpenAI API key
 * @property {string} [geminiApiKey] - Gemini API key
 * @property {Object} [chunking] - Chunking options
 * @property {number} [chunking.tokens=400] - Target tokens per chunk
 * @property {number} [chunking.overlap=80] - Overlap tokens
 * @property {Object} [search] - Search options
 * @property {number} [search.maxResults=5] - Max search results
 * @property {number} [search.minScore=0.3] - Min relevance score
 * @property {number} [search.vectorWeight=0.7] - Vector search weight
 * @property {number} [search.textWeight=0.3] - Text search weight
 */

class MemoryManager {
    /**
     * @param {MemoryManagerConfig} config
     */
    constructor(config = {}) {
        this.config = {
            memoryDir: config.memoryDir || getMemoryDir(),
            embeddingProvider: config.embeddingProvider || 'auto',
            openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
            geminiApiKey: config.geminiApiKey || process.env.GOOGLE_API_KEY,
            chunking: {
                tokens: config.chunking?.tokens || 400,
                overlap: config.chunking?.overlap || 80
            },
            search: {
                maxResults: config.search?.maxResults || 5,
                minScore: config.search?.minScore || 0.3,
                vectorWeight: config.search?.vectorWeight || 0.7,
                textWeight: config.search?.textWeight || 0.3
            }
        };

        this.store = null;
        this.index = null;
        this.embedder = null;
        this._initialized = false;
        this._initializing = null;
    }

    /**
     * Lazy initialization - called on first operation
     */
    async init() {
        if (this._initialized) return;

        // Prevent double initialization
        if (this._initializing) {
            return this._initializing;
        }

        this._initializing = (async () => {
            // Initialize markdown store
            this.store = new MarkdownStore(this.config.memoryDir);
            await this.store.init();

            // Initialize SQLite index
            const dbPath = path.join(this.config.memoryDir, 'index.db');
            this.index = new SQLiteIndex(dbPath);
            await this.index.init();

            // Initialize embedding provider
            try {
                this.embedder = await createEmbeddingProvider({
                    provider: this.config.embeddingProvider,
                    openaiApiKey: this.config.openaiApiKey,
                    geminiApiKey: this.config.geminiApiKey
                });
                console.error(`[Memory] Using embedding provider: ${this.embedder.id}/${this.embedder.model}`);
            } catch (err) {
                console.error(`[Memory] Warning: No embedding provider available: ${err.message}`);
                console.error('[Memory] Falling back to keyword-only search');
                this.embedder = null;
            }

            // Index all files on first load
            await this.syncAllFiles();

            this._initialized = true;
        })();

        return this._initializing;
    }

    /**
     * Sync all markdown files to the index
     */
    async syncAllFiles() {
        await this.init();

        const files = await this.store.listMemoryFiles();
        let indexed = 0;
        let skipped = 0;

        for (const file of files) {
            const fileMeta = await this.store.readFileWithMeta(file.path);

            // Check if file needs reindexing
            if (!this.index.needsReindex(file.path, fileMeta.hash)) {
                skipped++;
                continue;
            }

            // Chunk the file
            const chunks = Chunker.smartChunk(fileMeta.content, file.path, this.config.chunking);

            // Index each chunk
            for (const chunk of chunks) {
                await this.indexChunk(file.path, chunk, file.type === 'memory' ? 'stable' : 'volatile');
            }

            // Update file metadata
            this.index.upsertFile(file.path, fileMeta.hash, fileMeta.mtime, fileMeta.size);
            indexed++;
        }

        console.error(`[Memory] Indexed ${indexed} files, skipped ${skipped} unchanged`);
    }

    /**
     * Index a single chunk
     * @param {string} filePath
     * @param {Object} chunk
     * @param {string} tier
     */
    async indexChunk(filePath, chunk, tier = 'stable') {
        const chunkId = generateId('chunk');
        let embedding = null;
        let model = 'none';

        // Get embedding if provider available
        if (this.embedder) {
            // Check cache first
            const cached = this.index.getCachedEmbedding(
                this.embedder.id,
                this.embedder.model,
                chunk.hash
            );

            if (cached) {
                embedding = cached;
            } else {
                try {
                    embedding = await this.embedder.embedQuery(chunk.text);
                    // Cache the embedding
                    this.index.cacheEmbedding(
                        this.embedder.id,
                        this.embedder.model,
                        chunk.hash,
                        embedding,
                        this.embedder.dimensions
                    );
                } catch (err) {
                    console.error(`[Memory] Embedding failed for chunk: ${err.message}`);
                }
            }
            model = `${this.embedder.id}/${this.embedder.model}`;
        }

        // Store chunk in index
        this.index.upsertChunk({
            id: chunkId,
            path: filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            model: model,
            text: chunk.text,
            embedding: embedding,
            tier: tier
        });
    }

    /**
     * Search memories
     * @param {string} query - Search query
     * @param {Object} options
     * @returns {Promise<Array>} Search results
     */
    async search(query, options = {}) {
        await this.init();

        const searchOpts = {
            maxResults: options.maxResults || this.config.search.maxResults,
            minScore: options.minScore || this.config.search.minScore,
            vectorWeight: this.config.search.vectorWeight,
            textWeight: this.config.search.textWeight
        };

        let queryEmbedding = null;
        let model = 'none';

        // Get query embedding if available
        if (this.embedder) {
            try {
                queryEmbedding = await this.embedder.embedQuery(query);
                model = `${this.embedder.id}/${this.embedder.model}`;
            } catch (err) {
                console.error(`[Memory] Query embedding failed: ${err.message}`);
            }
        }

        // Perform hybrid or fallback search
        const results = searchWithFallback(
            this.index,
            query,
            queryEmbedding,
            model,
            searchOpts
        );

        return results;
    }

    /**
     * Get full content of a chunk or file
     * @param {string} pathOrId - File path or chunk ID
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async get(pathOrId, options = {}) {
        await this.init();

        const { fromLine, lines } = options;

        // Check if it's a chunk ID
        if (pathOrId.startsWith('chunk_')) {
            const db = this.index.getDb();
            const chunk = db.prepare('SELECT * FROM chunks WHERE id = ?').get(pathOrId);

            if (chunk) {
                return {
                    type: 'chunk',
                    id: chunk.id,
                    path: chunk.path,
                    startLine: chunk.start_line,
                    endLine: chunk.end_line,
                    text: chunk.text,
                    tier: chunk.tier
                };
            }
        }

        // It's a file path
        if (fromLine) {
            const content = await this.store.readLines(pathOrId, fromLine, lines);
            return {
                type: 'file_excerpt',
                path: pathOrId,
                fromLine,
                lines: lines || 'all',
                content
            };
        }

        const data = await this.store.readFileWithMeta(pathOrId);
        return {
            type: 'file',
            path: pathOrId,
            content: data.content,
            hash: data.hash,
            size: data.size
        };
    }

    /**
     * Remember something (add to MEMORY.md)
     * @param {string} content - What to remember
     * @param {string} tier - 'core' | 'stable' | 'notes'
     * @returns {Promise<Object>}
     */
    async remember(content, tier = 'stable') {
        await this.init();

        // Append to MEMORY.md
        await this.store.appendMemory(content, tier);

        // Re-index MEMORY.md
        const memoryFile = this.store.memoryFile;
        const fileMeta = await this.store.readFileWithMeta(memoryFile);
        const chunks = Chunker.chunkMarkdown(fileMeta.content, this.config.chunking);

        // Clear old chunks for this file and re-index
        const db = this.index.getDb();
        db.prepare('DELETE FROM chunks WHERE path = ?').run(memoryFile);

        for (const chunk of chunks) {
            await this.indexChunk(memoryFile, chunk, tier);
        }

        this.index.upsertFile(memoryFile, fileMeta.hash, fileMeta.mtime, fileMeta.size);

        return {
            success: true,
            tier,
            content: content.slice(0, 100) + (content.length > 100 ? '...' : '')
        };
    }

    /**
     * Forget a memory (delete from MEMORY.md)
     * @param {string} contentOrId - Memory content or chunk ID
     * @returns {Promise<Object>}
     */
    async forget(contentOrId) {
        await this.init();

        // If it's a chunk ID, get the content first
        let content = contentOrId;
        if (contentOrId.startsWith('chunk_')) {
            const chunk = await this.get(contentOrId);
            if (chunk) {
                // Extract the memory line from the chunk text
                const lines = chunk.text.split('\n');
                const memoryLine = lines.find(l => l.startsWith('- '));
                if (memoryLine) {
                    content = memoryLine.slice(2).replace(/\s*<!--.*-->/, '').trim();
                }
            }
        }

        // Delete from MEMORY.md
        const deleted = await this.store.deleteMemory(content);

        if (deleted) {
            // Re-index MEMORY.md
            const memoryFile = this.store.memoryFile;
            const fileMeta = await this.store.readFileWithMeta(memoryFile);

            const db = this.index.getDb();
            db.prepare('DELETE FROM chunks WHERE path = ?').run(memoryFile);

            const chunks = Chunker.chunkMarkdown(fileMeta.content, this.config.chunking);
            for (const chunk of chunks) {
                await this.indexChunk(memoryFile, chunk, 'stable');
            }

            this.index.upsertFile(memoryFile, fileMeta.hash, fileMeta.mtime, fileMeta.size);
        }

        return {
            success: deleted,
            content: content.slice(0, 100) + (content.length > 100 ? '...' : '')
        };
    }

    /**
     * Get memory system statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        await this.init();

        const storeStats = await this.store.getStats();
        const indexStats = this.index.getStats();

        return {
            storage: storeStats,
            index: indexStats,
            embedding: this.embedder ? {
                provider: this.embedder.id,
                model: this.embedder.model,
                dimensions: this.embedder.dimensions
            } : null,
            config: {
                memoryDir: this.config.memoryDir,
                chunking: this.config.chunking,
                search: this.config.search
            }
        };
    }

    /**
     * Close the memory manager (cleanup)
     */
    close() {
        if (this.index) {
            this.index.close();
        }
        this._initialized = false;
        this._initializing = null;
    }
}

// Singleton instance for MCP tools
let _instance = null;

/**
 * Get or create the singleton MemoryManager instance
 * @param {MemoryManagerConfig} config
 * @returns {MemoryManager}
 */
function getMemoryManager(config = {}) {
    if (!_instance) {
        _instance = new MemoryManager(config);
    }
    return _instance;
}

module.exports = MemoryManager;
module.exports.getMemoryManager = getMemoryManager;
