/**
 * Base Provider - Abstract base class for AI providers
 *
 * All provider implementations should extend this class.
 * Provides common interface for spawning, stopping, and communicating with AI services.
 */

const { EventEmitter } = require('events');

class BaseProvider extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.running = false;
        this.model = null;
        this.onOutput = null;  // Callback for output events (legacy)
        this.onExit = null;    // Callback for exit events (legacy)
    }

    /**
     * Get the provider type identifier
     * @returns {string} Provider type (e.g., 'claude', 'ollama')
     */
    getType() {
        throw new Error('getType() must be implemented by subclass');
    }

    /**
     * Get display name for UI
     * @returns {string} Human-readable name (e.g., 'Claude Code', 'Ollama (llama3.2)')
     */
    getDisplayName() {
        throw new Error('getDisplayName() must be implemented by subclass');
    }

    /**
     * Get the currently loaded model
     * @returns {string|null} Model identifier or null
     */
    getLoadedModel() {
        return this.model;
    }

    /**
     * Check if provider is currently running
     * @returns {boolean}
     */
    isRunning() {
        return this.running;
    }

    /**
     * Start the provider
     * @param {Object} options - Startup options
     * @returns {Promise<boolean>} Success status
     */
    async spawn(options = {}) {
        throw new Error('spawn() must be implemented by subclass');
    }

    /**
     * Stop the provider
     * @returns {Promise<void>}
     */
    async stop() {
        throw new Error('stop() must be implemented by subclass');
    }

    /**
     * Send input/message to the provider
     * @param {string} text - Message text
     * @returns {Promise<void>}
     */
    async sendInput(text) {
        throw new Error('sendInput() must be implemented by subclass');
    }

    /**
     * Send raw input (for terminal passthrough)
     * @param {string} data - Raw data to send
     */
    sendRawInput(data) {
        throw new Error('sendRawInput() must be implemented by subclass');
    }

    /**
     * Resize terminal (if applicable)
     * @param {number} cols - Column count
     * @param {number} rows - Row count
     */
    resize(cols, rows) {
        // Optional - only PTY-based providers need this
    }

    /**
     * Set output callback
     * @param {Function} callback - Called with { type: string, text: string }
     */
    setOutputCallback(callback) {
        this.onOutput = callback;
    }

    /**
     * Set exit callback
     * @param {Function} callback - Called with exit code
     */
    setExitCallback(callback) {
        this.onExit = callback;
    }

    /**
     * Emit output event
     * @param {string} type - Event type ('stdout', 'stderr', 'start', 'exit')
     * @param {string} text - Output text
     */
    emitOutput(type, text) {
        // Emit via EventEmitter (preferred)
        this.emit('output', { type, text });
        // Also call legacy callback if set
        if (this.onOutput) {
            this.onOutput({ type, text });
        }
    }

    /**
     * Emit exit event
     * @param {number} code - Exit code
     */
    emitExit(code) {
        this.running = false;
        // Emit via EventEmitter (preferred)
        this.emit('exit', code);
        // Also call legacy callback if set
        if (this.onExit) {
            this.onExit(code);
        }
    }

    /**
     * Check if provider supports MCP tools
     * @returns {boolean}
     */
    supportsMCP() {
        return false;
    }

    /**
     * Check if provider supports vision/images
     * @returns {boolean}
     */
    supportsVision() {
        return false;
    }

    /**
     * Check if this is a PTY-based provider (interactive terminal)
     * @returns {boolean}
     */
    isPTY() {
        return false;
    }
}

module.exports = { BaseProvider };
