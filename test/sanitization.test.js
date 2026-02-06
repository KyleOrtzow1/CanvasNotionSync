import { describe, test, expect } from '@jest/globals';
import { sanitizeHTML } from '../src/utils/sanitization.js';

describe('sanitizeHTML', () => {

  describe('null/undefined/empty handling', () => {
    test('returns empty string for null', () => {
      expect(sanitizeHTML(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(sanitizeHTML(undefined)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(sanitizeHTML('')).toBe('');
    });

    test('converts non-string input to string and sanitizes', () => {
      expect(sanitizeHTML(12345)).toBe('12345');
    });
  });

  describe('basic HTML stripping', () => {
    test('strips simple HTML tags', () => {
      expect(sanitizeHTML('<p>Hello World</p>')).toBe('Hello World');
    });

    test('strips nested HTML tags', () => {
      expect(sanitizeHTML('<div><p><strong>Bold</strong> text</p></div>')).toBe('Bold text');
    });

    test('strips self-closing tags', () => {
      expect(sanitizeHTML('Before<hr/>After')).toBe('BeforeAfter');
    });

    test('returns plain text unchanged', () => {
      expect(sanitizeHTML('Just plain text')).toBe('Just plain text');
    });

    test('handles multiple paragraphs', () => {
      const html = '<p>First paragraph</p><p>Second paragraph</p>';
      const result = sanitizeHTML(html);
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
    });
  });

  describe('XSS prevention - malicious script tags', () => {
    test('strips script tags and their content', () => {
      const malicious = '<p>Hello</p><script>alert("XSS")</script><p>World</p>';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    test('strips inline event handlers', () => {
      const malicious = '<div onclick="alert(\'XSS\')">Click me</div>';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
      expect(result).toBe('Click me');
    });

    test('strips onerror handlers on images', () => {
      const malicious = '<img src="x" onerror="alert(\'XSS\')">';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('alert');
    });

    test('strips javascript: protocol in links', () => {
      const malicious = '<a href="javascript:alert(\'XSS\')">Click</a>';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('javascript:');
      expect(result).toBe('Click');
    });

    test('strips SVG-based XSS', () => {
      const malicious = '<svg onload="alert(\'XSS\')"><text>Hello</text></svg>';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('onload');
      expect(result).not.toContain('<svg');
    });

    test('strips data URI XSS', () => {
      const malicious = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
      const result = sanitizeHTML(malicious);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('<a');
      expect(result).toContain('Click');
    });
  });

  describe('HTML entity decoding', () => {
    test('decodes &amp;', () => {
      expect(sanitizeHTML('Tom &amp; Jerry')).toBe('Tom & Jerry');
    });

    test('decodes &lt; and &gt;', () => {
      expect(sanitizeHTML('a &lt; b &gt; c')).toBe('a < b > c');
    });

    test('decodes &quot;', () => {
      expect(sanitizeHTML('She said &quot;hello&quot;')).toBe('She said "hello"');
    });

    test('decodes &#039; (apostrophe)', () => {
      expect(sanitizeHTML('it&#039;s fine')).toBe("it's fine");
    });

    test('decodes &nbsp;', () => {
      expect(sanitizeHTML('word1&nbsp;word2')).toBe('word1 word2');
    });

    test('decodes numeric entities', () => {
      expect(sanitizeHTML('&#65;&#66;&#67;')).toBe('ABC');
    });

    test('decodes hex entities', () => {
      expect(sanitizeHTML('&#x41;&#x42;&#x43;')).toBe('ABC');
    });
  });

  describe('line break handling', () => {
    test('converts <br> to newlines by default', () => {
      const result = sanitizeHTML('Line 1<br>Line 2');
      expect(result).toBe('Line 1\nLine 2');
    });

    test('converts <br/> to newlines', () => {
      const result = sanitizeHTML('Line 1<br/>Line 2');
      expect(result).toBe('Line 1\nLine 2');
    });

    test('converts <br /> to newlines', () => {
      const result = sanitizeHTML('Line 1<br />Line 2');
      expect(result).toBe('Line 1\nLine 2');
    });

    test('converts block elements to newlines', () => {
      const result = sanitizeHTML('<p>Paragraph 1</p><p>Paragraph 2</p>');
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
      // Should have some kind of separation
      expect(result).not.toBe('Paragraph 1Paragraph 2');
    });

    test('collapses multiple consecutive newlines', () => {
      const result = sanitizeHTML('<p>A</p><p></p><p></p><p>B</p>');
      const newlineCount = (result.match(/\n/g) || []).length;
      expect(newlineCount).toBeLessThanOrEqual(2);
    });

    test('does not add newlines when preserveLineBreaks is false', () => {
      const result = sanitizeHTML('Line 1<br>Line 2', { preserveLineBreaks: false });
      expect(result).not.toContain('\n');
    });
  });

  describe('Canvas-specific HTML content', () => {
    test('handles typical Canvas assignment description', () => {
      const canvasHTML = `
        <p>Submit your essay on the following topic:</p>
        <ul>
          <li>Choose a relevant case study</li>
          <li>Analyze using the framework from class</li>
        </ul>
        <p><strong>Due by midnight.</strong></p>
      `;
      const result = sanitizeHTML(canvasHTML);
      expect(result).toContain('Submit your essay');
      expect(result).toContain('Choose a relevant case study');
      expect(result).toContain('Analyze using the framework');
      expect(result).toContain('Due by midnight.');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    test('handles Canvas description with links', () => {
      const html = '<p>Read <a href="https://example.com">this article</a> before class.</p>';
      const result = sanitizeHTML(html);
      expect(result).toContain('this article');
      expect(result).toContain('before class');
      expect(result).not.toContain('<a');
      expect(result).not.toContain('href');
    });

    test('handles Canvas description with embedded images', () => {
      const html = '<p>See the diagram below:</p><img src="https://canvas.example.com/image.png" alt="Diagram"><p>Answer questions 1-5.</p>';
      const result = sanitizeHTML(html);
      expect(result).toContain('See the diagram below');
      expect(result).toContain('Answer questions 1-5');
      expect(result).not.toContain('<img');
    });
  });

  describe('whitespace normalization', () => {
    test('collapses multiple spaces', () => {
      expect(sanitizeHTML('hello    world')).toBe('hello world');
    });

    test('trims leading and trailing whitespace', () => {
      expect(sanitizeHTML('  <p>  hello  </p>  ')).toBe('hello');
    });

    test('handles tabs', () => {
      expect(sanitizeHTML('hello\t\tworld')).toBe('hello world');
    });
  });

  describe('edge cases', () => {
    test('handles malformed HTML gracefully', () => {
      const malformed = '<p>Unclosed paragraph<div>Mixed nesting</p></div>';
      const result = sanitizeHTML(malformed);
      expect(result).toContain('Unclosed paragraph');
      expect(result).toContain('Mixed nesting');
      expect(result).not.toContain('<');
    });

    test('handles empty tags', () => {
      expect(sanitizeHTML('<p></p><div></div>')).toBe('');
    });

    test('handles tags with attributes', () => {
      const html = '<p class="intro" id="main" style="color:red">Styled text</p>';
      const result = sanitizeHTML(html);
      expect(result).toBe('Styled text');
      expect(result).not.toContain('class=');
      expect(result).not.toContain('style=');
    });

    test('handles very long HTML content', () => {
      const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
      const result = sanitizeHTML(longContent);
      expect(result.length).toBe(10000);
    });

    test('handles HTML comments', () => {
      const html = '<p>Before</p><!-- comment --><p>After</p>';
      const result = sanitizeHTML(html);
      expect(result).not.toContain('comment');
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });
  });
});
