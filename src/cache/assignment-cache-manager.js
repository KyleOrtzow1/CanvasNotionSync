/**
 * Unified cache manager for Canvas assignments with Notion page ID mappings.
 * Provides field-level change detection and long-term persistence (30 days).
 */

import { CacheManager } from './cache-manager.js';

export class AssignmentCacheManager extends CacheManager {
  constructor() {
    super({
      storageKey: 'assignment_cache',
      maxMemorySize: 500,
      defaultTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
      enablePersistence: true
    });

    this.activeCourseIds = new Set();
    this.version = 1;
  }

  /**
   * Cache a Canvas assignment with its Notion page ID mapping
   * @param {string} canvasId - Canvas assignment ID
   * @param {Object} canvasData - Assignment data from Canvas
   * @param {string} notionPageId - Notion page UUID (optional for initial cache)
   */
  async cacheAssignment(canvasId, canvasData, notionPageId = null) {
    const key = `assignment:${canvasId}`;
    const now = Date.now();

    const entry = {
      canvasData: {
        title: canvasData.title,
        course: canvasData.course,
        courseCode: canvasData.courseCode,
        courseId: canvasData.courseId,
        dueDate: canvasData.dueDate,
        points: canvasData.points,
        status: canvasData.status,
        type: canvasData.type,
        description: canvasData.description,
        grade: canvasData.grade,
        gradePercent: canvasData.gradePercent,
        link: canvasData.link,
        source: canvasData.source
      },
      notionPageId,
      lastSynced: now,
      expiresAt: now + this.defaultTTL,
      version: this.version
    };

    await this.set(key, entry);
    return entry;
  }

  /**
   * Retrieve cached assignment data
   * @param {string} canvasId - Canvas assignment ID
   * @returns {Object|null} Cached entry or null if not found/expired
   */
  async getCachedAssignment(canvasId) {
    const key = `assignment:${canvasId}`;
    return await this.get(key);
  }

  /**
   * Update only the Notion page ID mapping for an assignment
   * @param {string} canvasId - Canvas assignment ID
   * @param {string} notionPageId - Notion page UUID
   */
  async updateNotionMapping(canvasId, notionPageId) {
    const key = `assignment:${canvasId}`;
    const cached = await this.get(key);

    if (cached) {
      cached.notionPageId = notionPageId;
      cached.lastSynced = Date.now();
      await this.set(key, cached);
    }
  }

  /**
   * Compare cached assignment with new Canvas data to detect changes
   * @param {string} canvasId - Canvas assignment ID
   * @param {Object} newCanvasData - Fresh assignment data from Canvas
   * @returns {Object} { needsUpdate: boolean, changedFields: string[], cachedEntry: Object|null }
   */
  async compareAndNeedsUpdate(canvasId, newCanvasData) {
    const cached = await this.getCachedAssignment(canvasId);

    if (!cached || !cached.canvasData) {
      return { needsUpdate: true, changedFields: [], cachedEntry: null };
    }

    const compareFields = [
      'title', 'course', 'courseCode', 'dueDate', 'points',
      'status', 'type', 'description', 'grade', 'gradePercent', 'link'
    ];

    const changedFields = [];
    for (const field of compareFields) {
      const cachedValue = cached.canvasData[field];
      const newValue = newCanvasData[field];

      // Handle null/undefined equality and string comparison
      if (cachedValue !== newValue) {
        // Additional check for null vs empty string cases
        if (!(cachedValue == null && newValue === '') &&
            !(cachedValue === '' && newValue == null)) {
          changedFields.push(field);
        }
      }
    }

    return {
      needsUpdate: changedFields.length > 0,
      changedFields,
      cachedEntry: cached
    };
  }

  /**
   * Set the list of active course IDs for deletion detection
   * @param {Array<string>} courseIds - Array of active Canvas course IDs
   */
  setActiveCourses(courseIds) {
    this.activeCourseIds = new Set(courseIds.map(id => id.toString()));
  }

  /**
   * Identify and clean up assignments from inactive courses
   * @param {Array<string>} currentCanvasIds - Assignment IDs currently in Canvas
   * @returns {Object} { toDelete: Array, toRemove: Array } - Assignments to delete from Notion vs just remove from cache
   */
  async cleanupInactiveCourses(currentCanvasIds) {
    const currentSet = new Set(currentCanvasIds.map(id => id.toString()));
    const cachedEntries = await this.getAll();

    const toDelete = []; // Active course, assignment deleted - remove from Notion
    const toRemove = []; // Inactive course - keep in Notion, remove from cache

    for (const [key, entry] of Object.entries(cachedEntries)) {
      if (!key.startsWith('assignment:')) continue;

      const canvasId = key.replace('assignment:', '');

      // Skip if assignment still exists in Canvas
      if (currentSet.has(canvasId)) continue;

      // Assignment no longer in Canvas
      const courseId = entry.canvasData?.courseId;

      if (courseId && this.activeCourseIds.has(courseId.toString())) {
        // Course is still active, but assignment was deleted
        toDelete.push({
          canvasId,
          notionPageId: entry.notionPageId,
          courseId
        });
      } else {
        // Course is inactive (past enrollment)
        toRemove.push({
          canvasId,
          notionPageId: entry.notionPageId,
          courseId
        });
      }
    }

    return { toDelete, toRemove };
  }

  /**
   * Remove assignment from cache
   * @param {string} canvasId - Canvas assignment ID
   */
  async removeAssignment(canvasId) {
    const key = `assignment:${canvasId}`;
    await this.delete(key);
  }

  /**
   * Batch retrieve cached assignments
   * @param {Array<string>} canvasIds - Array of Canvas assignment IDs
   * @returns {Map<string, Object>} Map of canvasId to cached entry
   */
  async getBatch(canvasIds) {
    const results = new Map();

    for (const canvasId of canvasIds) {
      const cached = await this.getCachedAssignment(canvasId);
      if (cached) {
        results.set(canvasId, cached);
      }
    }

    return results;
  }

  /**
   * Get all cached assignments (for debugging/stats)
   * @returns {Array<Object>} Array of all cached assignment entries
   */
  async getAllAssignments() {
    const allEntries = await this.getAll();
    const assignments = [];

    for (const [key, entry] of Object.entries(allEntries)) {
      if (key.startsWith('assignment:')) {
        assignments.push({
          canvasId: key.replace('assignment:', ''),
          ...entry
        });
      }
    }

    return assignments;
  }

  /**
   * Get cache statistics
   * @returns {Object} Stats including count, size, hit rate
   */
  async getStats() {
    const baseStats = await super.getStats();
    const assignments = await this.getAllAssignments();

    const withNotionId = assignments.filter(a => a.notionPageId).length;
    const withoutNotionId = assignments.filter(a => !a.notionPageId).length;
    const activeCourseCount = this.activeCourseIds.size;

    return {
      ...baseStats,
      assignmentCount: assignments.length,
      withNotionMapping: withNotionId,
      withoutNotionMapping: withoutNotionId,
      activeCourses: activeCourseCount,
      version: this.version
    };
  }

  /**
   * Get all cached entries (raw format from base class)
   * @returns {Object} Map of all cached entries
   */
  async getAll() {
    const allEntries = {};
    for (const [key, entry] of this.cache.entries()) {
      // Check if not expired
      if (Date.now() < entry.expiresAt) {
        allEntries[key] = entry.value;
      }
    }
    return allEntries;
  }

  /**
   * Clear all cached assignments
   */
  async clearAll() {
    await super.clear();
    this.activeCourseIds.clear();
  }
}
