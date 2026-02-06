import { describe, test, expect } from '@jest/globals';
import { NotionValidator } from '../src/validators/notion-validator.js';

describe('NotionValidator', () => {

  describe('validateDateProperty', () => {
    test('accepts null/undefined/empty as valid', () => {
      expect(NotionValidator.validateDateProperty(null)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateDateProperty(undefined)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateDateProperty('')).toEqual({ valid: true, sanitized: null, warning: null });
    });

    test('accepts valid ISO 8601 date-only format', () => {
      const result = NotionValidator.validateDateProperty('2024-01-15');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('2024-01-15');
      expect(result.warning).toBeNull();
    });

    test('accepts valid ISO 8601 datetime format', () => {
      const result = NotionValidator.validateDateProperty('2024-01-15T23:59:00Z');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('2024-01-15T23:59:00Z');
    });

    test('accepts valid ISO 8601 datetime with milliseconds', () => {
      const result = NotionValidator.validateDateProperty('2024-01-15T23:59:00.000Z');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('2024-01-15T23:59:00.000Z');
    });

    test('reformats parseable non-ISO date strings', () => {
      const result = NotionValidator.validateDateProperty('Jan 15, 2024');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.warning).toContain('reformatted');
    });

    test('rejects completely invalid dates', () => {
      const result = NotionValidator.validateDateProperty('not-a-date');
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeNull();
      expect(result.warning).toContain('Invalid date format');
    });

    test('rejects non-string types', () => {
      const result = NotionValidator.validateDateProperty(12345);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('must be a string');
    });

    test('trims whitespace from dates', () => {
      const result = NotionValidator.validateDateProperty('  2024-01-15  ');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('2024-01-15');
    });
  });

  describe('validateSelectOption', () => {
    test('accepts null/undefined/empty as valid', () => {
      expect(NotionValidator.validateSelectOption(null)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateSelectOption(undefined)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateSelectOption('')).toEqual({ valid: true, sanitized: null, warning: null });
    });

    test('accepts valid string option', () => {
      const result = NotionValidator.validateSelectOption('In Progress');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('In Progress');
    });

    test('rejects non-string types', () => {
      const result = NotionValidator.validateSelectOption(42);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('must be a string');
    });

    test('truncates options longer than 100 chars', () => {
      const longOption = 'A'.repeat(150);
      const result = NotionValidator.validateSelectOption(longOption);
      expect(result.valid).toBe(true);
      expect(result.sanitized.length).toBe(100);
      expect(result.warning).toContain('truncated');
    });

    test('validates against allowed options list', () => {
      const allowed = ['Unstarted', 'In Progress', 'Submitted', 'Graded'];
      const result = NotionValidator.validateSelectOption('Unknown Status', allowed);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Unknown Status');
      expect(result.warning).toContain('not in known options');
    });

    test('passes when value is in allowed options', () => {
      const allowed = ['Unstarted', 'In Progress', 'Submitted', 'Graded'];
      const result = NotionValidator.validateSelectOption('In Progress', allowed);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeNull();
    });

    test('treats whitespace-only as empty', () => {
      const result = NotionValidator.validateSelectOption('   ');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBeNull();
    });
  });

  describe('validateRichText', () => {
    test('accepts null/undefined as valid', () => {
      expect(NotionValidator.validateRichText(null)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateRichText(undefined)).toEqual({ valid: true, sanitized: null, warning: null });
    });

    test('accepts normal text', () => {
      const result = NotionValidator.validateRichText('Hello World');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Hello World');
    });

    test('truncates text longer than 2000 chars', () => {
      const longText = 'X'.repeat(3000);
      const result = NotionValidator.validateRichText(longText);
      expect(result.valid).toBe(true);
      expect(result.sanitized.length).toBe(2000);
      expect(result.warning).toContain('truncated');
    });

    test('converts non-string types to string', () => {
      const result = NotionValidator.validateRichText(12345);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('12345');
      expect(result.warning).toContain('converted');
    });

    test('converts and truncates long non-string values', () => {
      const longNumber = 'N'.repeat(3000);
      // Use an object with a long toString
      const obj = { toString: () => longNumber };
      const result = NotionValidator.validateRichText(obj);
      expect(result.valid).toBe(true);
      expect(result.sanitized.length).toBe(2000);
      expect(result.warning).toContain('truncated');
    });

    test('accepts text exactly at 2000 char limit', () => {
      const text = 'A'.repeat(2000);
      const result = NotionValidator.validateRichText(text);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(text);
      expect(result.warning).toBeNull();
    });
  });

  describe('validateNumber', () => {
    test('accepts null/undefined as valid', () => {
      expect(NotionValidator.validateNumber(null)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateNumber(undefined)).toEqual({ valid: true, sanitized: null, warning: null });
    });

    test('accepts valid numbers', () => {
      expect(NotionValidator.validateNumber(42)).toEqual({ valid: true, sanitized: 42, warning: null });
      expect(NotionValidator.validateNumber(0)).toEqual({ valid: true, sanitized: 0, warning: null });
      expect(NotionValidator.validateNumber(99.5)).toEqual({ valid: true, sanitized: 99.5, warning: null });
      expect(NotionValidator.validateNumber(-10)).toEqual({ valid: true, sanitized: -10, warning: null });
    });

    test('parses numeric strings', () => {
      const result = NotionValidator.validateNumber('42.5');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(42.5);
      expect(result.warning).toContain('parsed from string');
    });

    test('rejects non-numeric strings', () => {
      const result = NotionValidator.validateNumber('abc');
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBeNull();
      expect(result.warning).toContain('Cannot parse');
    });

    test('rejects NaN', () => {
      const result = NotionValidator.validateNumber(NaN);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('Invalid number');
    });

    test('rejects Infinity', () => {
      const result = NotionValidator.validateNumber(Infinity);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('Invalid number');
    });
  });

  describe('validateUrl', () => {
    test('accepts null/undefined/empty as valid', () => {
      expect(NotionValidator.validateUrl(null)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateUrl(undefined)).toEqual({ valid: true, sanitized: null, warning: null });
      expect(NotionValidator.validateUrl('')).toEqual({ valid: true, sanitized: null, warning: null });
    });

    test('accepts valid URLs', () => {
      const result = NotionValidator.validateUrl('https://canvas.instructure.com/courses/123');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('https://canvas.instructure.com/courses/123');
    });

    test('rejects invalid URLs', () => {
      const result = NotionValidator.validateUrl('not a url');
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('Invalid URL');
    });

    test('rejects non-string types', () => {
      const result = NotionValidator.validateUrl(123);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('must be a string');
    });
  });

  describe('splitLongText', () => {
    test('returns empty array for null/undefined', () => {
      expect(NotionValidator.splitLongText(null)).toEqual([]);
      expect(NotionValidator.splitLongText(undefined)).toEqual([]);
    });

    test('returns single chunk for short text', () => {
      const result = NotionValidator.splitLongText('Hello');
      expect(result).toEqual([{ text: { content: 'Hello' } }]);
    });

    test('splits text exceeding limit into chunks', () => {
      const text = 'A'.repeat(5000);
      const result = NotionValidator.splitLongText(text, 2000);
      expect(result).toHaveLength(3);
      expect(result[0].text.content.length).toBe(2000);
      expect(result[1].text.content.length).toBe(2000);
      expect(result[2].text.content.length).toBe(1000);
    });

    test('handles exact boundary text', () => {
      const text = 'B'.repeat(2000);
      const result = NotionValidator.splitLongText(text, 2000);
      expect(result).toHaveLength(1);
      expect(result[0].text.content).toBe(text);
    });

    test('returns empty array for non-string input', () => {
      expect(NotionValidator.splitLongText(123)).toEqual([]);
    });
  });

  describe('validateAssignmentForNotion', () => {
    const validAssignment = {
      title: 'Homework 1',
      course: 'CS 101',
      dueDate: '2024-03-15T23:59:00Z',
      status: 'Unstarted',
      points: 100,
      link: 'https://canvas.instructure.com/courses/1/assignments/1',
      canvasId: '12345',
      gradePercent: 85.5
    };

    test('validates a fully valid assignment with no warnings', () => {
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(validAssignment);
      expect(warnings).toHaveLength(0);
      expect(validated.title).toBe('Homework 1');
      expect(validated.course).toBe('CS 101');
      expect(validated.dueDate).toBe('2024-03-15T23:59:00Z');
      expect(validated.status).toBe('Unstarted');
      expect(validated.points).toBe(100);
      expect(validated.link).toBe('https://canvas.instructure.com/courses/1/assignments/1');
      expect(validated.canvasId).toBe('12345');
      expect(validated.gradePercent).toBe(85.5);
    });

    test('handles missing optional fields', () => {
      const minimal = { title: 'Test', canvasId: '1' };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(minimal);
      expect(warnings).toHaveLength(0);
      expect(validated.title).toBe('Test');
      expect(validated.course).toBeNull();
      expect(validated.dueDate).toBeNull();
      expect(validated.points).toBeNull();
    });

    test('defaults to Untitled Assignment for missing title', () => {
      const { validated } = NotionValidator.validateAssignmentForNotion({});
      expect(validated.title).toBe('Untitled Assignment');
    });

    test('generates warnings for invalid date and skips it', () => {
      const assignment = { ...validAssignment, dueDate: 'invalid-date' };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.dueDate).toBeNull();
      expect(warnings.some(w => w.includes('dueDate'))).toBe(true);
    });

    test('generates warnings for invalid points and skips them', () => {
      const assignment = { ...validAssignment, points: 'not-a-number' };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.points).toBeNull();
      expect(warnings.some(w => w.includes('points'))).toBe(true);
    });

    test('generates warnings for invalid URL and skips it', () => {
      const assignment = { ...validAssignment, link: 'not a url' };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.link).toBeNull();
      expect(warnings.some(w => w.includes('link'))).toBe(true);
    });

    test('converts numeric canvasId to string', () => {
      const assignment = { ...validAssignment, canvasId: 12345 };
      const { validated } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.canvasId).toBe('12345');
    });

    test('handles invalid gradePercent', () => {
      const assignment = { ...validAssignment, gradePercent: NaN };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.gradePercent).toBeNull();
      expect(warnings.some(w => w.includes('gradePercent'))).toBe(true);
    });

    test('reformats non-standard date and warns', () => {
      const assignment = { ...validAssignment, dueDate: 'March 15, 2024' };
      const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);
      expect(validated.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(warnings.some(w => w.includes('reformatted'))).toBe(true);
    });
  });
});
