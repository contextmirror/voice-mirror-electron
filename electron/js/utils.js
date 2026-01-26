/**
 * utils.js - Shared utility functions
 */

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format time as HH:MM
 */
export function formatTime(date = new Date()) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format file size in human readable format
 */
export function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Convert blob to base64 data URL
 */
export function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

/**
 * Format keybind for display
 */
export function formatKeybind(keybind) {
    // Mouse button display names
    if (keybind === 'MouseButton4') return 'Mouse Back';
    if (keybind === 'MouseButton5') return 'Mouse Forward';
    if (keybind === 'MouseButton3') return 'Mouse Middle';

    return keybind
        .replace('CommandOrControl', 'Ctrl')
        .replace('Control', 'Ctrl')
        .replace('+', ' + ');
}
