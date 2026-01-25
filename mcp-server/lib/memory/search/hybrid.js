/**
 * Voice Mirror Memory System - Hybrid Search
 * Combines vector (70%) and keyword (30%) search for better results
 */

const { searchVector } = require('./vector');
const { searchKeyword } = require('./keyword');

/**
 * @typedef {Object} HybridSearchResult
 * @property {string} id - Chunk ID
 * @property {string} path - Source file path
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} text - Chunk text
 * @property {number} score - Combined score (0-1)
 * @property {number} vectorScore - Vector similarity score
 * @property {number} textScore - BM25 keyword score
 */

/**
 * @typedef {Object} HybridSearchOptions
 * @property {number} [maxResults=5] - Maximum results to return
 * @property {number} [minScore=0.3] - Minimum score threshold
 * @property {number} [vectorWeight=0.7] - Weight for vector search (0-1)
 * @property {number} [textWeight=0.3] - Weight for keyword search (0-1)
 * @property {number} [candidateMultiplier=4] - Multiplier for candidate pool
 */

/**
 * Perform hybrid search combining vector and keyword results
 * @param {import('../SQLiteIndex')} index - SQLite index instance
 * @param {string} query - Search query text
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {string} model - Embedding model name
 * @param {HybridSearchOptions} options
 * @returns {HybridSearchResult[]}
 */
function hybridSearch(index, query, queryEmbedding, model, options = {}) {
    const {
        maxResults = 5,
        minScore = 0.3,
        vectorWeight = 0.7,
        textWeight = 0.3,
        candidateMultiplier = 4
    } = options;

    // Get expanded candidate pool
    const candidateLimit = maxResults * candidateMultiplier;

    // Run both searches
    const vectorResults = searchVector(index, queryEmbedding, model, candidateLimit);
    const keywordResults = searchKeyword(index, query, candidateLimit);

    // Merge results by chunk ID
    const byId = new Map();

    // Add vector results
    for (const r of vectorResults) {
        byId.set(r.id, {
            id: r.id,
            path: r.path,
            startLine: r.startLine,
            endLine: r.endLine,
            text: r.text,
            vectorScore: r.score,
            textScore: 0
        });
    }

    // Merge keyword results
    for (const r of keywordResults) {
        if (byId.has(r.id)) {
            // Chunk found in both searches - add text score
            byId.get(r.id).textScore = r.score;
        } else {
            // Chunk only in keyword search
            byId.set(r.id, {
                id: r.id,
                path: r.path,
                startLine: r.startLine,
                endLine: r.endLine,
                text: r.text,
                vectorScore: 0,
                textScore: r.score
            });
        }
    }

    // Calculate combined scores with weighting
    const merged = [...byId.values()].map(entry => ({
        ...entry,
        score: vectorWeight * entry.vectorScore + textWeight * entry.textScore
    }));

    // Filter by minimum score, sort by combined score, limit results
    return merged
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

/**
 * Search with automatic fallback
 * If vector search returns no results, fall back to keyword-only
 * @param {import('../SQLiteIndex')} index
 * @param {string} query
 * @param {number[] | null} queryEmbedding - May be null if embedding failed
 * @param {string} model
 * @param {HybridSearchOptions} options
 * @returns {HybridSearchResult[]}
 */
function searchWithFallback(index, query, queryEmbedding, model, options = {}) {
    const { maxResults = 5, minScore = 0.3 } = options;

    // If we have an embedding, try hybrid search
    if (queryEmbedding && queryEmbedding.length > 0) {
        const results = hybridSearch(index, query, queryEmbedding, model, options);

        // If hybrid search found results, return them
        if (results.length > 0) {
            return results;
        }
    }

    // Fallback to keyword-only search
    const keywordResults = searchKeyword(index, query, maxResults);

    return keywordResults
        .filter(r => r.score >= minScore)
        .map(r => ({
            ...r,
            vectorScore: 0,
            textScore: r.score
        }));
}

/**
 * Rerank results based on additional criteria
 * Can be used to boost recent results, specific tiers, etc.
 * @param {HybridSearchResult[]} results
 * @param {Object} boosts
 * @param {number} [boosts.recencyWeight=0] - Boost for recent chunks
 * @param {string[]} [boosts.preferPaths=[]] - Paths to boost
 * @param {number} [boosts.pathBoost=0.1] - Boost amount for preferred paths
 * @returns {HybridSearchResult[]}
 */
function rerankResults(results, boosts = {}) {
    const {
        recencyWeight = 0,
        preferPaths = [],
        pathBoost = 0.1
    } = boosts;

    if (recencyWeight === 0 && preferPaths.length === 0) {
        return results; // No reranking needed
    }

    const reranked = results.map(r => {
        let adjustedScore = r.score;

        // Boost preferred paths (like MEMORY.md)
        if (preferPaths.some(p => r.path.includes(p))) {
            adjustedScore += pathBoost;
        }

        // Recency boost based on path (daily logs have dates)
        if (recencyWeight > 0) {
            const dateMatch = r.path.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                const fileDate = new Date(dateMatch[1]);
                const now = new Date();
                const daysAgo = (now - fileDate) / (1000 * 60 * 60 * 24);

                // Decay: 1.0 for today, ~0.5 for 7 days ago, ~0.1 for 30 days
                const recencyScore = Math.exp(-daysAgo / 10);
                adjustedScore += recencyWeight * recencyScore;
            }
        }

        return { ...r, score: Math.min(1, adjustedScore) };
    });

    return reranked.sort((a, b) => b.score - a.score);
}

/**
 * Group results by source file
 * Useful for showing context from multiple files
 * @param {HybridSearchResult[]} results
 * @returns {Map<string, HybridSearchResult[]>}
 */
function groupByFile(results) {
    const grouped = new Map();

    for (const r of results) {
        if (!grouped.has(r.path)) {
            grouped.set(r.path, []);
        }
        grouped.get(r.path).push(r);
    }

    // Sort chunks within each file by line number
    for (const chunks of grouped.values()) {
        chunks.sort((a, b) => a.startLine - b.startLine);
    }

    return grouped;
}

/**
 * Deduplicate overlapping chunks
 * If chunks from the same file overlap significantly, keep the higher-scored one
 * @param {HybridSearchResult[]} results
 * @param {number} overlapThreshold - Minimum overlap ratio to consider duplicate (0-1)
 * @returns {HybridSearchResult[]}
 */
function deduplicateOverlapping(results, overlapThreshold = 0.5) {
    const deduplicated = [];

    for (const result of results) {
        let isDuplicate = false;

        for (const existing of deduplicated) {
            if (existing.path !== result.path) continue;

            // Check for line overlap
            const overlapStart = Math.max(existing.startLine, result.startLine);
            const overlapEnd = Math.min(existing.endLine, result.endLine);
            const overlapLines = Math.max(0, overlapEnd - overlapStart + 1);

            const resultLines = result.endLine - result.startLine + 1;
            const overlapRatio = overlapLines / resultLines;

            if (overlapRatio >= overlapThreshold) {
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            deduplicated.push(result);
        }
    }

    return deduplicated;
}

module.exports = {
    hybridSearch,
    searchWithFallback,
    rerankResults,
    groupByFile,
    deduplicateOverlapping
};
