/**
 * Voice Mirror Memory System - Keyword Search (BM25)
 * Full-text search using SQLite FTS5
 */

/**
 * @typedef {Object} KeywordSearchResult
 * @property {string} id - Chunk ID
 * @property {string} path - Source file path
 * @property {number} startLine - Start line
 * @property {number} endLine - End line
 * @property {string} text - Chunk text (or snippet)
 * @property {number} score - BM25 score (normalized 0-1)
 * @property {number} rank - Raw BM25 rank
 */

/**
 * Build FTS5 query from natural language
 * Converts "hello world" to '"hello" AND "world"'
 * @param {string} query - Natural language query
 * @returns {string | null} FTS5 query or null if invalid
 */
function buildFtsQuery(query) {
    if (!query || typeof query !== 'string') {
        return null;
    }

    // Extract alphanumeric tokens
    const tokens = query.match(/[A-Za-z0-9_]+/g);

    if (!tokens || tokens.length === 0) {
        return null;
    }

    // Quote each token and join with AND
    const quoted = tokens.map(t => `"${t.replace(/"/g, '')}"`);
    return quoted.join(' AND ');
}

/**
 * Convert BM25 rank to normalized score (0-1)
 * BM25 rank is negative (more negative = better match)
 * @param {number} rank - Raw BM25 rank
 * @returns {number} Normalized score (0-1)
 */
function bm25RankToScore(rank) {
    // BM25 returns negative values, more negative = better match
    // Convert to positive score where higher = better
    const normalized = Number.isFinite(rank) ? Math.max(0, -rank) : 0;
    return 1 / (1 + normalized);
}

/**
 * Search chunks using FTS5 keyword matching
 * @param {import('../SQLiteIndex')} index - SQLite index instance
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {KeywordSearchResult[]}
 */
function searchKeyword(index, query, limit = 10) {
    if (!index.ftsAvailable) {
        return [];
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
        return [];
    }

    const db = index.getDb();

    try {
        const results = db.prepare(`
            SELECT
                id,
                path,
                start_line as startLine,
                end_line as endLine,
                text,
                bm25(chunks_fts) as rank
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(ftsQuery, limit);

        return results.map(row => ({
            id: row.id,
            path: row.path,
            startLine: row.startLine,
            endLine: row.endLine,
            text: row.text,
            rank: row.rank,
            score: bm25RankToScore(row.rank)
        }));
    } catch (err) {
        console.warn('FTS search failed:', err.message);
        return [];
    }
}

/**
 * Search with phrase matching
 * @param {import('../SQLiteIndex')} index
 * @param {string} phrase - Exact phrase to match
 * @param {number} limit
 * @returns {KeywordSearchResult[]}
 */
function searchPhrase(index, phrase, limit = 10) {
    if (!index.ftsAvailable) {
        return [];
    }

    const db = index.getDb();

    try {
        // Escape the phrase for FTS5
        const escaped = `"${phrase.replace(/"/g, '""')}"`;

        const results = db.prepare(`
            SELECT
                id,
                path,
                start_line as startLine,
                end_line as endLine,
                text,
                bm25(chunks_fts) as rank
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(escaped, limit);

        return results.map(row => ({
            id: row.id,
            path: row.path,
            startLine: row.startLine,
            endLine: row.endLine,
            text: row.text,
            rank: row.rank,
            score: bm25RankToScore(row.rank)
        }));
    } catch (err) {
        console.warn('Phrase search failed:', err.message);
        return [];
    }
}

/**
 * Search with prefix matching (autocomplete style)
 * @param {import('../SQLiteIndex')} index
 * @param {string} prefix - Prefix to match
 * @param {number} limit
 * @returns {KeywordSearchResult[]}
 */
function searchPrefix(index, prefix, limit = 10) {
    if (!index.ftsAvailable || !prefix || prefix.length < 2) {
        return [];
    }

    const db = index.getDb();

    try {
        // FTS5 prefix query
        const ftsQuery = `"${prefix.replace(/"/g, '')}"*`;

        const results = db.prepare(`
            SELECT
                id,
                path,
                start_line as startLine,
                end_line as endLine,
                text,
                bm25(chunks_fts) as rank
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(ftsQuery, limit);

        return results.map(row => ({
            id: row.id,
            path: row.path,
            startLine: row.startLine,
            endLine: row.endLine,
            text: row.text,
            rank: row.rank,
            score: bm25RankToScore(row.rank)
        }));
    } catch (err) {
        console.warn('Prefix search failed:', err.message);
        return [];
    }
}

/**
 * Get snippet with highlighted matches
 * @param {string} text - Full text
 * @param {string} query - Search query
 * @param {number} contextChars - Characters of context around match
 * @returns {string} Snippet with matches
 */
function getSnippet(text, query, contextChars = 50) {
    if (!text || !query) return text;

    const tokens = query.match(/[A-Za-z0-9_]+/g);
    if (!tokens || tokens.length === 0) return text.slice(0, contextChars * 2);

    // Find first token match
    const lowerText = text.toLowerCase();
    let firstMatch = -1;
    let matchedToken = '';

    for (const token of tokens) {
        const idx = lowerText.indexOf(token.toLowerCase());
        if (idx !== -1 && (firstMatch === -1 || idx < firstMatch)) {
            firstMatch = idx;
            matchedToken = token;
        }
    }

    if (firstMatch === -1) {
        return text.slice(0, contextChars * 2);
    }

    // Extract snippet around match
    const start = Math.max(0, firstMatch - contextChars);
    const end = Math.min(text.length, firstMatch + matchedToken.length + contextChars);

    let snippet = text.slice(start, end);

    // Add ellipsis if truncated
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
}

module.exports = {
    buildFtsQuery,
    bm25RankToScore,
    searchKeyword,
    searchPhrase,
    searchPrefix,
    getSnippet
};
