/**
 * Screen capture tool handler.
 *
 * Takes a screenshot via Electron's desktopCapturer.
 * Returns the image path for vision analysis.
 */

const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createLogger } = require('../../services/logger');
const logger = createLogger();

/**
 * Capture the screen and save to a file.
 *
 * @param {Object} args - Tool arguments
 * @param {number} args.display - Display index (default: 0)
 * @returns {Promise<Object>} Result with image_path or error
 */
async function captureScreen(args = {}) {
    try {
        const displayIndex = args.display || 0;

        // Get available sources
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources.length === 0) {
            return {
                success: false,
                error: 'No displays available for capture'
            };
        }

        const source = sources[displayIndex] || sources[0];
        const dataUrl = source.thumbnail.toDataURL();

        // Save image to file
        const config = require('../../config');
        const dataDir = config.getDataDir();
        const imagesDir = path.join(dataDir, 'images');

        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const imagePath = path.join(imagesDir, `capture-${Date.now()}.png`);
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(imagePath, imageBuffer);

        return {
            success: true,
            result: `Screenshot captured and saved. The image shows your current screen.`,
            image_path: imagePath,
            data_url: dataUrl  // Include for vision models
        };

    } catch (err) {
        logger.error('[CaptureScreen]', 'Error:', err);
        return {
            success: false,
            error: `Failed to capture screen: ${err.message}`
        };
    }
}

module.exports = { captureScreen };
