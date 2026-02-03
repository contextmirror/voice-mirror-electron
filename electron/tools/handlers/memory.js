/**
 * Memory tool handlers.
 *
 * Interfaces with Voice Mirror's memory system for search and storage.
 * Uses the same data directory as the MCP server.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Get the memory data directory.
 */
function getMemoryDir() {
    const config = require('../../config');
    return config.getDataDir();
}

/**
 * Search memories by keyword/phrase.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.query - Search query
 * @returns {Promise<Object>} Search results or error
 */
async function memorySearch(args = {}) {
    const { query } = args;

    if (!query) {
        return {
            success: false,
            error: 'Search query is required'
        };
    }

    try {
        const memoryDir = getMemoryDir();
        const results = [];

        // Search core memories
        const coreFile = path.join(memoryDir, 'memory_core.json');
        if (fs.existsSync(coreFile)) {
            const coreData = JSON.parse(fs.readFileSync(coreFile, 'utf-8'));
            const coreMatches = searchInMemories(coreData.memories || [], query);
            results.push(...coreMatches.map(m => ({ ...m, tier: 'core' })));
        }

        // Search stable memories
        const stableFile = path.join(memoryDir, 'memory_stable.json');
        if (fs.existsSync(stableFile)) {
            const stableData = JSON.parse(fs.readFileSync(stableFile, 'utf-8'));
            const stableMatches = searchInMemories(stableData.memories || [], query);
            results.push(...stableMatches.map(m => ({ ...m, tier: 'stable' })));
        }

        // Search notes
        const notesFile = path.join(memoryDir, 'memory_notes.json');
        if (fs.existsSync(notesFile)) {
            const notesData = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
            const notesMatches = searchInMemories(notesData.memories || [], query);
            results.push(...notesMatches.map(m => ({ ...m, tier: 'notes' })));
        }

        if (results.length === 0) {
            return {
                success: true,
                result: `No memories found matching "${query}".`,
                results: []
            };
        }

        // Format results
        const formatted = results.slice(0, 10).map((r, i) => {
            return `${i + 1}. [${r.tier}] ${r.content}`;
        }).join('\n');

        return {
            success: true,
            result: `Found ${results.length} memories matching "${query}":\n\n${formatted}`,
            results: results.slice(0, 10)
        };

    } catch (err) {
        console.error('[MemorySearch] Error:', err);
        return {
            success: false,
            error: `Memory search failed: ${err.message}`
        };
    }
}

/**
 * Simple keyword search in memories.
 */
function searchInMemories(memories, query) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    return memories.filter(m => {
        const content = (m.content || '').toLowerCase();
        // Match if any query word appears in content
        return queryWords.some(word => content.includes(word));
    });
}

/**
 * Store a new memory.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.content - What to remember
 * @param {string} args.tier - Memory tier (core, stable, notes)
 * @returns {Promise<Object>} Result or error
 */
async function memoryRemember(args = {}) {
    const { content, tier = 'stable' } = args;

    if (!content) {
        return {
            success: false,
            error: 'Content is required'
        };
    }

    const validTiers = ['core', 'stable', 'notes'];
    if (!validTiers.includes(tier)) {
        return {
            success: false,
            error: `Invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}`
        };
    }

    try {
        const memoryDir = getMemoryDir();

        // Ensure directory exists
        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
        }

        const memoryFile = path.join(memoryDir, `memory_${tier}.json`);

        // Load or create memory file
        let data = { memories: [], metadata: { tier, created: new Date().toISOString() } };
        if (fs.existsSync(memoryFile)) {
            try {
                data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
                if (!data.memories) data.memories = [];
            } catch (e) {
                // Reset if corrupted
                data = { memories: [], metadata: { tier, created: new Date().toISOString() } };
            }
        }

        // Add new memory
        const newMemory = {
            id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content,
            created: new Date().toISOString(),
            source: 'local-llm-tool'
        };

        data.memories.push(newMemory);
        data.metadata = data.metadata || {};
        data.metadata.updated = new Date().toISOString();

        // Enforce limits per tier
        const limits = { core: 100, stable: 500, notes: 200 };
        if (data.memories.length > limits[tier]) {
            // Remove oldest entries
            data.memories = data.memories.slice(-limits[tier]);
        }

        // Save
        fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2));

        return {
            success: true,
            result: `Remembered in ${tier} tier: "${content}"`,
            memory_id: newMemory.id
        };

    } catch (err) {
        console.error('[MemoryRemember] Error:', err);
        return {
            success: false,
            error: `Failed to store memory: ${err.message}`
        };
    }
}

/**
 * Forget (delete) a specific memory by content match.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.content - Content to match and delete
 * @returns {Promise<Object>} Result or error
 */
async function memoryForget(args = {}) {
    const { content } = args;

    if (!content) {
        return { success: false, error: 'Content is required to identify what to forget' };
    }

    try {
        const memoryDir = getMemoryDir();
        const contentLower = content.toLowerCase();
        let totalDeleted = 0;

        for (const tier of ['core', 'stable', 'notes']) {
            const memoryFile = path.join(memoryDir, `memory_${tier}.json`);
            if (!fs.existsSync(memoryFile)) continue;

            const data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
            if (!data.memories) continue;

            const before = data.memories.length;
            data.memories = data.memories.filter(m =>
                !(m.content || '').toLowerCase().includes(contentLower)
            );
            const deleted = before - data.memories.length;

            if (deleted > 0) {
                totalDeleted += deleted;
                data.metadata = data.metadata || {};
                data.metadata.updated = new Date().toISOString();
                fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2));
            }
        }

        if (totalDeleted === 0) {
            return { success: true, result: `No memories found matching "${content}".` };
        }

        return { success: true, result: `Forgot ${totalDeleted} memory(s) matching "${content}".` };
    } catch (err) {
        console.error('[MemoryForget] Error:', err);
        return { success: false, error: `Failed to forget: ${err.message}` };
    }
}

/**
 * Clear all memories in a tier (or all tiers).
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.tier - Tier to clear: core, stable, notes, or "all"
 * @returns {Promise<Object>} Result or error
 */
async function memoryClear(args = {}) {
    const { tier = 'all' } = args;

    const validTiers = ['core', 'stable', 'notes', 'all'];
    if (!validTiers.includes(tier)) {
        return { success: false, error: `Invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}` };
    }

    try {
        const memoryDir = getMemoryDir();
        const tiersToClean = tier === 'all' ? ['core', 'stable', 'notes'] : [tier];
        let totalCleared = 0;

        for (const t of tiersToClean) {
            const memoryFile = path.join(memoryDir, `memory_${t}.json`);
            if (!fs.existsSync(memoryFile)) continue;

            const data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
            const count = (data.memories || []).length;
            totalCleared += count;

            data.memories = [];
            data.metadata = data.metadata || {};
            data.metadata.updated = new Date().toISOString();
            fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2));
        }

        const tierLabel = tier === 'all' ? 'all tiers' : `${tier} tier`;
        return { success: true, result: `Cleared ${totalCleared} memory(s) from ${tierLabel}.` };
    } catch (err) {
        console.error('[MemoryClear] Error:', err);
        return { success: false, error: `Failed to clear memories: ${err.message}` };
    }
}

module.exports = { memorySearch, memoryRemember, memoryForget, memoryClear };
