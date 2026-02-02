/**
 * Voice Mirror Memory System - Session Manager
 * Handles session tracking, inactivity detection, and memory flush
 *
 * Since Voice Mirror uses stateless Claude (--print mode), we can't
 * hook into Claude's compaction. Instead we use:
 * 1. Session Timeout Flush (5 min inactivity)
 * 2. App Shutdown Flush
 * 3. Explicit flush command
 */

const { getTodayDate, getCurrentTime } = require('./utils');

/**
 * @typedef {Object} SessionState
 * @property {Date} startTime - Session start time
 * @property {Date} lastActivity - Last activity time
 * @property {number} messageCount - Number of messages this session
 * @property {string[]} topics - Topics discussed (extracted from messages)
 * @property {boolean} flushed - Whether session has been flushed
 */

/**
 * Session manager for Voice Mirror memory system
 */
class SessionManager {
    /**
     * @param {import('./MemoryManager')} memoryManager
     * @param {import('./ConversationLogger')} conversationLogger
     * @param {Object} options
     * @param {number} [options.inactivityMinutes=5] - Minutes before inactivity flush
     * @param {number} [options.checkIntervalMs=60000] - Interval to check for inactivity
     * @param {boolean} [options.autoFlush=true] - Enable automatic inactivity flush
     */
    constructor(memoryManager, conversationLogger, options = {}) {
        this.manager = memoryManager;
        this.logger = conversationLogger;
        this.options = {
            inactivityMinutes: options.inactivityMinutes || 5,
            checkIntervalMs: options.checkIntervalMs || 60000,
            autoFlush: options.autoFlush !== false
        };

        this.session = this._createNewSession();
        this._checkInterval = null;
        this._flushCallbacks = [];
    }

    /**
     * Create a new session state
     * @returns {SessionState}
     */
    _createNewSession() {
        return {
            startTime: new Date(),
            lastActivity: new Date(),
            messageCount: 0,
            topics: [],
            flushed: false
        };
    }

    /**
     * Start the session manager
     */
    start() {
        if (this._checkInterval) {
            return; // Already running
        }

        console.error(`[SessionManager] Started (flush after ${this.options.inactivityMinutes} min inactivity)`);

        if (this.options.autoFlush) {
            this._checkInterval = setInterval(
                () => this._checkInactivity(),
                this.options.checkIntervalMs
            );
        }
    }

    /**
     * Stop the session manager
     */
    stop() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    }

    /**
     * Record activity (call on each message)
     * @param {Object} activity
     * @param {string} [activity.userMessage] - User's message
     * @param {string} [activity.assistantResponse] - Assistant's response
     */
    recordActivity(activity = {}) {
        this.session.lastActivity = new Date();
        this.session.messageCount++;

        // Extract potential topics from messages
        if (activity.userMessage) {
            const topics = this._extractTopics(activity.userMessage);
            for (const topic of topics) {
                if (!this.session.topics.includes(topic)) {
                    this.session.topics.push(topic);
                }
            }
            // Cap topics to prevent unbounded growth
            if (this.session.topics.length > 200) {
                this.session.topics = this.session.topics.slice(-200);
            }
        }

        // Reset flushed flag on new activity
        this.session.flushed = false;
    }

    /**
     * Extract potential topics from a message
     * @param {string} message
     * @returns {string[]}
     */
    _extractTopics(message) {
        const topics = [];

        // Look for explicit topic markers
        const rememberMatch = message.match(/remember\s+(?:that\s+)?(.{10,50})/i);
        if (rememberMatch) {
            topics.push(rememberMatch[1].trim());
        }

        // Look for project/file references
        const projectMatch = message.match(/(?:working on|project|file|about)\s+([A-Za-z0-9_-]+)/i);
        if (projectMatch) {
            topics.push(projectMatch[1]);
        }

        return topics;
    }

    /**
     * Check for inactivity and trigger flush if needed
     */
    async _checkInactivity() {
        const now = new Date();
        const inactiveMs = now - this.session.lastActivity;
        const inactiveMinutes = inactiveMs / 60000;

        if (inactiveMinutes >= this.options.inactivityMinutes && !this.session.flushed) {
            console.error(`[SessionManager] Inactivity detected (${Math.round(inactiveMinutes)} min), flushing session...`);
            await this.flushSession('inactivity');
        }
    }

    /**
     * Flush the current session
     * @param {string} reason - Reason for flush ('inactivity', 'shutdown', 'explicit')
     * @returns {Promise<Object>} Flush result
     */
    async flushSession(reason = 'explicit') {
        if (this.session.flushed && reason !== 'shutdown') {
            return { success: true, reason: 'already_flushed' };
        }

        const sessionDuration = (new Date() - this.session.startTime) / 60000;
        const summary = this._generateSessionSummary();

        console.error(`[SessionManager] Flushing session (${reason}): ${this.session.messageCount} messages, ${Math.round(sessionDuration)} min`);

        try {
            // If we have topics or significant activity, save a session note
            if (this.session.topics.length > 0 || this.session.messageCount >= 3) {
                await this.manager.init();

                const noteContent = [
                    `Session ${getTodayDate()} ${getCurrentTime()}`,
                    `Duration: ${Math.round(sessionDuration)} minutes`,
                    `Messages: ${this.session.messageCount}`,
                    this.session.topics.length > 0
                        ? `Topics: ${this.session.topics.join(', ')}`
                        : null,
                    summary ? `Summary: ${summary}` : null
                ].filter(Boolean).join(' | ');

                // Add as a note (volatile tier)
                await this.manager.remember(noteContent, 'notes');
            }

            // Mark session as flushed
            this.session.flushed = true;

            // Call flush callbacks
            for (const callback of this._flushCallbacks) {
                try {
                    await callback(reason, this.session);
                } catch (err) {
                    console.error(`[SessionManager] Flush callback error: ${err.message}`);
                }
            }

            return {
                success: true,
                reason,
                messageCount: this.session.messageCount,
                durationMinutes: Math.round(sessionDuration),
                topics: this.session.topics
            };
        } catch (err) {
            console.error(`[SessionManager] Flush error: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Generate a summary of the current session
     * @returns {string | null}
     */
    _generateSessionSummary() {
        if (this.session.messageCount === 0) {
            return null;
        }

        if (this.session.topics.length > 0) {
            return `Discussed: ${this.session.topics.slice(0, 3).join(', ')}`;
        }

        return `${this.session.messageCount} voice exchanges`;
    }

    /**
     * Register a callback to be called on session flush
     * @param {Function} callback - Async function(reason, session)
     */
    onFlush(callback) {
        this._flushCallbacks.push(callback);
    }

    /**
     * Start a new session (after flush)
     */
    newSession() {
        this.session = this._createNewSession();
        console.error('[SessionManager] New session started');
    }

    /**
     * Get current session state
     * @returns {SessionState}
     */
    getState() {
        const now = new Date();
        return {
            ...this.session,
            idleMinutes: Math.round((now - this.session.lastActivity) / 60000),
            durationMinutes: Math.round((now - this.session.startTime) / 60000)
        };
    }

    /**
     * Shutdown - flush and cleanup
     */
    async shutdown() {
        this.stop();
        await this.flushSession('shutdown');
    }
}

/**
 * Create a session manager for the memory system
 * @param {import('./MemoryManager')} memoryManager
 * @param {import('./ConversationLogger')} conversationLogger
 * @param {Object} options
 * @returns {SessionManager}
 */
function createSessionManager(memoryManager, conversationLogger, options = {}) {
    return new SessionManager(memoryManager, conversationLogger, options);
}

module.exports = SessionManager;
module.exports.createSessionManager = createSessionManager;
