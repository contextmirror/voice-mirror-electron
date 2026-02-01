/**
 * n8n workflow automation tool handler.
 *
 * Allows Voice Mirror to trigger n8n workflows via webhooks.
 * Use cases:
 * - "Check my emails" -> triggers email summary workflow
 * - "What workflows do I have?" -> lists available workflows
 *
 * Port of Voice Mirror's Python n8n.py to JavaScript.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// n8n API configuration
const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5678';
const N8N_API_KEY_FILE = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'n8n', 'api_key')
    : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'n8n', 'api_key')
        : path.join(os.homedir(), '.config', 'n8n', 'api_key');

/**
 * Get n8n API key from file or environment.
 */
function getApiKey() {
    // Try environment first
    if (process.env.N8N_API_KEY) {
        return process.env.N8N_API_KEY;
    }

    // Try file
    if (fs.existsSync(N8N_API_KEY_FILE)) {
        return fs.readFileSync(N8N_API_KEY_FILE, 'utf-8').trim();
    }

    return null;
}

/**
 * Make authenticated request to n8n API.
 */
async function apiRequest(endpoint, method = 'GET', data = null) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error(`n8n API key not configured. Set N8N_API_KEY env var or create ${N8N_API_KEY_FILE}`);
    }

    const url = `${N8N_API_URL}/api/v1${endpoint}`;
    const options = {
        method,
        headers: {
            'X-N8N-API-KEY': apiKey,
            'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(30000)
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('n8n API key is invalid');
        }
        throw new Error(`n8n API error: ${response.status}`);
    }

    return response.json();
}

/**
 * List available n8n workflows.
 *
 * @param {Object} args - Tool arguments (none required)
 * @returns {Promise<Object>} Result with workflow list
 */
async function n8nListWorkflows(args = {}) {
    try {
        const result = await apiRequest('/workflows');
        const workflows = result.data || [];

        if (workflows.length === 0) {
            return {
                success: true,
                result: 'No workflows found. Ask Claude to create one for you!'
            };
        }

        // Format for voice output
        const active = workflows.filter(w => w.active);
        const inactive = workflows.filter(w => !w.active);

        const parts = [];
        if (active.length > 0) {
            const names = active.slice(0, 5).map(w => w.name || 'Unnamed').join(', ');
            parts.push(`Active workflows: ${names}`);
        }
        if (inactive.length > 0) {
            const names = inactive.slice(0, 3).map(w => w.name || 'Unnamed').join(', ');
            parts.push(`Inactive: ${names}`);
        }

        return {
            success: true,
            result: parts.join('. ') || 'You have workflows but none are active.',
            workflows: workflows.map(w => ({
                id: w.id,
                name: w.name,
                active: w.active
            }))
        };

    } catch (err) {
        if (err.cause?.code === 'ECONNREFUSED') {
            return {
                success: false,
                error: "Can't connect to n8n. Is it running?"
            };
        }
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Trigger an n8n workflow via webhook.
 *
 * @param {Object} args - Tool arguments
 * @param {string} args.webhook_path - Webhook path to trigger
 * @param {string} args.workflow_id - Workflow ID (alternative to webhook_path)
 * @param {Object} args.data - Data to send to the webhook
 * @returns {Promise<Object>} Result from workflow
 */
async function n8nTriggerWorkflow(args = {}) {
    const { webhook_path, workflow_id, data = {} } = args;

    if (!webhook_path && !workflow_id) {
        return {
            success: false,
            error: 'Need either webhook_path or workflow_id to trigger a workflow'
        };
    }

    try {
        // Build webhook URL
        let url;
        if (webhook_path) {
            url = `${N8N_API_URL}/webhook/${webhook_path}`;
        } else {
            // Use test webhook for workflow ID
            url = `${N8N_API_URL}/webhook/test/${workflow_id}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(60000)  // Workflows can take time
        });

        if (!response.ok) {
            if (response.status === 404) {
                return {
                    success: false,
                    error: 'Webhook not found. Is the workflow active?'
                };
            }
            return {
                success: false,
                error: `Workflow returned HTTP ${response.status}`
            };
        }

        const result = await response.json();

        // Format result for voice
        if (result.message) {
            return {
                success: true,
                result: result.message
            };
        }

        return {
            success: true,
            result: 'Workflow triggered successfully.',
            data: result
        };

    } catch (err) {
        if (err.cause?.code === 'ECONNREFUSED') {
            return {
                success: false,
                error: "Can't connect to n8n. Is it running?"
            };
        }
        return {
            success: false,
            error: err.message
        };
    }
}

module.exports = {
    n8nListWorkflows,
    n8nTriggerWorkflow
};
