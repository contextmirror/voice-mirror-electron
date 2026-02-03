/**
 * Tool handlers index.
 *
 * Exports all tool handlers for the ToolExecutor.
 */

const { captureScreen } = require('./capture-screen');
const { memorySearch, memoryRemember, memoryForget, memoryClear } = require('./memory');
const { n8nListWorkflows, n8nTriggerWorkflow } = require('./n8n');
const { browserControl } = require('./browser-control');

module.exports = {
    captureScreen,
    memorySearch,
    memoryRemember,
    memoryForget,
    memoryClear,
    n8nListWorkflows,
    n8nTriggerWorkflow,
    browserControl
};
