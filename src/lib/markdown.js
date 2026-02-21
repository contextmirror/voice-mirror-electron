/**
 * markdown.js -- Markdown rendering utilities using `marked`.
 *
 * Provides a configured marked instance suitable for chat messages.
 * All output is sanitized with DOMPurify to prevent XSS from untrusted content.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for safe, chat-friendly rendering
marked.setOptions({
  breaks: true,       // GFM line breaks
  gfm: true,          // GitHub-flavored markdown
  async: false,       // Ensure synchronous parsing
});

/**
 * Render a markdown string to HTML.
 * @param {string} text - Raw markdown text
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const raw = /** @type {string} */ (marked.parse(text));
  return DOMPurify.sanitize(raw);
}
