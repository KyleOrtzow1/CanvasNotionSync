// Canvas-Notion Sync: API-Only Assignment Extractor
/* global CanvasRateLimiter, CanvasValidator, getUserFriendlyCanvasError, Debug */

// Prevent multiple initialization
if (!window.canvasNotionExtractorLoaded) {
  window.canvasNotionExtractorLoaded = true;

Debug.init();

// Sanitize HTML from Canvas API descriptions to safe plain text (XSS prevention)
const sanitizeHTML = (html) => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').trim();
};

class CanvasAPIExtractor {
  constructor() {
    this.canvasToken = null;
    this.baseURL = null;
    this.forceRefresh = false;
    this.rateLimiter = new CanvasRateLimiter();
    this.parallelBatchSize = 3;
    this.parallelBatchDelayMs = 500;
    this.extractionProgressIntervalMs = 300;
    this.lastExtractionProgressWrite = 0;
    this.pendingExtractionProgress = null;
    this.pendingExtractionProgressTimer = null;
    this.setupMessageListener();
    this.detectCanvasInstance();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch(request.type) {
        case 'EXTRACT_ASSIGNMENTS':
          this.forceRefresh = request.forceRefresh || false;
          this.extractAssignments()
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
        case 'SET_CANVAS_TOKEN':
          this.canvasToken = request.token;
          break;
      }
    });
  }

  detectCanvasInstance() {
    // Extract Canvas base URL from current page
    const urlMatch = window.location.href.match(/(https:\/\/[^/]+\.instructure\.com)/);
    if (urlMatch) {
      this.baseURL = urlMatch[1] + '/api/v1';
    }
  }

  extractCourseInfo(courseCode) {
    // Extract department and number from course codes like "2257-CSC-413-02-1-1639"
    // Pattern: Look for letters followed by digits (e.g., CSC 413)
    const match = courseCode.match(/([A-Z]{2,4})-?(\d{3,4})/i);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
    // Fallback: return the original course code if pattern doesn't match
    return courseCode;
  }

  async extractAssignments() {
    if (!this.baseURL) {
      throw new Error('Canvas instance not detected');
    }

    if (!this.canvasToken) {
      throw new Error('Canvas API token required. Please add your Canvas API token in the extension settings.');
    }

    return await this.extractWithAPIToken();
  }

  async extractWithAPIToken() {

    try {
      // Try to get cached courses first
      let courses = null;
      if (!this.forceRefresh) {
        try {
          const cacheResponse = await chrome.runtime.sendMessage({
            action: 'GET_CANVAS_CACHE',
            key: 'canvas:courses:list'
          });
          if (cacheResponse?.data) {
            courses = cacheResponse.data;
          }
        } catch (error) {
          // Cache unavailable, will fetch fresh
        }
      }

      // Fetch fresh if no cache or force refresh
      if (!courses) {
        courses = await this.makeAPICall('/courses', {
          'enrollment_state': 'active',
          'per_page': 100
        }, 10);

        // Cache the courses
        try {
          await chrome.runtime.sendMessage({
            action: 'SET_CANVAS_CACHE',
            key: 'canvas:courses:list',
            data: courses,
            ttl: 10 * 60 * 1000 // 10 minutes
          });
        } catch (error) {
          // Cache storage failed, non-critical
        }
      }


      // Get assignments from all courses
      const activeCourseIds = courses.map(c => c.id.toString());
      const totalCourses = courses.length;
      await this.updateExtractionProgress({ current: 0, total: totalCourses, errorCount: 0 }, true);

      const { assignments: allAssignments, extractionErrors } = await this.processCoursesBatch(courses, {
        batchSize: this.parallelBatchSize,
        batchDelayMs: this.parallelBatchDelayMs,
        onProgress: async (progress) => {
          await this.updateExtractionProgress(progress);
        }
      });

      await this.updateExtractionProgress({
        current: totalCourses,
        total: totalCourses,
        errorCount: extractionErrors.length
      }, true);

      return {
        assignments: allAssignments,
        activeCourseIds: activeCourseIds,
        extractionErrors: extractionErrors
      };

    } catch (error) {
      Debug.error('API extraction failed:', error.message);
      if (typeof getUserFriendlyCanvasError === 'function') {
        const friendly = getUserFriendlyCanvasError(error);
        const friendlyError = new Error(`${friendly.title}: ${friendly.message} ${friendly.action}`);
        friendlyError.status = error.status;
        throw friendlyError;
      }
      throw error;
    }
  }

  safeCourseCode(course) {
    if (typeof course?.course_code === 'string' && course.course_code.trim().length > 0) {
      return course.course_code.trim();
    }
    return `Course ${course?.id ?? 'Unknown'}`;
  }

  async processCoursesBatch(courses, options = {}) {
    const batchSize = options.batchSize || this.parallelBatchSize;
    const batchDelayMs = options.batchDelayMs ?? this.parallelBatchDelayMs;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    const allAssignments = [];
    const extractionErrors = [];
    const total = courses.length;
    let completed = 0;
    let errorCount = 0;

    if (onProgress) {
      try {
        await onProgress({ current: 0, total: total, errorCount: 0 });
      } catch (error) {
        // Progress reporting failures are non-critical
      }
    }

    for (let i = 0; i < courses.length; i += batchSize) {
      const batch = courses.slice(i, i + batchSize);
      const settled = await Promise.allSettled(batch.map(course => this.processSingleCourse(course)));

      for (let j = 0; j < settled.length; j++) {
        const settledResult = settled[j]; // eslint-disable-line security/detect-object-injection -- j bounded by settled.length in loop
        const course = batch[j]; // eslint-disable-line security/detect-object-injection -- j bounded by batch.length in loop
        const fallbackCourseId = course?.id ? course.id.toString() : 'unknown';
        const fallbackCourseCode = this.safeCourseCode(course);

        if (settledResult.status === 'fulfilled' && settledResult.value?.ok) {
          if (Array.isArray(settledResult.value.assignments)) {
            allAssignments.push(...settledResult.value.assignments);
          }
        } else {
          errorCount++;
          extractionErrors.push({
            courseId: settledResult.value?.courseId || fallbackCourseId,
            courseCode: settledResult.value?.courseCode || fallbackCourseCode,
            error: settledResult.status === 'rejected'
              ? (settledResult.reason?.message || String(settledResult.reason))
              : (settledResult.value?.error || 'Failed to process course assignments')
          });
        }

        completed++;
        if (onProgress) {
          try {
            await onProgress({
              current: completed,
              total: total,
              errorCount: errorCount,
              currentCourse: fallbackCourseCode
            });
          } catch (error) {
            // Progress reporting failures are non-critical
          }
        }
      }

      if (i + batchSize < courses.length) {
        await this.delay(batchDelayMs);
      }
    }

    return { assignments: allAssignments, extractionErrors: extractionErrors };
  }

  async processSingleCourse(course) {
    const courseId = course?.id ? course.id.toString() : 'unknown';
    const courseCode = this.safeCourseCode(course);

    try {
      // Try to get cached assignments first
      let assignments = null;
      if (!this.forceRefresh) {
        try {
          const cacheResponse = await chrome.runtime.sendMessage({
            action: 'GET_CANVAS_CACHE',
            key: `canvas:course:${course.id}:assignments`
          });
          if (cacheResponse?.data) {
            assignments = cacheResponse.data;
          }
        } catch (error) {
          // Cache unavailable, will fetch fresh
        }
      }

      // Fetch fresh if no cache or force refresh
      if (!assignments) {
        assignments = await this.makeAPICall(`/courses/${course.id}/assignments`, {
          'per_page': 100,
          'order_by': 'due_at',
          'include': 'submission'
        }, 50);

        // Cache the assignments
        try {
          await chrome.runtime.sendMessage({
            action: 'SET_CANVAS_CACHE',
            key: `canvas:course:${course.id}:assignments`,
            data: assignments,
            ttl: 5 * 60 * 1000 // 5 minutes
          });
        } catch (error) {
          // Cache storage failed, non-critical
        }
      }

      const transformedAssignments = this.transformAssignmentsForCourse(course, assignments);
      return {
        ok: true,
        courseId: courseId,
        courseCode: courseCode,
        assignments: transformedAssignments
      };
    } catch (error) {
      Debug.warn(`Failed to fetch Canvas assignments for ${courseCode}:`, error.message || error);
      return {
        ok: false,
        courseId: courseId,
        courseCode: courseCode,
        error: error.message || 'Failed to process course assignments'
      };
    }
  }

  transformAssignmentsForCourse(course, assignments) {
    const transformedAssignments = [];
    const courseCode = this.safeCourseCode(course);
    const courseId = course?.id ? course.id.toString() : 'unknown';

    for (const assignment of assignments || []) {
      // Validate Canvas assignment data
      const { valid, validated, warnings } = CanvasValidator.validateAssignment(assignment);
      if (!valid) {
        continue; // Skip entirely invalid assignments
      }
      if (warnings.length > 0) {
        Debug.warn(`Canvas validation warnings for assignment ${validated.id}:`, warnings);
      }

      let grade = null;
      let gradePercent = null;
      let submissionStatus = 'Not Started';

      // Get submission data if available (included via ?include=submission)
      if (validated.submission) {
        const submission = validated.submission;
        if (submission.grade) {
          grade = submission.grade;
        }
        if (submission.score && validated.points_possible) {
          gradePercent = Math.round((submission.score / validated.points_possible) * 100);
        }
        submissionStatus = this.getSubmissionStatus(submission);
      }

      transformedAssignments.push({
        title: validated.name,
        course: this.extractCourseInfo(courseCode),
        courseCode: courseCode,
        courseId: courseId,
        dueDate: validated.due_at,
        points: validated.points_possible,
        canvasId: validated.id.toString(),
        link: validated.html_url,
        status: submissionStatus,
        type: validated.submission_types?.join(', ') || 'Assignment',
        description: sanitizeHTML(validated.description),
        grade: grade,
        gradePercent: gradePercent,
        source: 'canvas_api'
      });
    }

    return transformedAssignments;
  }

  buildExtractionProgressPayload(state) {
    const payload = {
      active: true,
      phase: 'extracting',
      current: state.current || 0,
      total: state.total || 0,
      errorCount: state.errorCount || 0
    };

    if (state.currentCourse) {
      payload.currentTitle = state.currentCourse;
    }

    return payload;
  }

  async updateExtractionProgress(state, force = false) {
    if (!chrome?.storage?.local?.set) {
      return;
    }

    const payload = this.buildExtractionProgressPayload(state);
    const now = Date.now();
    const elapsed = now - this.lastExtractionProgressWrite;
    const shouldWriteNow = force || elapsed >= this.extractionProgressIntervalMs;

    if (shouldWriteNow) {
      if (this.pendingExtractionProgressTimer) {
        clearTimeout(this.pendingExtractionProgressTimer);
        this.pendingExtractionProgressTimer = null;
      }
      this.pendingExtractionProgress = null;
      try {
        await chrome.storage.local.set({ sync_progress: payload });
        this.lastExtractionProgressWrite = Date.now();
      } catch (error) {
        // Progress reporting failures are non-critical
      }
      return;
    }

    this.pendingExtractionProgress = payload;
    if (!this.pendingExtractionProgressTimer) {
      const waitMs = this.extractionProgressIntervalMs - elapsed;
      this.pendingExtractionProgressTimer = setTimeout(() => {
        this.pendingExtractionProgressTimer = null;
        const pendingPayload = this.pendingExtractionProgress;
        this.pendingExtractionProgress = null;
        if (pendingPayload) {
          chrome.storage.local.set({ sync_progress: pendingPayload })
            .then(() => {
              this.lastExtractionProgressWrite = Date.now();
            })
            .catch(() => {
              // Progress reporting failures are non-critical
            });
        }
      }, Math.max(0, waitMs));
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  parseLinkHeader(linkHeader) {
    if (!linkHeader) return {};
    const links = {};
    const parts = linkHeader.split(',');
    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        links[match[2]] = match[1];
      }
    }
    return links;
  }

  async makeSingleAPICall(endpoint, params = {}) {
    return this.rateLimiter.execute(async () => {
      const url = new URL(this.baseURL + endpoint);

      Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]); // eslint-disable-line security/detect-object-injection -- key from Object.keys()
      });

      return await this._fetchWithHeaders(url.toString());
    });
  }

  async makeSingleAPICallByURL(fullUrl) {
    return this.rateLimiter.execute(async () => {
      return await this._fetchWithHeaders(fullUrl);
    });
  }

  async _fetchWithHeaders(urlString) {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.canvasToken}`
    };

    // Create a safe fetch function to avoid illegal invocation
    const safeFetch = (() => {
      const originalFetch = window.fetch;
      return function(...args) {
        return originalFetch.apply(window, args);
      };
    })();

    const response = await safeFetch(urlString, {
      method: 'GET',
      headers: headers,
      credentials: 'include'
    });

    // Update rate limiter bucket from response headers
    this.rateLimiter.updateFromHeaders(response.headers);

    if (response.status === 403) {
      const errorText = await response.text();
      const error = new Error(`Canvas API error: 403 Forbidden - ${errorText}`);
      error.status = 403;
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Canvas API error: ${response.status} ${response.statusText} - ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    const linkHeader = response.headers.get('Link');
    return { data, links: this.parseLinkHeader(linkHeader) };
  }

  async makeAPICall(endpoint, params = {}, maxPages = 10) {
    let allResults = [];

    // First page
    let result = await this.makeSingleAPICall(endpoint, params);
    allResults = allResults.concat(result.data);
    let pageCount = 1;

    // Follow "next" links for subsequent pages
    while (result.links.next && pageCount < maxPages) {
      result = await this.makeSingleAPICallByURL(result.links.next);
      allResults = allResults.concat(result.data);
      pageCount++;
    }

    return allResults;
  }

  getAssignmentStatus(assignment) {
    if (assignment.has_submitted_submissions) {
      return 'Submitted';
    }
    if (assignment.due_at && new Date(assignment.due_at) < new Date()) {
      return 'Overdue';
    }
    return 'Not Started';
  }

  getSubmissionStatus(submission) {
    if (!submission) return 'Not Started';
    
    switch (submission.workflow_state) {
      case 'submitted':
        if (submission.grade) {
          return 'Graded';
        }
        return 'Submitted';
      case 'graded':
        return 'Graded';
      case 'pending_review':
        return 'Pending Review';
      case 'unsubmitted':
        if (submission.late) {
          return 'Late';
        }
        return 'Not Started';
      default:
        return 'Not Started';
    }
  }

  async syncAssignments(assignments) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SYNC_ASSIGNMENTS',
        assignments: assignments
      });

      if (response.success) {
        this.showNotification(`✅ Synced ${assignments.length} assignments to Notion`);
      } else {
        this.showNotification('❌ Sync failed: ' + response.error, 'error');
      }
    } catch (error) {
      this.showNotification('❌ Sync failed: ' + error.message, 'error');
    }
  }

  showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#d32f2f' : '#2e7d32'};
      color: white;
      padding: 12px 24px;
      border-radius: 4px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      font-family: sans-serif;
      font-size: 14px;
      max-width: 300px;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }
}

if (typeof globalThis !== 'undefined' && typeof globalThis.CanvasAPIExtractor === 'undefined') {
  globalThis.CanvasAPIExtractor = CanvasAPIExtractor;
}

// Initialize the API extractor
const apiExtractor = new CanvasAPIExtractor();

// Add sync button to Canvas header
const addSyncButton = () => {
  if (document.querySelector('#canvas-notion-sync-btn')) return;

  const header = document.querySelector('#header, .ic-app-header, .enhanced_header');
  if (header) {
    const syncBtn = document.createElement('button');
    syncBtn.id = 'canvas-notion-sync-btn';
    syncBtn.textContent = '🔄 Sync to Notion';
    syncBtn.style.cssText = `
      background: #1976d2;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-left: 10px;
      font-size: 14px;
      font-weight: 500;
    `;

    syncBtn.addEventListener('click', async () => {
      syncBtn.textContent = '⏳ Syncing...';
      syncBtn.disabled = true;

      try {
        const assignments = await apiExtractor.extractAssignments();
        if (assignments.length > 0) {
          await apiExtractor.syncAssignments(assignments);
        } else {
          apiExtractor.showNotification('No assignments found', 'warning');
        }
      } catch (error) {
        apiExtractor.showNotification('Sync failed: ' + error.message, 'error');
      } finally {
        syncBtn.textContent = '🔄 Sync to Notion';
        syncBtn.disabled = false;
      }
    });

    header.appendChild(syncBtn);
  }
};

// Add button after page loads
setTimeout(addSyncButton, 2000);

// Listen for real-time sync progress and update button text
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.sync_progress) return;
  const btn = document.querySelector('#canvas-notion-sync-btn');
  if (!btn) return;

  const p = changes.sync_progress.newValue;
  if (!p) return;

  if (p.active) {
    btn.disabled = true;
    switch (p.phase) {
      case 'extracting': {
        if (p.total > 0) {
          btn.textContent = `Extracting ${p.current}/${p.total}...`;
        } else {
          btn.textContent = 'Extracting...';
        }
        break;
      }
      case 'reconciling':
        btn.textContent = 'Reconciling...';
        break;
      case 'syncing': {
        const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
        btn.textContent = `Syncing ${p.current}/${p.total} (${pct}%)`;
        break;
      }
      case 'cleanup':
        btn.textContent = 'Cleaning up...';
        break;
      case 'complete': {
        const msg = p.errorCount > 0
          ? `Done (${p.errorCount} errors)`
          : 'Sync complete!';
        btn.textContent = msg;
        setTimeout(() => {
          btn.textContent = 'Sync to Notion';
          btn.disabled = false;
        }, 3000);
        break;
      }
      case 'error':
        btn.textContent = 'Sync failed';
        setTimeout(() => {
          btn.textContent = 'Sync to Notion';
          btn.disabled = false;
        }, 3000);
        break;
    }
  }
});


} // End of initialization block
