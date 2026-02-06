// HTML sanitization utility for Canvas assignment descriptions.
// Strips HTML tags and decodes entities to produce safe plain text.
// Works in both browser (DOMParser) and Node.js (regex fallback) environments.

const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&laquo;': '\u00AB',
  '&raquo;': '\u00BB',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&hellip;': '\u2026'
};

const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|nbsp|ndash|mdash|laquo|raquo|copy|reg|hellip|#0?39|#039);/g;
const NUMERIC_ENTITY_REGEX = /&#(\d+);/g;
const HEX_ENTITY_REGEX = /&#x([0-9a-fA-F]+);/g;

/**
 * Decode common HTML entities to their character equivalents.
 * @param {string} text - Text potentially containing HTML entities
 * @returns {string} Decoded text
 */
function decodeHTMLEntities(text) {
  let decoded = text.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] || match);
  decoded = decoded.replace(NUMERIC_ENTITY_REGEX, (_, code) => String.fromCharCode(parseInt(code, 10)));
  decoded = decoded.replace(HEX_ENTITY_REGEX, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}

/**
 * Sanitize HTML content by stripping all tags and decoding entities.
 * Returns safe plain text suitable for storing in Notion or displaying to users.
 *
 * In browser environments, uses DOMParser for robust and secure parsing.
 * In Node.js environments, falls back to regex-based stripping.
 *
 * @param {*} html - The HTML string to sanitize
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.preserveLineBreaks=true] - Convert <br>, <p>, <div> to newlines
 * @returns {string} Sanitized plain text, or empty string for null/undefined input
 */
export function sanitizeHTML(html, options = {}) {
  if (html === null || html === undefined || html === '') {
    return '';
  }

  if (typeof html !== 'string') {
    html = String(html);
  }

  const { preserveLineBreaks = true } = options;

  // Browser environment: use DOMParser for secure, spec-compliant parsing
  if (typeof DOMParser !== 'undefined') {
    return sanitizeWithDOMParser(html, preserveLineBreaks);
  }

  // Node.js fallback: regex-based stripping
  return sanitizeWithRegex(html, preserveLineBreaks);
}

/**
 * Browser-based sanitization using DOMParser.
 * This is the preferred method as it handles all HTML edge cases securely.
 * Scripts and event handlers are not executed during parsing.
 */
function sanitizeWithDOMParser(html, preserveLineBreaks) {
  let processed = html;

  if (preserveLineBreaks) {
    // Insert newline markers before block-level elements and <br>
    processed = processed.replace(/<br\s*\/?>/gi, '\n');
    processed = processed.replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
    processed = processed.replace(/<(?:p|div|h[1-6]|li|tr|blockquote)[\s>]/gi, (match) => {
      return '\n' + match;
    });
  }

  const doc = new DOMParser().parseFromString(processed, 'text/html');
  let text = doc.body.textContent || '';

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  if (preserveLineBreaks) {
    text = text.replace(/\n[ \t]+/g, '\n');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }

  return text.trim();
}

/**
 * Regex-based sanitization fallback for Node.js environments.
 * Strips HTML tags and decodes common entities.
 */
function sanitizeWithRegex(html, preserveLineBreaks) {
  let text = html;

  // Remove script and style elements and their content entirely
  text = text.replace(/<script[\s>][\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s>][\s\S]*?<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  if (preserveLineBreaks) {
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
  }

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = decodeHTMLEntities(text);

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  if (preserveLineBreaks) {
    text = text.replace(/\n[ \t]+/g, '\n');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }

  return text.trim();
}

// Make available as global when loaded as a content script (non-module context)
if (typeof globalThis !== 'undefined' && typeof globalThis.sanitizeHTML === 'undefined') {
  globalThis.sanitizeHTML = sanitizeHTML;
}
