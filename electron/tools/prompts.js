/**
 * System prompt builder for local LLM tool support.
 *
 * Generates system prompts that teach local models how to use tools
 * via JSON output format.
 */

const { getAllTools } = require('./definitions');

/**
 * Build tool documentation for the system prompt
 */
function buildToolDocs() {
    const tools = getAllTools();
    let docs = '';

    for (const tool of tools) {
        docs += `- ${tool.name}: ${tool.description}\n`;

        // Add argument descriptions
        const argEntries = Object.entries(tool.args);
        if (argEntries.length > 0) {
            for (const [argName, argDef] of argEntries) {
                const required = argDef.required ? '(required)' : '(optional)';
                docs += `  - ${argName}: ${argDef.description} ${required}\n`;
            }
        }
    }

    return docs;
}

/**
 * Get tool examples for the system prompt
 */
function getToolExamples() {
    const tools = getAllTools();
    return tools.map(t => t.example).join('\n');
}

/**
 * Build the full system prompt for local LLMs with tool support
 *
 * @param {Object} options - Prompt options
 * @param {string} options.location - User's location for context
 * @param {string} options.customInstructions - Additional instructions
 * @returns {string} The system prompt
 */
function getToolSystemPrompt(options = {}) {
    const { location, customInstructions } = options;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const toolDocs = buildToolDocs();

    let prompt = `You are a helpful voice assistant with tool capabilities.

CONTEXT:
- Date: ${dateStr}
- Time: ${timeStr}${location ? `\n- Location: ${location}` : ''}

## TOOLS

You have access to tools. To use a tool, respond with ONLY a JSON object on a single line:
{"tool": "tool_name", "args": {"param": "value"}}

Available tools:
${toolDocs}
## RULES

1. Use tools when you need current info, screen content, or to store memories - don't say you can't access things
2. For conversational responses, reply naturally WITHOUT any JSON
3. Keep responses concise (1-3 sentences) - they will be spoken aloud
4. No markdown, bullet points, or code blocks in normal responses - plain speech only
5. When you use a tool, wait for the result before responding
6. After receiving a tool result, respond naturally incorporating that information
7. NEVER quote or echo back the user's message - just respond directly

## CRITICAL RULES

1. NEVER say "I don't have access to real-time information" - USE web_search instead
2. NEVER say "I can't look that up" - USE web_search instead
3. NEVER apologize for lacking current knowledge - USE tools instead
4. ALWAYS use web_search for: news, sports, weather, prices, schedules, game updates, releases, traffic
5. ALWAYS use web_search when uncertain - searching is BETTER than guessing
6. Tool calls: Output ONLY the JSON, nothing else
7. Conversations: Keep responses under 2 sentences (will be spoken aloud)
8. No markdown, no bullet points, no URLs in spoken responses

## CONVERSATION CONTEXT

You have memory of recent exchanges. Use pronouns and context naturally:
- "What about tomorrow?" → Use context from previous query
- "And that other thing?" → Use context from previous topic`;

    if (customInstructions) {
        prompt += `\n\n## ADDITIONAL INSTRUCTIONS\n\n${customInstructions}`;
    }

    return prompt;
}

/**
 * Get a minimal system prompt without tool support (for models that struggle)
 */
function getBasicSystemPrompt(options = {}) {
    const { location, customInstructions } = options;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let prompt = `You are a helpful voice assistant. Today is ${dateStr}.${location ? ` The user is in ${location}.` : ''}

Keep responses concise (1-3 sentences) as they will be spoken aloud. No markdown or bullet points - plain speech only.`;

    if (customInstructions) {
        prompt += `\n\n${customInstructions}`;
    }

    return prompt;
}

module.exports = {
    getToolSystemPrompt,
    getBasicSystemPrompt,
    buildToolDocs
};
