/**
 * Tool handlers index.
 *
 * Exports all tool handlers for the ToolExecutor.
 */

const { captureScreen } = require('./capture-screen');
const { webSearch } = require('./web-search');
const { memorySearch, memoryRemember } = require('./memory');
const { n8nListWorkflows, n8nTriggerWorkflow } = require('./n8n');

module.exports = {
    captureScreen,
    webSearch,
    memorySearch,
    memoryRemember,
    n8nListWorkflows,
    n8nTriggerWorkflow
};
