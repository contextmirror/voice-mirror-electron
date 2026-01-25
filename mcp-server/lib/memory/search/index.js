/**
 * Voice Mirror Memory System - Search Module
 * Exports all search functions for memory retrieval
 */

const vector = require('./vector');
const keyword = require('./keyword');
const hybrid = require('./hybrid');

module.exports = {
    // Vector search (cosine similarity)
    searchVector: vector.searchVector,
    cosineSimilarity: vector.cosineSimilarity,

    // Keyword search (BM25/FTS5)
    searchKeyword: keyword.searchKeyword,
    searchPhrase: keyword.searchPhrase,
    searchPrefix: keyword.searchPrefix,
    buildFtsQuery: keyword.buildFtsQuery,
    bm25RankToScore: keyword.bm25RankToScore,
    getSnippet: keyword.getSnippet,

    // Hybrid search (70% vector + 30% keyword)
    hybridSearch: hybrid.hybridSearch,
    searchWithFallback: hybrid.searchWithFallback,
    rerankResults: hybrid.rerankResults,
    groupByFile: hybrid.groupByFile,
    deduplicateOverlapping: hybrid.deduplicateOverlapping
};
