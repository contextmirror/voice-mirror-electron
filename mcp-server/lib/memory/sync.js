/**
 * Voice Mirror Memory System - File Watcher & Sync
 * Watches markdown files for changes and triggers incremental reindexing
 */

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const { debounce, sha256 } = require('./utils');

/**
 * @typedef {Object} SyncStats
 * @property {number} filesWatched - Number of files being watched
 * @property {number} syncsTriggered - Number of sync operations triggered
 * @property {number} lastSyncTime - Timestamp of last sync
 * @property {string[]} watchedPaths - Paths being watched
 */

/**
 * File watcher and sync manager for the memory system
 */
class MemorySync {
    /**
     * @param {import('./MemoryManager')} memoryManager - Memory manager instance
     * @param {Object} options
     * @param {number} [options.debounceMs=1500] - Debounce delay for sync
     * @param {boolean} [options.ignoreInitial=true] - Ignore initial scan
     */
    constructor(memoryManager, options = {}) {
        this.manager = memoryManager;
        this.options = {
            debounceMs: options.debounceMs || 1500,
            ignoreInitial: options.ignoreInitial !== false
        };

        this.watcher = null;
        this.stats = {
            filesWatched: 0,
            syncsTriggered: 0,
            lastSyncTime: 0,
            watchedPaths: []
        };

        // Debounced sync function
        this._debouncedSync = debounce(
            () => this._performSync(),
            this.options.debounceMs
        );

        // Pending changes queue
        this._pendingChanges = new Set();
    }

    /**
     * Start watching memory files for changes
     * @returns {Promise<void>}
     */
    async start() {
        if (this.watcher) {
            console.error('[MemorySync] Watcher already running');
            return;
        }

        // Ensure manager is initialized
        await this.manager.init();

        const memoryDir = this.manager.config.memoryDir;
        const watchPaths = [
            path.join(memoryDir, 'MEMORY.md'),
            path.join(memoryDir, 'daily')
        ];

        this.stats.watchedPaths = watchPaths;

        this.watcher = chokidar.watch(watchPaths, {
            ignoreInitial: this.options.ignoreInitial,
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            },
            ignored: [
                /(^|[\/\\])\../,  // Ignore dotfiles
                /\.db$/,          // Ignore SQLite files
                /\.db-journal$/,
                /\.db-wal$/,
                /\.db-shm$/
            ]
        });

        // Set up event handlers
        this.watcher
            .on('add', (filePath) => this._onFileChange('add', filePath))
            .on('change', (filePath) => this._onFileChange('change', filePath))
            .on('unlink', (filePath) => this._onFileChange('unlink', filePath))
            .on('ready', () => {
                const watched = this.watcher.getWatched();
                let count = 0;
                for (const dir in watched) {
                    count += watched[dir].length;
                }
                this.stats.filesWatched = count;
                console.error(`[MemorySync] Watching ${count} files in ${watchPaths.length} paths`);
            })
            .on('error', (err) => {
                console.error(`[MemorySync] Watcher error: ${err.message}`);
            });
    }

    /**
     * Stop watching files
     */
    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            console.error('[MemorySync] Watcher stopped');
        }
    }

    /**
     * Handle file change event
     * @param {string} event - Event type (add, change, unlink)
     * @param {string} filePath - Path to changed file
     */
    _onFileChange(event, filePath) {
        // Only process markdown files
        if (!filePath.endsWith('.md')) {
            return;
        }

        console.error(`[MemorySync] File ${event}: ${path.basename(filePath)}`);

        // Add to pending changes
        this._pendingChanges.add(filePath);

        // Trigger debounced sync
        this._debouncedSync();
    }

    /**
     * Perform sync operation for pending changes
     */
    async _performSync() {
        if (this._pendingChanges.size === 0) {
            return;
        }

        const changes = [...this._pendingChanges];
        this._pendingChanges.clear();

        console.error(`[MemorySync] Syncing ${changes.length} changed file(s)...`);

        try {
            for (const filePath of changes) {
                await this._syncFile(filePath);
            }

            this.stats.syncsTriggered++;
            this.stats.lastSyncTime = Date.now();

            console.error(`[MemorySync] Sync complete`);
        } catch (err) {
            console.error(`[MemorySync] Sync error: ${err.message}`);
        }
    }

    /**
     * Sync a single file to the index
     * @param {string} filePath - Path to file
     */
    async _syncFile(filePath) {
        const db = this.manager.index.getDb();

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            // File was deleted - remove from index
            console.error(`[MemorySync] Removing deleted file: ${path.basename(filePath)}`);
            db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
            db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
            return;
        }

        // Read file and check if it needs reindexing
        const content = await fs.readFile(filePath, 'utf-8');
        const hash = sha256(content);
        const stat = await fs.stat(filePath);

        if (!this.manager.index.needsReindex(filePath, hash)) {
            console.error(`[MemorySync] File unchanged: ${path.basename(filePath)}`);
            return;
        }

        // Clear old chunks for this file
        db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);

        // Determine file type and tier
        const isMemoryFile = filePath.endsWith('MEMORY.md');
        const tier = isMemoryFile ? 'stable' : 'volatile';

        // Chunk and index
        const Chunker = require('./Chunker');
        const chunks = Chunker.smartChunk(content, filePath, this.manager.config.chunking);

        for (const chunk of chunks) {
            await this.manager.indexChunk(filePath, chunk, tier);
        }

        // Update file metadata
        this.manager.index.upsertFile(filePath, hash, stat.mtimeMs, stat.size);

        console.error(`[MemorySync] Indexed ${chunks.length} chunks from ${path.basename(filePath)}`);
    }

    /**
     * Force sync all files (full reindex)
     */
    async syncAll() {
        console.error('[MemorySync] Starting full sync...');
        await this.manager.syncAllFiles();
        this.stats.syncsTriggered++;
        this.stats.lastSyncTime = Date.now();
    }

    /**
     * Get sync statistics
     * @returns {SyncStats}
     */
    getStats() {
        return { ...this.stats };
    }
}

/**
 * Create and start a file watcher for the memory system
 * @param {import('./MemoryManager')} memoryManager
 * @param {Object} options
 * @returns {Promise<MemorySync>}
 */
async function startMemorySync(memoryManager, options = {}) {
    const sync = new MemorySync(memoryManager, options);
    await sync.start();
    return sync;
}

module.exports = MemorySync;
module.exports.startMemorySync = startMemorySync;
