import { CacheManager } from './cache-manager.js';

/**
 * Canvas-specific cache manager with rate limit monitoring
 * @class CanvasCacheManager
 * @extends CacheManager
 */
export class CanvasCacheManager extends CacheManager {
  constructor() {
    super({
      maxMemorySize: 100,
      defaultTTL: 5 * 60 * 1000, // 5 minutes default
      enablePersistence: false, // Canvas cache doesn't need persistence (changes frequently)
      storageKey: 'canvas_cache'
    });

    // Rate limit tracking
    this.rateLimitInfo = {
      remaining: null,
      cost: null,
      lastUpdate: null,
      warningThreshold: 20, // Warn when < 20 requests remaining
      blockThreshold: 10     // Block when < 10 requests remaining
    };

    // TTL strategies for different Canvas data types
    this.ttlStrategies = {
      courses: 10 * 60 * 1000,      // 10 minutes (rarely change)
      assignments: 5 * 60 * 1000,   // 5 minutes (moderate changes)
      submissions: 2 * 60 * 1000    // 2 minutes (frequent changes)
    };
  }

  /**
   * Cache assignments for a specific course
   * @param {string} courseId - Canvas course ID
   * @param {Array} assignments - Array of assignment objects
   * @param {number} ttl - Optional TTL override
   */
  async cacheAssignments(courseId, assignments, ttl = null) {
    const key = `canvas:course:${courseId}:assignments`;
    const actualTTL = ttl || this.ttlStrategies.assignments;
    await this.set(key, assignments, actualTTL);
  }

  /**
   * Get cached assignments for a specific course
   * @param {string} courseId - Canvas course ID
   * @returns {Array|null} Cached assignments or null
   */
  async getCachedAssignments(courseId) {
    const key = `canvas:course:${courseId}:assignments`;
    return await this.get(key);
  }

  /**
   * Cache courses list
   * @param {Array} courses - Array of course objects
   * @param {number} ttl - Optional TTL override
   */
  async cacheCourses(courses, ttl = null) {
    const key = 'canvas:courses:list';
    const actualTTL = ttl || this.ttlStrategies.courses;
    await this.set(key, courses, actualTTL);
  }

  /**
   * Get cached courses list
   * @returns {Array|null} Cached courses or null
   */
  async getCachedCourses() {
    const key = 'canvas:courses:list';
    return await this.get(key);
  }

  /**
   * Cache submission for a specific assignment
   * @param {string} assignmentId - Canvas assignment ID
   * @param {Object} submission - Submission object
   * @param {number} ttl - Optional TTL override
   */
  async cacheSubmission(assignmentId, submission, ttl = null) {
    const key = `canvas:assignment:${assignmentId}:submission`;
    const actualTTL = ttl || this.ttlStrategies.submissions;
    await this.set(key, submission, actualTTL);
  }

  /**
   * Get cached submission for a specific assignment
   * @param {string} assignmentId - Canvas assignment ID
   * @returns {Object|null} Cached submission or null
   */
  async getCachedSubmission(assignmentId) {
    const key = `canvas:assignment:${assignmentId}:submission`;
    return await this.get(key);
  }

  /**
   * Update rate limit information from Canvas API response headers
   * @param {Object} info - Rate limit info from headers
   * @param {string} info.remaining - X-Rate-Limit-Remaining header value
   * @param {string} info.cost - X-Request-Cost header value
   */
  async updateRateLimitInfo(info) {
    if (info.remaining !== null && info.remaining !== undefined) {
      this.rateLimitInfo.remaining = parseInt(info.remaining, 10);
    }
    if (info.cost !== null && info.cost !== undefined) {
      this.rateLimitInfo.cost = parseFloat(info.cost);
    }
    this.rateLimitInfo.lastUpdate = Date.now();

    // Log warnings if approaching rate limit
    if (this.rateLimitInfo.remaining !== null) {
      if (this.rateLimitInfo.remaining < this.rateLimitInfo.blockThreshold) {
        console.error(`🚨 Canvas rate limit critical: ${this.rateLimitInfo.remaining} requests remaining`);
      } else if (this.rateLimitInfo.remaining < this.rateLimitInfo.warningThreshold) {
        console.warn(`⚠️ Canvas rate limit warning: ${this.rateLimitInfo.remaining} requests remaining`);
      }
    }
  }

  /**
   * Get current rate limit information
   * @returns {Object} Rate limit info
   */
  getRateLimitInfo() {
    return { ...this.rateLimitInfo };
  }

  /**
   * Check if it's safe to make an API request
   * @returns {boolean} True if safe to make request
   */
  canMakeRequest() {
    if (this.rateLimitInfo.remaining === null) {
      // No rate limit info yet, assume safe
      return true;
    }

    return this.rateLimitInfo.remaining >= this.rateLimitInfo.blockThreshold;
  }

  /**
   * Wait for rate limit to reset (if needed)
   * @returns {Promise<void>}
   */
  async waitForRateLimit() {
    if (this.canMakeRequest()) {
      return;
    }

    console.log('⏳ Waiting 60 seconds for Canvas rate limit to reset...');
    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
    console.log('✅ Rate limit wait complete');
  }

  /**
   * Invalidate all Canvas cache (for manual sync)
   */
  async invalidateOnManualSync() {
    await this.invalidate('canvas:*');
    console.log('🗑️ All Canvas cache invalidated for manual sync');
  }

  /**
   * Get cache statistics with rate limit info
   * @returns {Object} Enhanced statistics
   */
  getStats() {
    const baseStats = super.getStats();
    return {
      ...baseStats,
      rateLimit: this.getRateLimitInfo()
    };
  }
}
