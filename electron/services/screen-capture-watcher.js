/**
 * Screen capture watcher service for Voice Mirror Electron.
 * Watches for screen capture requests from Claude via MCP and fulfills them.
 */

const fs = require('fs');
const path = require('path');

/**
 * Create a screen capture watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {Function} options.captureScreen - Function to capture screen (from desktopCapturer)
 * @returns {Object} Screen capture watcher service instance
 */
function createScreenCaptureWatcher(options = {}) {
    const { dataDir, captureScreen } = options;

    let watcher = null;

    /**
     * Start watching for screen capture requests.
     */
    function start() {
        if (watcher) {
            console.log('[ScreenCapture] Watcher already running');
            return;
        }

        const contextMirrorDir = dataDir || path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'voice-mirror-electron', 'data');
        const requestPath = path.join(contextMirrorDir, 'screen_capture_request.json');
        const responsePath = path.join(contextMirrorDir, 'screen_capture_response.json');
        const imagesDir = path.join(contextMirrorDir, 'images');

        // Ensure directories exist
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        // Watch for capture requests
        watcher = setInterval(async () => {
            try {
                if (!fs.existsSync(requestPath)) return;

                const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
                const requestTime = new Date(request.timestamp).getTime();
                const now = Date.now();

                // Only process requests from the last 5 seconds
                if (now - requestTime > 5000) {
                    fs.unlinkSync(requestPath);
                    return;
                }

                // Delete request immediately to prevent multiple captures
                fs.unlinkSync(requestPath);

                console.log('[ScreenCapture] Capture requested by Claude');

                // Capture the screen
                if (!captureScreen) {
                    console.error('[ScreenCapture] No capture function provided');
                    fs.writeFileSync(responsePath, JSON.stringify({
                        success: false,
                        error: 'Screen capture not available',
                        timestamp: new Date().toISOString()
                    }, null, 2));
                    return;
                }

                const sources = await captureScreen({
                    types: ['screen'],
                    thumbnailSize: { width: 1920, height: 1080 }
                });

                if (sources.length > 0) {
                    const displayIndex = request.display || 0;
                    const source = sources[displayIndex] || sources[0];
                    const dataUrl = source.thumbnail.toDataURL();

                    // Save image to file
                    const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
                    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                    const imageBuffer = Buffer.from(base64Data, 'base64');
                    fs.writeFileSync(imagePath, imageBuffer);

                    // Write response
                    fs.writeFileSync(responsePath, JSON.stringify({
                        success: true,
                        image_path: imagePath,
                        timestamp: new Date().toISOString(),
                        width: 1920,
                        height: 1080
                    }, null, 2));

                    console.log('[ScreenCapture] Screenshot saved:', imagePath);

                    // Also add to inbox so Claude can reference it
                    const inboxPath = path.join(contextMirrorDir, 'inbox.json');
                    let data = { messages: [] };
                    if (fs.existsSync(inboxPath)) {
                        try {
                            data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
                        } catch {}
                    }

                    data.messages.push({
                        id: `capture-${Date.now()}`,
                        from: 'system',
                        message: `Screenshot captured and saved to: ${imagePath}`,
                        timestamp: new Date().toISOString(),
                        read_by: [],
                        image_path: imagePath
                    });

                    fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2));
                } else {
                    fs.writeFileSync(responsePath, JSON.stringify({
                        success: false,
                        error: 'No displays available',
                        timestamp: new Date().toISOString()
                    }, null, 2));
                }

            } catch (err) {
                console.error('[ScreenCapture] Error:', err);
            }
        }, 500);  // Check every 500ms

        console.log('[ScreenCapture] Watcher started');
    }

    /**
     * Stop watching for screen capture requests.
     */
    function stop() {
        if (watcher) {
            clearInterval(watcher);
            watcher = null;
            console.log('[ScreenCapture] Watcher stopped');
        }
    }

    /**
     * Check if watcher is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return watcher !== null;
    }

    return {
        start,
        stop,
        isRunning
    };
}

module.exports = {
    createScreenCaptureWatcher
};
