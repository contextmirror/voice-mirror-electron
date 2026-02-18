/**
 * TUI Renderer - Terminal dashboard for Voice Mirror
 *
 * Renders a rich dashboard layout via ANSI escape sequences for use when
 * local models (Ollama, LM Studio, etc.) are the active provider.
 * All output goes through an emitFn callback — never to stdout directly.
 */

// ── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_SCREEN = `${ESC}2J${ESC}H`;
const CLEAR_EOL = `${ESC}K`;

const moveTo = (row, col) => `${ESC}${row};${col}H`;

// Default theme colours (dark background — standard ANSI codes)
const DEFAULT_THEME = {
    border:    `${ESC}38;5;69m`,
    user:      `${ESC}1;37m`,
    assistant: `${ESC}97m`,
    dim:       `${ESC}90m`,
    toolRun:   `${ESC}33m`,
    toolOk:    `${ESC}32m`,
    toolFail:  `${ESC}31m`,
    status:    `${ESC}90m`,
    accent:    `${ESC}38;5;69m`,
    green:     `${ESC}32m`,
};

// Module-level alias (used by class instances via this._theme)
let THEME = DEFAULT_THEME;

/** Convert hex #rrggbb to {r,g,b} */
function hexToRgbTui(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** Build ANSI 24-bit foreground code from hex */
function fgHex(hex) {
    const c = hexToRgbTui(hex);
    return c ? `${ESC}38;2;${c.r};${c.g};${c.b}m` : '';
}

/** Build ANSI 24-bit background code from hex */
function bgHex(hex) {
    const c = hexToRgbTui(hex);
    return c ? `${ESC}48;2;${c.r};${c.g};${c.b}m` : '';
}

// Spinner frames for running tools
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Box-drawing characters
const BOX = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│',
    itl: '┌', itr: '┐', ibl: '┘', ibr: '└', ih: '─', iv: '│',
    cross_l: '├', cross_r: '┤', cross_t: '┬', cross_b: '┴',
    bar_l: '├', bar_r: '┤',
};

// ── Utility ─────────────────────────────────────────────────────────────────

/**
 * Word-wrap text to fit within a given width.
 * Preserves existing line breaks.
 */
function wrapText(text, width) {
    if (width <= 0) return [''];
    const lines = [];
    for (const rawLine of text.split('\n')) {
        if (rawLine.length === 0) {
            lines.push('');
            continue;
        }
        let remaining = rawLine;
        while (remaining.length > width) {
            let breakAt = remaining.lastIndexOf(' ', width);
            if (breakAt <= 0) breakAt = width; // force break if no space
            lines.push(remaining.slice(0, breakAt));
            remaining = remaining.slice(breakAt).replace(/^ /, '');
        }
        lines.push(remaining);
    }
    return lines;
}

/**
 * Pad or truncate a string to exactly `width` visible characters.
 * ANSI escape sequences are not counted towards visible width.
 */
function padRight(str, width) {
    // Strip ANSI for length calculation
    const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
    if (visible.length >= width) {
        // Truncate — but we need to keep ANSI codes intact up to the limit
        let count = 0;
        let i = 0;
        while (i < str.length && count < width) {
            if (str[i] === '\x1b') {
                const end = str.indexOf('m', i);
                if (end !== -1) { i = end + 1; continue; }
            }
            count++;
            i++;
        }
        return str.slice(0, i) + RESET;
    }
    return str + ' '.repeat(width - visible.length);
}

/** Format a Date or timestamp into HH:MM AM/PM */
function formatTime(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
}

/** Truncate string to maxLen, adding ellipsis if needed */
function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
}

// ── TUIRenderer class ───────────────────────────────────────────────────────

class TUIRenderer {
    constructor(emitFn, options = {}) {
        this.emit = emitFn;
        this.cols = Math.max(options.cols || 80, 40);
        this.rows = Math.max(options.rows || 24, 15);
        this.model = options.model || 'unknown';
        this.providerName = options.providerName || 'Local';
        this.contextLength = options.contextLength || 32768;

        // State
        this.messages = [];
        this.toolCalls = [];
        this.info = {
            model: this.model,
            speed: '—',
            toolCount: '0',
            voiceStatus: '',
        };
        this.context = { used: 0, limit: this.contextLength };
        this.ttsEngine = '';
        this.sttEngine = '';
        this.scrollOffset = 0;
        this.streaming = false;
        this.streamBuffer = '';

        // Stream cursor tracking (terminal row/col for incremental writes)
        this._streamRow = 0;
        this._streamCol = 0;
        this._streamWrappedLines = 0;

        // Spinner state
        this._spinnerIdx = 0;
        this._spinnerTimer = null;

        // First render flag
        this._firstRender = true;

        // Destroyed flag — prevents use after destroy()
        this._destroyed = false;

        // Theme: ANSI escape code overrides for colors
        // _bgCode: explicit ANSI 24-bit background (empty string = use terminal default)
        // _resetBg: RESET + background restore (used wherever RESET + CLEAR_EOL appears)
        this._theme = { ...DEFAULT_THEME };
        this._bgCode = '';
        this._fgCode = '';
        this._resetBg = RESET;     // \x1b[0m (+ optional bg code)
        this._clearEol = CLEAR_EOL; // \x1b[K (optionally preceded by bg)
        this._clearScreen = CLEAR_SCREEN;

        // Layout cache (computed on render / resize)
        this._layout = null;

        // Cached non-stream chat lines (invalidated on appendMessage/resize)
        this._cachedChatLinesNoStream = null;
        this._cachedChatLinesWidth = 0;
        this._cachedMessageCount = 0;
    }

    // ── Theme colors ─────────────────────────────────────────────────

    /**
     * Update TUI colors from the app theme.
     * @param {{ bg: string, text: string, accent: string, muted: string, ok: string, warn: string, danger: string, textStrong: string }} colors - hex color values
     */
    setThemeColors(colors) {
        if (!colors || !colors.bg) return;

        this._bgCode = bgHex(colors.bg);
        this._fgCode = fgHex(colors.text);

        // RESET clears all attributes, then we re-apply bg + fg so CLEAR_EOL uses the right background
        this._resetBg = `${RESET}${this._bgCode}${this._fgCode}`;
        this._clearEol = `${this._bgCode}${CLEAR_EOL}`;
        this._clearScreen = `${this._bgCode}${CLEAR_SCREEN}`;

        // Rebuild theme using 24-bit foreground colors for crisp rendering
        this._theme = {
            border:    fgHex(colors.accent),
            user:      `${ESC}1m${fgHex(colors.textStrong)}`, // bold + strong text
            assistant: fgHex(colors.text),
            dim:       fgHex(colors.muted),
            toolRun:   fgHex(colors.warn),
            toolOk:    fgHex(colors.ok),
            toolFail:  fgHex(colors.danger),
            status:    fgHex(colors.muted),
            accent:    fgHex(colors.accent),
            green:     fgHex(colors.ok),
        };

        // Force full repaint
        this._firstRender = true;
        this._cachedChatLinesNoStream = null;
        this.render();
    }

    // ── Layout calculation ──────────────────────────────────────────────

    _computeLayout() {
        const cols = this.cols;
        const rows = this.rows;

        // Outer box uses cols 1..cols (1-indexed terminal positions)
        // Inner content area: cols 2..(cols-1), rows 2..(rows-3)
        const innerWidth = cols - 2;       // inside outer borders
        const contentRows = rows - 4;      // header(1) + status separator(1) + status(1) + bottom border(1)

        // Left/right panel widths (inside outer border, with 1-col gap between)
        const leftWidth = Math.floor(innerWidth * 0.65);
        const rightWidth = innerWidth - leftWidth - 1; // 1 for gap

        // Panel inner widths (inside their own ┌─┐ borders)
        const leftInner = leftWidth - 2;
        const rightInner = rightWidth - 2;

        // Info panel: fixed 8 rows at bottom of right panel
        const infoPanelRows = 8;
        const toolPanelRows = Math.max(contentRows - infoPanelRows - 1, 2); // -1 for info separator

        // Terminal positions (1-indexed)
        const headerRow = 1;
        const contentStartRow = 2;
        const contentEndRow = rows - 3;  // last row of inner content
        const statusSepRow = rows - 2;
        const statusRow = rows - 1;
        const bottomRow = rows;

        // Column positions
        const outerLeft = 1;
        const outerRight = cols;
        const leftPanelLeft = 2;                         // inside outer │
        const leftPanelRight = leftPanelLeft + leftWidth - 1;
        const rightPanelLeft = leftPanelRight + 2;       // 1-col gap
        const rightPanelRight = rightPanelLeft + rightWidth - 1;

        // Tool panel vertical range (inside right panel)
        const toolStartRow = contentStartRow;
        const toolEndRow = contentStartRow + toolPanelRows + 1; // +1 for bottom border / info sep
        const infoStartRow = toolEndRow;
        const infoEndRow = contentEndRow;

        return {
            cols, rows, innerWidth, contentRows,
            leftWidth, rightWidth, leftInner, rightInner,
            infoPanelRows, toolPanelRows,
            headerRow, contentStartRow, contentEndRow,
            statusSepRow, statusRow, bottomRow,
            outerLeft, outerRight,
            leftPanelLeft, leftPanelRight,
            rightPanelLeft, rightPanelRight,
            toolStartRow, toolEndRow, infoStartRow, infoEndRow,
        };
    }

    // ── Drawing primitives ──────────────────────────────────────────────

    _hLine(char, width) {
        return char.repeat(width);
    }

    /**
     * Draw a horizontal line with an embedded title.
     * e.g.  ─ Conversation ─────────────
     */
    _titledLine(title, width, lineChar = BOX.ih) {
        if (!title) return this._hLine(lineChar, width);
        const label = ` ${title} `;
        const remaining = width - label.length;
        if (remaining < 2) return this._hLine(lineChar, width);
        return lineChar + label + this._hLine(lineChar, remaining - 1);
    }

    // ── Full render ─────────────────────────────────────────────────────

    render() {
        if (this._destroyed) {
            if (this._spinnerTimer) { clearInterval(this._spinnerTimer); this._spinnerTimer = null; }
            return;
        }
        const L = this._computeLayout();
        this._layout = L;
        const buf = [];

        if (this._firstRender) {
            buf.push(this._clearScreen);
            this._firstRender = false;
        }

        buf.push(HIDE_CURSOR);

        // ── Header row ──────────────────────────────────────────────────
        buf.push(this._renderHeader(L));

        // ── Left panel top border ───────────────────────────────────────
        buf.push(moveTo(L.contentStartRow, L.leftPanelLeft));
        buf.push(this._theme.border);
        buf.push(BOX.itl + this._titledLine('Conversation', L.leftWidth - 2) + BOX.itr);

        // ── Right panel top border ──────────────────────────────────────
        buf.push(moveTo(L.contentStartRow, L.rightPanelLeft));
        buf.push(this._theme.border);
        buf.push(BOX.itl + this._titledLine('Tool Calls', L.rightWidth - 2) + BOX.itr);

        // ── Content rows ────────────────────────────────────────────────
        // Prepare chat lines
        const chatLines = this._buildChatLines(L.leftInner);
        const visibleChatRows = L.contentEndRow - L.contentStartRow - 1; // between top/bottom borders
        const totalChatLines = chatLines.length;
        const maxScroll = Math.max(0, totalChatLines - visibleChatRows);
        this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
        const startLine = Math.max(0, totalChatLines - visibleChatRows - this.scrollOffset);

        // Prepare tool + info lines
        const toolLines = this._buildToolLines(L.rightInner);
        const infoLines = this._buildInfoLines(L.rightInner);

        // Rows inside the panels (between top border and bottom border)
        for (let i = 0; i < L.contentRows - 2; i++) {
            const row = L.contentStartRow + 1 + i;

            // Left panel content
            buf.push(moveTo(row, L.outerLeft));
            buf.push(this._theme.border + BOX.v + this._resetBg); // outer left border
            buf.push(this._theme.border + BOX.iv + this._resetBg); // left panel left border

            const chatIdx = startLine + i;
            const chatContent = chatIdx < chatLines.length ? chatLines[chatIdx] : '';
            buf.push(padRight(chatContent, L.leftInner));

            buf.push(this._theme.border + BOX.iv + this._resetBg); // left panel right border

            // Gap
            buf.push(' ');

            // Right panel content
            buf.push(this._theme.border + BOX.iv + this._resetBg); // right panel left border

            // Determine if this row is in tool section or info section
            const rightContentIdx = i;
            const toolContentRows = L.toolPanelRows;
            const infoSepLocalIdx = toolContentRows; // row index where info separator goes
            const infoContentStart = infoSepLocalIdx + 1;

            let rightContent = '';
            if (rightContentIdx < toolContentRows) {
                rightContent = rightContentIdx < toolLines.length ? toolLines[rightContentIdx] : '';
            } else if (rightContentIdx === infoSepLocalIdx) {
                // Info separator line
                buf.push(this._theme.border);
                buf.push(BOX.bar_l + this._titledLine('Info', L.rightInner) + BOX.bar_r);
                buf.push(this._resetBg);
                buf.push(this._theme.border + BOX.v + this._resetBg); // outer right border
                buf.push(this._clearEol);
                continue;
            } else {
                const infoIdx = rightContentIdx - infoContentStart;
                rightContent = infoIdx >= 0 && infoIdx < infoLines.length ? infoLines[infoIdx] : '';
            }

            buf.push(padRight(rightContent, L.rightInner));
            buf.push(this._theme.border + BOX.iv + this._resetBg); // right panel right border
            buf.push(this._theme.border + BOX.v + this._resetBg);   // outer right border
            buf.push(this._clearEol);
        }

        // ── Left panel bottom border ────────────────────────────────────
        const bottomContentRow = L.contentEndRow;
        buf.push(moveTo(bottomContentRow, L.outerLeft));
        buf.push(this._theme.border + BOX.v + this._resetBg);
        buf.push(this._theme.border + BOX.ibr + this._hLine(BOX.ih, L.leftInner) + BOX.ibl + this._resetBg);
        buf.push(' ');
        buf.push(this._theme.border + BOX.ibr + this._hLine(BOX.ih, L.rightInner) + BOX.ibl + this._resetBg);
        buf.push(this._theme.border + BOX.v + this._resetBg);
        buf.push(this._clearEol);

        // ── Status separator ────────────────────────────────────────────
        buf.push(this._renderStatusSep(L));

        // ── Status row ──────────────────────────────────────────────────
        buf.push(this._renderStatusBar(L));

        // ── Bottom border ───────────────────────────────────────────────
        buf.push(moveTo(L.bottomRow, L.outerLeft));
        buf.push(this._theme.border);
        buf.push(BOX.bl + this._hLine(BOX.h, L.innerWidth) + BOX.br);
        buf.push(this._resetBg + this._clearEol);

        buf.push(SHOW_CURSOR);

        this.emit(buf.join(''));

        this._ensureSpinner();
    }

    // ── Header ──────────────────────────────────────────────────────────

    _renderHeader(L) {
        const title = 'Voice Mirror';
        const provider = `${this.providerName} (${truncate(this.model.split(':')[0], 20)})`;
        const status = '● Running';

        // Build header content between corners
        const inner = L.innerWidth;
        const parts = `${BOX.h} ${title} ${BOX.h}${BOX.h}${BOX.h}${BOX.h} ${provider} ${BOX.h}${BOX.h}${BOX.h}${BOX.h}${BOX.h}${BOX.h} ${this._theme.green}${status}${this._theme.border} `;
        const partsVisible = `${BOX.h} ${title} ${BOX.h}${BOX.h}${BOX.h}${BOX.h} ${provider} ${BOX.h}${BOX.h}${BOX.h}${BOX.h}${BOX.h}${BOX.h} ${status} `;
        const fill = Math.max(0, inner - partsVisible.length);

        return moveTo(L.headerRow, L.outerLeft)
            + this._theme.border
            + BOX.tl + parts + this._hLine(BOX.h, fill) + BOX.tr
            + this._resetBg + this._clearEol;
    }

    // ── Status bar ──────────────────────────────────────────────────────

    _renderStatusSep(L) {
        return moveTo(L.statusSepRow, L.outerLeft)
            + this._theme.border
            + BOX.bar_l + this._hLine(BOX.h, L.innerWidth) + BOX.bar_r
            + this._resetBg + this._clearEol;
    }

    _renderStatusBar(L) {
        const ctx = this._formatContext();
        const tts = this.ttsEngine ? `TTS: ${this.ttsEngine}` : 'TTS: —';
        const stt = this.sttEngine ? `STT: ${this.sttEngine}` : 'STT: —';
        const toolCount = this.toolCalls.length;
        const tools = `${toolCount} tool call${toolCount !== 1 ? 's' : ''}`;

        const content = ` ${ctx} │ ${tts} │ ${stt} │ ${tools}`;
        const padded = padRight(this._theme.status + content + this._resetBg, L.innerWidth);

        return moveTo(L.statusRow, L.outerLeft)
            + this._theme.border + BOX.v + this._resetBg
            + padded
            + this._theme.border + BOX.v + this._resetBg
            + this._clearEol;
    }

    _formatContext() {
        const used = this.context.used;
        const limit = this.context.limit;
        const fmt = (n) => {
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return String(n);
        };
        return `CTX: ${fmt(used)}/${fmt(limit)}`;
    }

    // ── Chat lines builder ──────────────────────────────────────────────

    _buildChatLines(width) {
        // Reuse cached non-stream lines instead of rebuilding
        const baseLines = this._buildChatLinesNoStream(width);
        const lines = baseLines.slice(); // shallow copy for appending stream

        // Streaming indicator
        if (this.streaming && this.streamBuffer) {
            const wrapped = wrapText(this.streamBuffer, width - 2);
            for (const wl of wrapped) {
                lines.push('  ' + wl);
            }
            // cursor block
            const lastLine = lines[lines.length - 1] || '';
            const lastVisible = lastLine.replace(/\x1b\[[0-9;]*m/g, '');
            if (lastVisible.length < width) {
                lines[lines.length - 1] = lastLine + '█';
            }
        } else if (this.streaming) {
            lines.push(`  ${this._theme.dim}█${this._resetBg}`);
        }

        return lines;
    }

    // ── Tool lines builder ──────────────────────────────────────────────

    _buildToolLines(width) {
        const lines = [];
        for (const tc of this.toolCalls) {
            let icon, color;
            if (tc.status === 'done') {
                icon = '✓';
                color = this._theme.toolOk;
            } else if (tc.status === 'failed') {
                icon = '✗';
                color = this._theme.toolFail;
            } else {
                icon = SPINNER[this._spinnerIdx % SPINNER.length];
                color = this._theme.toolRun;
            }

            const dur = tc.duration ? `${tc.duration}s` : '';
            const name = truncate(tc.name, width - 6 - dur.length);
            const nameLine = ` ${color}${icon}${this._resetBg} ${name}`;
            const pad = Math.max(1, width - name.length - 3 - dur.length);
            lines.push(nameLine + ' '.repeat(pad) + `${this._theme.dim}${dur}${this._resetBg}`);

            // Detail line (indented)
            if (tc.detail) {
                const detail = truncate(tc.detail, width - 4);
                lines.push(`   ${this._theme.dim}"${detail}"${this._resetBg}`);
            }

            lines.push('');
        }
        return lines;
    }

    // ── Info lines builder ──────────────────────────────────────────────

    _buildInfoLines(width) {
        const lines = [];
        const entries = [
            ['Model', this.info.model ? this.info.model.split(':')[0] : '—'],
            ['Speed', this.info.speed || '—'],
            ['Tools', this.info.toolCount ? `${this.info.toolCount} loaded` : '—'],
        ];

        for (const [label, value] of entries) {
            const labelStr = ` ${label}`;
            const pad = Math.max(1, 10 - labelStr.length);
            const valStr = truncate(value, width - 12);
            lines.push(`${this._theme.dim}${labelStr}${this._resetBg}${' '.repeat(pad)}${valStr}`);
        }

        // Voice status
        lines.push('');
        if (this.info.voiceStatus) {
            lines.push(` ${this._theme.green}▶${this._resetBg} ${this.info.voiceStatus}`);
        } else {
            lines.push('');
        }

        return lines;
    }

    // ── Spinner management ──────────────────────────────────────────────

    _hasRunningTools() {
        return this.toolCalls.some(tc => tc.status === 'running');
    }

    _ensureSpinner() {
        if (this._hasRunningTools() && !this._spinnerTimer) {
            this._spinnerTimer = setInterval(() => {
                this._spinnerIdx = (this._spinnerIdx + 1) % SPINNER.length;
                this._renderToolPanel();
            }, 150);
        } else if (!this._hasRunningTools() && this._spinnerTimer) {
            clearInterval(this._spinnerTimer);
            this._spinnerTimer = null;
        }
    }

    // ── Partial re-render helpers ────────────────────────────────────────

    _renderToolPanel() {
        if (!this._layout) return;
        const L = this._layout;
        const toolLines = this._buildToolLines(L.rightInner);
        const buf = [];
        buf.push(HIDE_CURSOR);

        for (let i = 0; i < L.toolPanelRows && i < L.contentRows - 2; i++) {
            const row = L.contentStartRow + 1 + i;
            buf.push(moveTo(row, L.rightPanelLeft + 1)); // inside right panel border
            const content = i < toolLines.length ? toolLines[i] : '';
            buf.push(padRight(content, L.rightInner));
        }

        buf.push(SHOW_CURSOR);
        this.emit(buf.join(''));
    }

    _renderInfoPanel() {
        if (!this._layout) return;
        const L = this._layout;
        const infoLines = this._buildInfoLines(L.rightInner);
        const buf = [];
        buf.push(HIDE_CURSOR);

        const infoContentStart = L.toolPanelRows + 1; // after info separator
        for (let i = 0; i < L.infoPanelRows && (infoContentStart + i) < L.contentRows - 2; i++) {
            const row = L.contentStartRow + 1 + infoContentStart + i;
            buf.push(moveTo(row, L.rightPanelLeft + 1));
            const content = i < infoLines.length ? infoLines[i] : '';
            buf.push(padRight(content, L.rightInner));
        }

        buf.push(SHOW_CURSOR);
        this.emit(buf.join(''));
    }

    _renderStatusBarOnly() {
        if (!this._layout) return;
        this.emit(this._renderStatusBar(this._layout));
    }

    // ── Public API ──────────────────────────────────────────────────────

    resize(cols, rows) {
        this.cols = Math.max(cols || 80, 40);
        this.rows = Math.max(rows || 24, 15);
        this._firstRender = true; // clear screen on resize
        this._cachedChatLinesNoStream = null; // invalidate cache on resize
        this.render();
    }

    appendMessage(role, text, timestamp) {
        this.messages.push({
            role,
            text: text || '',
            timestamp: timestamp || new Date(),
        });
        // Invalidate chat lines cache
        this._cachedChatLinesNoStream = null;
        // Auto-scroll to bottom
        this.scrollOffset = 0;
        this.render();
    }

    streamToken(token) {
        if (this._destroyed) {
            if (this._spinnerTimer) { clearInterval(this._spinnerTimer); this._spinnerTimer = null; }
            return;
        }
        this.streaming = true;
        this.streamBuffer += token;

        if (!this._layout) {
            this.render();
            return;
        }

        const L = this._layout;
        const width = L.leftInner - 2; // 2 for indent

        // Optimization: only re-wrap the last raw line of the stream buffer
        // (previous lines are already finalized by newlines)
        const lastNewline = this.streamBuffer.lastIndexOf('\n');
        const lastRawLine = lastNewline >= 0 ? this.streamBuffer.slice(lastNewline + 1) : this.streamBuffer;
        const linesBeforeLastRaw = lastNewline >= 0 ? this.streamBuffer.slice(0, lastNewline).split('\n').length : 0;

        // Count wrapped lines for all finalized lines (up to last newline)
        let wrappedCountBefore = 0;
        if (lastNewline >= 0) {
            const finalizedLines = this.streamBuffer.slice(0, lastNewline).split('\n');
            for (const line of finalizedLines) {
                wrappedCountBefore += wrapText(line, width).length;
            }
        }

        // Wrap only the last raw line
        const lastWrappedLines = wrapText(lastRawLine, width);
        const totalWrappedCount = wrappedCountBefore + lastWrappedLines.length;
        const lastWrapped = lastWrappedLines[lastWrappedLines.length - 1] || '';

        // Determine how many content rows are available for chat
        const visibleRows = L.contentEndRow - L.contentStartRow - 1;

        // Reuse cached non-stream chat lines
        const chatLinesNoStream = this._buildChatLinesNoStream(L.leftInner);
        const totalBefore = chatLinesNoStream.length;

        // If adding streaming would push past visible area, do full render
        const totalWithStream = totalBefore + totalWrappedCount;
        if (totalWithStream > visibleRows && this._streamWrappedLines !== totalWrappedCount) {
            this._streamWrappedLines = totalWrappedCount;
            this.render();
            return;
        }
        this._streamWrappedLines = totalWrappedCount;

        // Write only the last line of the stream at the correct position
        const streamStartRow = L.contentStartRow + 1 + totalBefore;
        const cursorRow = streamStartRow + totalWrappedCount - 1;

        if (cursorRow > L.contentEndRow - 1) {
            // Would overflow — full render with scroll
            this.render();
            return;
        }

        const buf = [];
        buf.push(HIDE_CURSOR);
        buf.push(moveTo(cursorRow, L.leftPanelLeft + 1)); // inside left panel border
        buf.push(padRight('  ' + lastWrapped + '█', L.leftInner));
        buf.push(SHOW_CURSOR);
        this.emit(buf.join(''));
    }

    _buildChatLinesNoStream(width) {
        // Return cached result if messages haven't changed
        if (this._cachedChatLinesNoStream &&
            this._cachedChatLinesWidth === width &&
            this._cachedMessageCount === this.messages.length) {
            return this._cachedChatLinesNoStream;
        }

        const lines = [];
        for (const msg of this.messages) {
            const ts = formatTime(msg.timestamp);
            const isUser = msg.role === 'user';
            const nameColor = isUser ? this._theme.user : this._theme.assistant;
            const name = isUser ? 'You' : this.model.split(':')[0];

            const headerLabel = `  ▸ ${name}`;
            const tsStr = `${this._theme.dim}${ts}${this._resetBg}`;
            const headerPad = Math.max(1, width - headerLabel.length - ts.length);
            lines.push(`${nameColor}${headerLabel}${this._resetBg}${' '.repeat(headerPad)}${tsStr}`);

            const wrapped = wrapText(msg.text, width - 2);
            for (const wl of wrapped) {
                lines.push('  ' + wl);
            }
            lines.push('');
        }

        this._cachedChatLinesNoStream = lines;
        this._cachedChatLinesWidth = width;
        this._cachedMessageCount = this.messages.length;
        return lines;
    }

    finishStream() {
        this.streaming = false;
        this.streamBuffer = '';
        this._streamWrappedLines = 0;
        this.render();
    }

    addToolCall(name, detail) {
        this.toolCalls.push({
            name,
            status: 'running',
            detail: detail || '',
            duration: null,
            startTime: Date.now(),
        });
        this._renderToolPanel();
        this._renderStatusBarOnly();
        this._ensureSpinner();
    }

    updateToolCall(name, status, duration) {
        const tc = this.toolCalls.find(t => t.name === name && t.status === 'running');
        if (tc) {
            tc.status = status || 'done';
            tc.duration = duration != null ? duration : Math.round((Date.now() - tc.startTime) / 1000);
        }
        this._renderToolPanel();
        this._renderStatusBarOnly();
        this._ensureSpinner();
    }

    updateInfo(key, value) {
        // TTS/STT engine names are shown in the status bar, not the info panel
        if (key === 'ttsEngine') {
            this.ttsEngine = value;
            this._renderStatusBarOnly();
            return;
        }
        if (key === 'sttEngine') {
            this.sttEngine = value;
            this._renderStatusBarOnly();
            return;
        }
        this.info[key] = value;
        this._renderInfoPanel();
    }

    updateContext(used, limit) {
        this.context.used = used;
        if (limit != null) this.context.limit = limit;
        this._renderStatusBarOnly();
    }

    scrollChat(delta) {
        if (!this._layout) return;
        const L = this._layout;
        const chatLines = this._buildChatLines(L.leftInner);
        const visibleRows = L.contentEndRow - L.contentStartRow - 1;
        const maxScroll = Math.max(0, chatLines.length - visibleRows);
        this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollOffset + delta));
        this.render();
    }

    /**
     * Tear down timers. Call when the renderer is no longer needed.
     */
    destroy() {
        this._destroyed = true;
        if (this._spinnerTimer) {
            clearInterval(this._spinnerTimer);
            this._spinnerTimer = null;
        }
    }
}

module.exports = { TUIRenderer };
