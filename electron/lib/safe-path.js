/**
 * Path validation utility for Voice Mirror Electron.
 * Prevents path traversal attacks via ../ sequences.
 */

const path = require('path');

/**
 * Ensure a resolved path stays within the expected base directory.
 * Prevents path traversal attacks via ../ sequences.
 * @param {string} base - The allowed base directory
 * @param {string} userPath - The user-provided path or filename
 * @returns {string} The resolved safe path
 * @throws {Error} If the path escapes the base directory
 */
function ensureWithin(base, userPath) {
    const resolved = path.resolve(base, userPath);
    if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
        throw new Error(`Path traversal detected: ${userPath} escapes ${base}`);
    }
    return resolved;
}

module.exports = { ensureWithin };
