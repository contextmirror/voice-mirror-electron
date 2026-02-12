/**
 * Voice Mirror Memory System - Conversation Logger
 * Auto-logs all voice exchanges to daily markdown files
 */

const MarkdownStore = require('./MarkdownStore');
const { sha256, getDataDir } = require('./utils');
const fs = require('fs').promises;
const path = require('path');

class ConversationLogger {
    constructor(markdownStore = null) {
        this.store = markdownStore || new MarkdownStore();
        this.loggedIds = new Set();
        this.maxLoggedIds = 1000; // Prevent memory leak
        this._initialized = false;
    }

    /**
     * Initialize the logger
     */
    async init() {
        if (this._initialized) return;
        await this.store.init();
        this._initialized = true;
    }

    /**
     * Log a conversation exchange
     * @param {Object} params - Exchange parameters
     * @param {string} params.userMessage - User's message
     * @param {string} params.assistantResponse - Assistant's response
     * @param {string} [params.messageId] - Optional message ID for deduplication
     * @param {string} [params.imagePath] - Optional screenshot path
     * @param {Object} [params.metadata] - Optional metadata (tool_calls, source, etc.)
     * @returns {Promise<boolean>} True if logged, false if duplicate
     */
    async log(params) {
        await this.init();

        const { userMessage, assistantResponse, messageId, imagePath, metadata } = params;

        // Generate ID for deduplication
        const id = messageId || sha256(`${userMessage}:${assistantResponse}:${Date.now()}`);

        // Check for duplicate
        if (this.loggedIds.has(id)) {
            return false;
        }

        // Validate inputs
        if (!userMessage || !assistantResponse) {
            console.warn('ConversationLogger: Missing userMessage or assistantResponse');
            return false;
        }

        // Log to daily file
        await this.store.appendConversation({
            userMessage: this.cleanMessage(userMessage),
            assistantResponse: this.cleanMessage(assistantResponse),
            imagePath,
            metadata
        });

        // Track logged ID
        this.loggedIds.add(id);

        // Prevent memory leak by clearing old IDs
        if (this.loggedIds.size > this.maxLoggedIds) {
            const idsArray = Array.from(this.loggedIds);
            this.loggedIds = new Set(idsArray.slice(-500));
        }

        return true;
    }

    /**
     * Clean message for markdown storage
     * @param {string} message - Raw message
     * @returns {string} Cleaned message
     */
    cleanMessage(message) {
        if (!message) return '';

        return message
            // Remove control characters
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            // Collapse multiple newlines
            .replace(/\n{3,}/g, '\n\n')
            // Trim whitespace
            .trim();
    }

    /**
     * Watch the inbox file for new conversations to log
     * This is optional - can also be called directly from message handlers
     * @param {string} inboxPath - Path to inbox.json
     * @param {number} pollInterval - Poll interval in ms (default: 5000)
     * @returns {Function} Stop function
     */
    watchInbox(inboxPath = null, pollInterval = 5000) {
        const dataDir = getDataDir();
        const inbox = inboxPath || path.join(dataDir, 'inbox.json');

        let lastProcessedTime = Date.now();
        let running = true;

        const processInbox = async () => {
            try {
                const content = await fs.readFile(inbox, 'utf-8');
                const data = JSON.parse(content);

                if (!data.messages || !Array.isArray(data.messages)) {
                    return;
                }

                // Process new messages
                for (const msg of data.messages) {
                    const msgTime = new Date(msg.timestamp).getTime();
                    if (msgTime <= lastProcessedTime) continue;

                    // Look for user-assistant pairs
                    if (msg.from !== 'claude' && msg.from !== 'assistant') {
                        // This is a user message, find the corresponding response
                        const response = data.messages.find(m =>
                            (m.from === 'claude' || m.from === 'assistant') &&
                            new Date(m.timestamp).getTime() > msgTime &&
                            new Date(m.timestamp).getTime() < msgTime + 60000 // Within 1 minute
                        );

                        if (response) {
                            await this.log({
                                userMessage: msg.message,
                                assistantResponse: response.message,
                                messageId: msg.id,
                                metadata: {
                                    source: 'inbox_watch',
                                    thread_id: msg.thread_id
                                }
                            });
                        }
                    }

                    lastProcessedTime = Math.max(lastProcessedTime, msgTime);
                }
            } catch (err) {
                // Inbox might not exist yet or be malformed
                if (err.code !== 'ENOENT') {
                    console.error('ConversationLogger: Error processing inbox:', err.message);
                }
            }
        };

        // Start polling
        const interval = setInterval(() => {
            if (running) {
                processInbox().catch(console.error);
            }
        }, pollInterval);

        // Return stop function
        return () => {
            running = false;
            clearInterval(interval);
        };
    }

    /**
     * Get the MarkdownStore instance
     * @returns {MarkdownStore}
     */
    getStore() {
        return this.store;
    }

    /**
     * Check if a message ID has already been logged
     * @param {string} id - Message ID
     * @returns {boolean}
     */
    isLogged(id) {
        return this.loggedIds.has(id);
    }

    /**
     * Clear the logged IDs cache
     */
    clearCache() {
        this.loggedIds.clear();
    }
}

// Singleton instance for global use
let instance = null;

/**
 * Get the singleton ConversationLogger instance
 * @returns {ConversationLogger}
 */
function getLogger() {
    if (!instance) {
        instance = new ConversationLogger();
    }
    return instance;
}

module.exports = ConversationLogger;
module.exports.getLogger = getLogger;
