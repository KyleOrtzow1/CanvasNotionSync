import { describe, test, expect } from '@jest/globals';
import '../src/validators/canvas-validator.js';
const { CanvasValidator } = globalThis;

// Helper to create an object without specific keys
function omit(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

describe('CanvasValidator', () => {

  describe('validateAssignment', () => {
    const validAssignment = {
      id: 12345,
      name: 'Homework 1',
      due_at: '2024-03-15T23:59:00Z',
      points_possible: 100,
      course_id: 678,
      html_url: 'https://canvas.instructure.com/courses/678/assignments/12345',
      submission_types: ['online_upload'],
      description: '<p>Submit your work</p>'
    };

    test('accepts a valid assignment with no warnings', () => {
      const result = CanvasValidator.validateAssignment(validAssignment);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.validated.id).toBe(12345);
      expect(result.validated.name).toBe('Homework 1');
    });

    test('rejects null input', () => {
      const result = CanvasValidator.validateAssignment(null);
      expect(result.valid).toBe(false);
      expect(result.validated).toBeNull();
    });

    test('rejects undefined input', () => {
      const result = CanvasValidator.validateAssignment(undefined);
      expect(result.valid).toBe(false);
      expect(result.validated).toBeNull();
    });

    test('rejects non-object input', () => {
      const result = CanvasValidator.validateAssignment('not an object');
      expect(result.valid).toBe(false);
      expect(result.validated).toBeNull();
    });

    test('rejects assignment with missing id', () => {
      const result = CanvasValidator.validateAssignment(omit(validAssignment, ['id']));
      expect(result.valid).toBe(false);
      expect(result.warnings).toContain('Missing required field: id');
    });

    test('rejects assignment with null id', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, id: null });
      expect(result.valid).toBe(false);
    });

    test('accepts assignment with id of 0', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, id: 0 });
      expect(result.valid).toBe(true);
      expect(result.validated.id).toBe(0);
    });

    // Name validation
    test('uses fallback name when name is missing', () => {
      const result = CanvasValidator.validateAssignment(omit(validAssignment, ['name']));
      expect(result.valid).toBe(true);
      expect(result.validated.name).toBe('Assignment 12345');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('uses fallback name when name is empty string', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, name: '' });
      expect(result.valid).toBe(true);
      expect(result.validated.name).toBe('Assignment 12345');
    });

    test('uses fallback name when name is whitespace only', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, name: '   ' });
      expect(result.valid).toBe(true);
      expect(result.validated.name).toBe('Assignment 12345');
    });

    test('uses fallback name when name is not a string', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, name: 123 });
      expect(result.valid).toBe(true);
      expect(result.validated.name).toBe('Assignment 12345');
    });

    // due_at validation
    test('accepts null due_at', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, due_at: null });
      expect(result.valid).toBe(true);
      expect(result.validated.due_at).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });

    test('accepts undefined due_at', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, due_at: undefined });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('accepts valid ISO 8601 due_at', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, due_at: '2024-06-01T12:00:00Z' });
      expect(result.valid).toBe(true);
      expect(result.validated.due_at).toBe('2024-06-01T12:00:00Z');
    });

    test('sets invalid due_at to null with warning', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, due_at: 'not-a-date' });
      expect(result.valid).toBe(true);
      expect(result.validated.due_at).toBeNull();
      expect(result.warnings.some(w => w.includes('Invalid due_at'))).toBe(true);
    });

    test('sets non-string due_at to null with warning', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, due_at: 12345 });
      expect(result.valid).toBe(true);
      expect(result.validated.due_at).toBeNull();
    });

    // points_possible validation
    test('accepts null points_possible', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: null });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBeNull();
      expect(result.warnings).toHaveLength(0);
    });

    test('accepts zero points_possible', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: 0 });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBe(0);
    });

    test('accepts positive points_possible', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: 50.5 });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBe(50.5);
    });

    test('sets negative points_possible to null with warning', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: -10 });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBeNull();
      expect(result.warnings.some(w => w.includes('Invalid points_possible'))).toBe(true);
    });

    test('sets NaN points_possible to null with warning', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: 'abc' });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBeNull();
    });

    test('coerces string number points_possible', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, points_possible: '75' });
      expect(result.valid).toBe(true);
      expect(result.validated.points_possible).toBe(75);
    });

    // course_id validation
    test('warns when course_id is missing', () => {
      const result = CanvasValidator.validateAssignment(omit(validAssignment, ['course_id']));
      expect(result.valid).toBe(true); // Not a rejection, just a warning
      expect(result.warnings.some(w => w.includes('Missing course_id'))).toBe(true);
    });

    test('accepts course_id of 0', () => {
      const result = CanvasValidator.validateAssignment({ ...validAssignment, course_id: 0 });
      expect(result.valid).toBe(true);
      expect(result.warnings.every(w => !w.includes('Missing course_id'))).toBe(true);
    });

    // Preserves extra fields
    test('preserves additional fields in validated output', () => {
      const result = CanvasValidator.validateAssignment(validAssignment);
      expect(result.validated.html_url).toBe(validAssignment.html_url);
      expect(result.validated.description).toBe(validAssignment.description);
      expect(result.validated.submission_types).toEqual(['online_upload']);
    });
  });

  describe('validateCourse', () => {
    const validCourse = {
      id: 678,
      course_code: '2257-CSC-413-02-1-1639',
      name: 'Computer Science 413'
    };

    test('accepts a valid course with no warnings', () => {
      const result = CanvasValidator.validateCourse(validCourse);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('rejects null input', () => {
      const result = CanvasValidator.validateCourse(null);
      expect(result.valid).toBe(false);
    });

    test('rejects course with missing id', () => {
      const result = CanvasValidator.validateCourse(omit(validCourse, ['id']));
      expect(result.valid).toBe(false);
    });

    test('uses fallback course_code when missing', () => {
      const result = CanvasValidator.validateCourse(omit(validCourse, ['course_code']));
      expect(result.valid).toBe(true);
      expect(result.validated.course_code).toBe('Course 678');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('uses fallback course_code when not a string', () => {
      const result = CanvasValidator.validateCourse({ ...validCourse, course_code: 123 });
      expect(result.valid).toBe(true);
      expect(result.validated.course_code).toBe('Course 678');
    });

    test('preserves additional fields', () => {
      const result = CanvasValidator.validateCourse(validCourse);
      expect(result.validated.name).toBe('Computer Science 413');
    });
  });
});
