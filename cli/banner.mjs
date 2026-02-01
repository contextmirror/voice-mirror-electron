/**
 * Voice Mirror CLI — Banner and branding
 */

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
        return pkg.version || '0.1.0';
    } catch {
        return '0.1.0';
    }
}

const ORB_ART = [
    '         ╭──────────╮         ',
    '       ╭─┤  ◉ ◉ ◉   ├─╮       ',
    '      ╭┤  ╰──────────╯  ├╮      ',
    '     ╭┤    Voice Mirror    ├╮     ',
    '      ╰┤                  ├╯      ',
    '       ╰─┤              ├─╯       ',
    '         ╰──────────────╯         ',
];

export function formatBannerArt() {
    const rich = process.stdout.isTTY;
    if (!rich) {
        return ORB_ART.join('\n');
    }

    return ORB_ART.map(line => {
        return line
            .replace(/◉/g, chalk.magenta('◉'))
            .replace(/Voice Mirror/g, chalk.bold.magenta('Voice Mirror'))
            .replace(/[╭╮╰╯│├┤─]/g, m => chalk.dim(m));
    }).join('\n');
}

export function formatBannerLine() {
    const version = getVersion();
    const rich = process.stdout.isTTY;
    const title = '◉ Voice Mirror';
    const tagline = 'Voice-controlled AI agent overlay for your entire computer.';

    if (rich) {
        return `${chalk.bold.magenta(title)} ${chalk.dim(`v${version}`)} ${chalk.dim('—')} ${chalk.cyan(tagline)}`;
    }
    return `${title} v${version} — ${tagline}`;
}

export function emitBanner() {
    if (!process.stdout.isTTY) return;
    console.log();
    console.log(formatBannerArt());
    console.log();
    console.log(formatBannerLine());
    console.log();
}
