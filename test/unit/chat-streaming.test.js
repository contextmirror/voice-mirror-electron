const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Source-inspection tests for streaming chat features (ES modules can't be imported in Node.js tests)

describe('Chat streaming - messages.js exports', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/messages.js'), 'utf-8');

    it('exports startStreamingMessage function', () => {
        assert.ok(src.includes('export function startStreamingMessage'));
    });

    it('exports appendStreamingToken function', () => {
        assert.ok(src.includes('export function appendStreamingToken'));
    });

    it('exports finalizeStreamingMessage function', () => {
        assert.ok(src.includes('export function finalizeStreamingMessage'));
    });

    it('startStreamingMessage creates streaming class on message group', () => {
        assert.ok(src.includes("'message-group assistant streaming'"));
    });

    it('appendStreamingToken uses textContent (no innerHTML during streaming)', () => {
        // Verify the append function uses textContent, not innerHTML
        const appendFn = src.slice(src.indexOf('export function appendStreamingToken'));
        const fnEnd = appendFn.indexOf('export function', 10);
        const fnBody = appendFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('.textContent = state.streamingText'));
    });

    it('finalizeStreamingMessage applies markdown rendering', () => {
        assert.ok(src.includes('renderMarkdown(displayText)'));
    });

    it('finalizeStreamingMessage registers in dedup map', () => {
        // Ensures the later chat-message from inbox-watcher is suppressed
        const finalizeFn = src.slice(src.indexOf('export function finalizeStreamingMessage'));
        const fnEnd = finalizeFn.indexOf('export function', 10);
        const fnBody = finalizeFn.slice(0, fnEnd > 0 ? fnEnd : undefined);
        assert.ok(fnBody.includes('isDuplicate(fullText)'));
    });

    it('uses instant scroll during streaming (no smooth animation)', () => {
        assert.ok(src.includes("behavior: 'instant'"));
    });

    it('creates streaming cursor element', () => {
        assert.ok(src.includes('streaming-cursor'));
    });

    it('removes cursor on finalize', () => {
        assert.ok(src.includes(".querySelector('.streaming-cursor')"));
    });
});

describe('Chat streaming - state.js fields', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/state.js'), 'utf-8');

    it('has streamingActive field', () => {
        assert.ok(src.includes('streamingActive'));
    });

    it('has streamingMessageGroup field', () => {
        assert.ok(src.includes('streamingMessageGroup'));
    });

    it('has streamingBubble field', () => {
        assert.ok(src.includes('streamingBubble'));
    });

    it('has streamingText field', () => {
        assert.ok(src.includes('streamingText'));
    });
});

describe('Chat streaming - preload.js IPC channels', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/preload.js'), 'utf-8');

    it('exposes onChatStreamToken listener', () => {
        assert.ok(src.includes('onChatStreamToken'));
    });

    it('exposes onChatStreamEnd listener', () => {
        assert.ok(src.includes('onChatStreamEnd'));
    });

    it('uses chat-stream-token IPC channel', () => {
        assert.ok(src.includes("'chat-stream-token'"));
    });

    it('uses chat-stream-end IPC channel', () => {
        assert.ok(src.includes("'chat-stream-end'"));
    });
});

describe('Chat streaming - openai-provider.js events', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/providers/openai-provider.js'), 'utf-8');

    it('emits stream-token events during streaming', () => {
        assert.ok(src.includes("this.emitOutput('stream-token', content)"));
    });

    it('emits stream-end event at response completion', () => {
        assert.ok(src.includes("this.emitOutput('stream-end', fullResponse)"));
    });
});

describe('Chat streaming - main.js IPC routing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf-8');

    it('routes stream-token to chat-stream-token IPC channel', () => {
        assert.ok(src.includes("safeSend('chat-stream-token'"));
    });

    it('routes stream-end to chat-stream-end IPC channel', () => {
        assert.ok(src.includes("safeSend('chat-stream-end'"));
    });
});

describe('Chat streaming - renderer main.js wiring', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/main.js'), 'utf-8');

    it('imports streaming functions from messages.js', () => {
        assert.ok(src.includes('startStreamingMessage'));
        assert.ok(src.includes('appendStreamingToken'));
        assert.ok(src.includes('finalizeStreamingMessage'));
    });

    it('has stream token batching with STREAM_BATCH_MS', () => {
        assert.ok(src.includes('STREAM_BATCH_MS'));
    });

    it('listens for onChatStreamToken events', () => {
        assert.ok(src.includes('onChatStreamToken'));
    });

    it('listens for onChatStreamEnd events', () => {
        assert.ok(src.includes('onChatStreamEnd'));
    });
});

describe('Chat streaming - CSS styles', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron/renderer/styles/chat.css'), 'utf-8');

    it('has streaming-cursor class with blink animation', () => {
        assert.ok(src.includes('.streaming-cursor'));
        assert.ok(src.includes('blink-cursor'));
    });

    it('has streaming-text class with pre-wrap', () => {
        assert.ok(src.includes('.streaming-text'));
        assert.ok(src.includes('pre-wrap'));
    });
});
