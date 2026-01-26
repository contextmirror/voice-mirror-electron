/**
 * messages.js - Chat message handling
 *
 * Model-agnostic chat UI that displays messages from any AI provider.
 */

import { state, recentMessages, DEDUP_WINDOW_MS } from './state.js';
import { renderMarkdown } from './markdown.js';
import { formatTime } from './utils.js';

/**
 * Strip provider prefix from message text.
 * Handles patterns like "Claude: ", "Ollama: ", "Claude (model): ", etc.
 */
function stripProviderPrefix(text) {
    if (!text) return text;
    // Match patterns: "Claude: ", "Ollama: ", "Claude (model-name): ", "Grok (xAI): ", etc.
    return text.replace(/^(?:Claude|Ollama|OpenAI|Gemini|Grok|Groq|Mistral|DeepSeek|LM Studio|Jan)(?:\s*\([^)]+\))?:\s*/i, '').trim();
}

/**
 * Check if message is a duplicate (within dedup window)
 */
export function isDuplicate(text) {
    if (!text) return false;

    // Normalize text (remove any provider prefix for comparison)
    const normalized = stripProviderPrefix(text).toLowerCase();
    const now = Date.now();

    // Clean old entries
    for (const [key, time] of recentMessages) {
        if (now - time > DEDUP_WINDOW_MS) {
            recentMessages.delete(key);
        }
    }

    // Check if we've seen this recently
    if (recentMessages.has(normalized)) {
        console.log('[Chat] Duplicate message suppressed:', text.slice(0, 50));
        return true;
    }

    recentMessages.set(normalized, now);
    return false;
}

/**
 * Add message with grouped structure (Slack-style)
 */
export function addMessage(role, text, imageBase64 = null) {
    const chatContainer = document.getElementById('chat-container');

    const group = document.createElement('div');
    group.className = `message-group ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';
    // Use dynamic provider name from state for assistant messages
    const senderName = role === 'user' ? 'You' : state.currentProviderName;
    header.innerHTML = `
        <span class="message-sender">${senderName}</span>
        <span class="message-time">${formatTime()}</span>
    `;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (imageBase64) {
        const img = document.createElement('img');
        img.className = 'message-image';
        img.src = imageBase64;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        img.style.marginBottom = text ? '8px' : '0';
        bubble.appendChild(img);
    }

    if (text) {
        const textNode = document.createElement('div');
        // Use markdown rendering for assistant messages, plain text for user
        if (role === 'assistant') {
            // Strip provider prefix (e.g., "Claude: ") since sender is shown in header
            const cleanText = stripProviderPrefix(text);
            textNode.className = 'markdown-content';
            textNode.innerHTML = renderMarkdown(cleanText);
        } else {
            textNode.textContent = text;
        }
        bubble.appendChild(textNode);
    }

    // Add copy button for assistant messages
    if (role === 'assistant' && text) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'message-copy-btn';
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.onclick = function() { copyMessage(this); };
        bubble.appendChild(copyBtn);
    }

    content.appendChild(header);
    content.appendChild(bubble);

    group.appendChild(avatar);
    group.appendChild(content);

    chatContainer.appendChild(group);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Copy message text to clipboard
 */
export function copyMessage(btn) {
    const bubble = btn.parentElement;
    const textEl = bubble.querySelector('div');
    if (!textEl) return;

    navigator.clipboard.writeText(textEl.textContent).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        `;
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            `;
        }, 2000);
    });
}
