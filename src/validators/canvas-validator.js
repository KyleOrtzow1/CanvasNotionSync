// Canvas API response data validator
// Validates and sanitizes assignment/course data from Canvas before syncing to Notion

class CanvasValidator {
  /**
   * Validate a Canvas assignment object.
   * Returns { valid, validated, warnings } where validated is a safe copy of the assignment.
   */
  static validateAssignment(assignment) {
    const warnings = [];

    if (!assignment || typeof assignment !== 'object') {
      return { valid: false, validated: null, warnings: ['Assignment is not an object'] };
    }

    // Required: id must exist
    if (assignment.id === null || assignment.id === undefined) {
      return { valid: false, validated: null, warnings: ['Missing required field: id'] };
    }

    const validated = { ...assignment };

    // Required: name must be non-empty string
    if (!assignment.name || typeof assignment.name !== 'string' || !assignment.name.trim()) {
      warnings.push(`Missing or empty name for assignment ${assignment.id}, using fallback`);
      validated.name = `Assignment ${assignment.id}`;
    }

    // Validate due_at (ISO 8601 date string or null)
    if (assignment.due_at !== null && assignment.due_at !== undefined) {
      if (typeof assignment.due_at !== 'string' || isNaN(new Date(assignment.due_at).getTime())) {
        warnings.push(`Invalid due_at "${assignment.due_at}" for assignment ${assignment.id}, setting to null`);
        validated.due_at = null;
      }
    }

    // Validate points_possible (number >= 0 or null)
    if (assignment.points_possible !== null && assignment.points_possible !== undefined) {
      const points = Number(assignment.points_possible);
      if (isNaN(points) || points < 0) {
        warnings.push(`Invalid points_possible "${assignment.points_possible}" for assignment ${assignment.id}, setting to null`);
        validated.points_possible = null;
      } else {
        validated.points_possible = points;
      }
    }

    // Validate course_id exists
    if (!assignment.course_id && assignment.course_id !== 0) {
      warnings.push(`Missing course_id for assignment ${assignment.id}`);
    }

    return { valid: true, validated, warnings };
  }

  /**
   * Validate a Canvas course object.
   * Returns { valid, validated, warnings }.
   */
  static validateCourse(course) {
    const warnings = [];

    if (!course || typeof course !== 'object') {
      return { valid: false, validated: null, warnings: ['Course is not an object'] };
    }

    if (course.id === null || course.id === undefined) {
      return { valid: false, validated: null, warnings: ['Missing required field: id'] };
    }

    const validated = { ...course };

    if (!course.course_code || typeof course.course_code !== 'string') {
      warnings.push(`Missing or invalid course_code for course ${course.id}, using fallback`);
      validated.course_code = `Course ${course.id}`;
    }

    return { valid: true, validated, warnings };
  }
}

// Make available as global when loaded as a content script (non-module) context
if (typeof globalThis !== 'undefined' && typeof globalThis.CanvasValidator === 'undefined') {
  globalThis.CanvasValidator = CanvasValidator;
}
