// Notion data validation utilities
// Validates properties before sending to Notion API to prevent
// silent failures and data corruption.

import { sanitizeHTML } from '../utils/sanitization.js';

const ISO_8601_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ISO_8601_DATETIME_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,3}Z$/;
const NOTION_RICH_TEXT_MAX_CHARS = 2000;

export class NotionValidator {
  /**
   * Validate an ISO 8601 date string for Notion's date property.
   * Accepts formats: "2024-01-15" or "2024-01-15T23:59:00Z" or "2024-01-15T23:59:00.000Z"
   * @param {*} date - The date value to validate
   * @returns {{ valid: boolean, sanitized: string|null, warning: string|null }}
   */
  static validateDateProperty(date) {
    if (date === null || date === undefined || date === '') {
      return { valid: true, sanitized: null, warning: null };
    }

    if (typeof date !== 'string') {
      return {
        valid: false,
        sanitized: null,
        warning: `Date must be a string, got ${typeof date}`
      };
    }

    const trimmed = date.trim();

    const isValidISO = ISO_8601_DATE_ONLY.test(trimmed) ||
      ISO_8601_DATETIME.test(trimmed) ||
      ISO_8601_DATETIME_MS.test(trimmed);

    if (!isValidISO) {
      // Attempt to parse and reformat
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const reformatted = parsed.toISOString();
        return {
          valid: true,
          sanitized: reformatted,
          warning: `Date "${trimmed}" reformatted to "${reformatted}"`
        };
      }
      return {
        valid: false,
        sanitized: null,
        warning: `Invalid date format: "${trimmed}". Expected ISO 8601 (e.g. 2024-01-15T23:59:00Z)`
      };
    }

    return { valid: true, sanitized: trimmed, warning: null };
  }

  /**
   * Validate a select option value.
   * If allowedOptions is provided, checks that the value is in the list.
   * @param {*} value - The select value to validate
   * @param {string[]|null} allowedOptions - Optional list of valid option names
   * @returns {{ valid: boolean, sanitized: string|null, warning: string|null }}
   */
  static validateSelectOption(value, allowedOptions = null) {
    if (value === null || value === undefined || value === '') {
      return { valid: true, sanitized: null, warning: null };
    }

    if (typeof value !== 'string') {
      return {
        valid: false,
        sanitized: null,
        warning: `Select option must be a string, got ${typeof value}`
      };
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { valid: true, sanitized: null, warning: null };
    }

    // Notion select option names max 100 chars
    if (trimmed.length > 100) {
      const truncated = trimmed.substring(0, 100);
      return {
        valid: true,
        sanitized: truncated,
        warning: `Select option truncated from ${trimmed.length} to 100 characters`
      };
    }

    if (allowedOptions && !allowedOptions.includes(trimmed)) {
      return {
        valid: true,
        sanitized: trimmed,
        warning: `Select option "${trimmed}" not in known options: [${allowedOptions.join(', ')}]. Notion will create it automatically.`
      };
    }

    return { valid: true, sanitized: trimmed, warning: null };
  }

  /**
   * Validate a rich text content string for Notion's 2000 character limit per text object.
   * @param {*} text - The text to validate
   * @returns {{ valid: boolean, sanitized: string|null, warning: string|null }}
   */
  static validateRichText(text) {
    if (text === null || text === undefined) {
      return { valid: true, sanitized: null, warning: null };
    }

    if (typeof text !== 'string') {
      const asString = String(text);
      if (asString.length <= NOTION_RICH_TEXT_MAX_CHARS) {
        return {
          valid: true,
          sanitized: asString,
          warning: `Rich text converted from ${typeof text} to string`
        };
      }
      return {
        valid: true,
        sanitized: asString.substring(0, NOTION_RICH_TEXT_MAX_CHARS),
        warning: `Rich text converted from ${typeof text} and truncated to ${NOTION_RICH_TEXT_MAX_CHARS} chars`
      };
    }

    if (text.length > NOTION_RICH_TEXT_MAX_CHARS) {
      return {
        valid: true,
        sanitized: text.substring(0, NOTION_RICH_TEXT_MAX_CHARS),
        warning: `Rich text truncated from ${text.length} to ${NOTION_RICH_TEXT_MAX_CHARS} characters`
      };
    }

    return { valid: true, sanitized: text, warning: null };
  }

  /**
   * Validate a number value for Notion's number property.
   * @param {*} value - The value to validate
   * @returns {{ valid: boolean, sanitized: number|null, warning: string|null }}
   */
  static validateNumber(value) {
    if (value === null || value === undefined) {
      return { valid: true, sanitized: null, warning: null };
    }

    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && isFinite(parsed)) {
        return {
          valid: true,
          sanitized: parsed,
          warning: `Number parsed from string: "${value}" -> ${parsed}`
        };
      }
      return {
        valid: false,
        sanitized: null,
        warning: `Cannot parse number from string: "${value}"`
      };
    }

    if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
      return {
        valid: false,
        sanitized: null,
        warning: `Invalid number value: ${value} (type: ${typeof value})`
      };
    }

    return { valid: true, sanitized: value, warning: null };
  }

  /**
   * Validate a URL string for Notion's url property.
   * @param {*} url - The URL to validate
   * @returns {{ valid: boolean, sanitized: string|null, warning: string|null }}
   */
  static validateUrl(url) {
    if (url === null || url === undefined || url === '') {
      return { valid: true, sanitized: null, warning: null };
    }

    if (typeof url !== 'string') {
      return {
        valid: false,
        sanitized: null,
        warning: `URL must be a string, got ${typeof url}`
      };
    }

    try {
      new URL(url);
      return { valid: true, sanitized: url, warning: null };
    } catch {
      return {
        valid: false,
        sanitized: null,
        warning: `Invalid URL format: "${url}"`
      };
    }
  }

  /**
   * Split long text into chunks that fit within Notion's 2000 character limit.
   * Returns an array of rich_text objects.
   * @param {string} text - The text to split
   * @param {number} maxChars - Maximum characters per chunk (default: 2000)
   * @returns {Array<{text: {content: string}}>}
   */
  static splitLongText(text, maxChars = NOTION_RICH_TEXT_MAX_CHARS) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    if (text.length <= maxChars) {
      return [{ text: { content: text } }];
    }

    const chunks = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({
        text: { content: text.substring(i, i + maxChars) }
      });
    }
    return chunks;
  }

  /**
   * Validate and sanitize a complete assignment's properties before sending to Notion.
   * Returns sanitized properties and any warnings encountered.
   * @param {Object} assignment - The assignment data from Canvas
   * @returns {{ properties: Object, warnings: string[] }}
   */
  static validateAssignmentForNotion(assignment) {
    const warnings = [];

    const validated = {
      title: assignment.title || 'Untitled Assignment',
      course: null,
      dueDate: null,
      status: null,
      points: null,
      link: null,
      canvasId: null,
      gradePercent: null,
      description: null
    };

    // Validate title as rich text
    const titleResult = this.validateRichText(assignment.title);
    if (titleResult.warning) warnings.push(`title: ${titleResult.warning}`);
    validated.title = titleResult.sanitized || 'Untitled Assignment';

    // Validate course as select
    if (assignment.course) {
      const courseResult = this.validateSelectOption(assignment.course);
      if (courseResult.warning) warnings.push(`course: ${courseResult.warning}`);
      validated.course = courseResult.sanitized;
    }

    // Validate dueDate as date
    if (assignment.dueDate) {
      const dateResult = this.validateDateProperty(assignment.dueDate);
      if (dateResult.warning) warnings.push(`dueDate: ${dateResult.warning}`);
      if (dateResult.valid) {
        validated.dueDate = dateResult.sanitized;
      } else {
        warnings.push(`dueDate: Skipping invalid date value`);
      }
    }

    // Validate status as select
    if (assignment.status) {
      const statusResult = this.validateSelectOption(assignment.status);
      if (statusResult.warning) warnings.push(`status: ${statusResult.warning}`);
      validated.status = statusResult.sanitized;
    }

    // Validate points as number
    if (assignment.points !== null && assignment.points !== undefined) {
      const pointsResult = this.validateNumber(assignment.points);
      if (pointsResult.warning) warnings.push(`points: ${pointsResult.warning}`);
      if (pointsResult.valid) {
        validated.points = pointsResult.sanitized;
      } else {
        warnings.push(`points: Skipping invalid number value`);
      }
    }

    // Validate link as URL
    if (assignment.link) {
      const linkResult = this.validateUrl(assignment.link);
      if (linkResult.warning) warnings.push(`link: ${linkResult.warning}`);
      if (linkResult.valid) {
        validated.link = linkResult.sanitized;
      } else {
        warnings.push(`link: Skipping invalid URL`);
      }
    }

    // Validate canvasId as rich text
    if (assignment.canvasId !== null && assignment.canvasId !== undefined) {
      const canvasIdStr = String(assignment.canvasId);
      const canvasIdResult = this.validateRichText(canvasIdStr);
      if (canvasIdResult.warning) warnings.push(`canvasId: ${canvasIdResult.warning}`);
      validated.canvasId = canvasIdResult.sanitized;
    }

    // Validate gradePercent as number
    if (assignment.gradePercent !== null && assignment.gradePercent !== undefined) {
      const gradeResult = this.validateNumber(assignment.gradePercent);
      if (gradeResult.warning) warnings.push(`gradePercent: ${gradeResult.warning}`);
      if (gradeResult.valid) {
        validated.gradePercent = gradeResult.sanitized;
      } else {
        warnings.push(`gradePercent: Skipping invalid number value`);
      }
    }

    // Sanitize and validate description (HTML from Canvas -> plain text)
    if (assignment.description !== null && assignment.description !== undefined && assignment.description !== '') {
      const sanitized = sanitizeHTML(assignment.description);
      if (sanitized) {
        const descResult = this.validateRichText(sanitized);
        if (descResult.warning) warnings.push(`description: ${descResult.warning}`);
        validated.description = descResult.sanitized;
      }
    }

    return { validated, warnings };
  }
}
