/**
 * Diagnostic Watcher — polls for pipeline_trace requests from MCP.
 * Injects messages into the live pipeline and collects trace data.
 */

const fs = require('fs');
const path = require('path');
const collector = require('./diagnostic-collector');

let watcher = null;
let dataDir = null;

function start(dir) {
    if (watcher) return;

    const { getDataDir } = require('./platform-paths');
    dataDir = dir || getDataDir();

    watcher = setInterval(async () => {
        try {
            const requestPath = path.join(dataDir, 'diagnostic_request.json');
            if (!fs.existsSync(requestPath)) return;

            const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));

            // Stale check (10s)
            if (Date.now() - new Date(request.timestamp).getTime() > 10000) {
                fs.unlinkSync(requestPath);
                return;
            }

            // Remove request immediately
            fs.unlinkSync(requestPath);

            const traceId = request.trace_id;
            const message = request.message;
            const timeout = (request.timeout_seconds || 30) * 1000;

            console.log(`[Diagnostic] Starting trace: ${traceId} — "${message}"`);

            // Start trace
            collector.startTrace(traceId, message);

            // Inject message into inbox (format: { messages: [...] })
            const inboxPath = path.join(dataDir, 'inbox.json');
            let data = { messages: [] };
            try {
                const raw = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
                if (raw && Array.isArray(raw.messages)) {
                    data = raw;
                } else if (Array.isArray(raw)) {
                    data = { messages: raw };
                }
            } catch { data = { messages: [] }; }

            const msgId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const msg = {
                id: msgId,
                from: 'nathan',
                message: message,
                timestamp: new Date().toISOString(),
                read_by: [],
                thread_id: 'voice-mirror'
            };

            data.messages.push(msg);
            if (data.messages.length > 100) data.messages = data.messages.slice(-100);
            fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2), 'utf-8');

            collector.addStage(traceId, 'inbox_write', {
                message_id: msgId,
                message
            });

            // Wait for trace completion (poll for inbox_response stage or timeout)
            const startTime = Date.now();
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    const trace = collector.getTrace(traceId);
                    const hasResponse = trace?.stages.some(s => s.stage === 'inbox_response');
                    const timedOut = Date.now() - startTime > timeout;

                    if (hasResponse || timedOut) {
                        clearInterval(check);
                        if (timedOut && !hasResponse) {
                            collector.addStage(traceId, 'timeout', {
                                waited_ms: Date.now() - startTime,
                                stages_captured: trace?.stages.length || 0
                            });
                        }
                        resolve();
                    }
                }, 500);
            });

            // Finalize and write trace
            const trace = collector.endTrace(traceId);
            if (trace) {
                const tracePath = path.join(dataDir, `diagnostic_trace_${traceId}.json`);
                fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
                console.log(`[Diagnostic] Trace complete: ${trace.stages.length} stages, ${trace.duration_ms}ms`);
            }

            collector.clearTrace(traceId);

        } catch (err) {
            console.error('[Diagnostic] Error:', err.message);
        }
    }, 1000);

    console.log('[Diagnostic] Watcher started');
}

function stop() {
    if (watcher) {
        clearInterval(watcher);
        watcher = null;
    }
}

module.exports = { start, stop };
