/**
 * Windows screen capture using PowerShell + .NET GDI+.
 * Bypasses Electron's desktopCapturer bug where multi-monitor returns same image.
 */

const { execFile } = require('child_process');
const { createLogger } = require('../services/logger');
const logger = createLogger();

/**
 * Capture a specific display on Windows using PowerShell + .NET GDI+.
 * @param {number} displayIndex - Display index to capture
 * @param {string} outputPath - Path to save the PNG screenshot
 * @returns {Promise<boolean>} True if capture succeeded
 */
function captureDisplayWindows(displayIndex, outputPath) {
    if (process.platform !== 'win32') return Promise.resolve(false);

    return new Promise((resolve) => {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$idx = ${displayIndex}
if ($idx -ge $screens.Length) { $idx = 0 }
$s = $screens[$idx]
$bmp = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Bounds.Location, [System.Drawing.Point]::Empty, $s.Bounds.Size)
$bmp.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "$($s.Bounds.Width)x$($s.Bounds.Height)"
`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            timeout: 8000,
            windowsHide: true
        }, (err, stdout) => {
            if (err) {
                logger.error('[WindowsCapture]', 'Native capture failed:', err.message);
                resolve(false);
            } else {
                if (stdout) {
                    logger.info('[WindowsCapture]', `Capture succeeded: display ${displayIndex}, ${stdout.trim()}`);
                }
                resolve(true);
            }
        });
    });
}

module.exports = { captureDisplayWindows };
