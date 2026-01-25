#!/usr/bin/env node
/**
 * Voice Mirror - Download Embedding Model
 * Downloads the local embedding model (embeddinggemma-300M)
 *
 * Usage:
 *   npm run download-model
 *   npx voice-mirror-download-model
 */

const LocalProvider = require('../lib/memory/embeddings/local');

async function main() {
    console.log('Voice Mirror - Embedding Model Downloader\n');

    const modelPath = LocalProvider.getModelPath();

    if (LocalProvider.isAvailable()) {
        console.log(`✓ Model already exists at: ${modelPath}`);
        return;
    }

    console.log(`Downloading embeddinggemma-300M to: ${modelPath}`);
    console.log('This is a one-time download (~300MB)...\n');

    let lastProgress = 0;
    try {
        await LocalProvider.downloadModel((progress) => {
            // Show progress bar
            if (progress - lastProgress >= 5 || progress === 100) {
                const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
                process.stdout.write(`\r[${bar}] ${progress}%`);
                lastProgress = progress;
            }
        });

        console.log('\n\n✓ Download complete!');
        console.log(`Model saved to: ${modelPath}`);
        console.log('\nVoice Mirror memory system is now ready for offline use.');
    } catch (err) {
        console.error(`\n\n✗ Download failed: ${err.message}`);
        console.error('\nTry downloading manually:');
        console.error('  curl -L https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf -o ~/.cache/voice-mirror/models/embeddinggemma-300M-Q8_0.gguf');
        process.exit(1);
    }
}

main();
