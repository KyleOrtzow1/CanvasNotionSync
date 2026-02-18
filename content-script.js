// Canvas-Notion Sync: API-Only Assignment Extractor
/* global CanvasRateLimiter, CanvasValidator, getUserFriendlyCanvasError */

// Prevent multiple initialization
if (!window.canvasNotionExtractorLoaded) {
  window.canvasNotionExtractorLoaded = true;

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
      const allAssignments = [];
      const activeCourseIds = courses.map(c => c.id.toString());

      for (const course of courses) {
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


          // Transform to our format and fetch grades
          const transformedAssignments = [];
          for (const assignment of assignments) {
            // Validate Canvas assignment data
            const { valid, validated, warnings } = CanvasValidator.validateAssignment(assignment);
            if (!valid) {
              continue; // Skip entirely invalid assignments
            }
            if (warnings.length > 0) {
              console.warn(`Canvas validation warnings for assignment ${validated.id}:`, warnings);
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
              course: this.extractCourseInfo(course.course_code),
              courseCode: course.course_code,
              courseId: course.id.toString(),
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

          allAssignments.push(...transformedAssignments);
        } catch (error) {
          // Course assignments could not be fetched, continue with next course
        }
      }

      return {
        assignments: allAssignments,
        activeCourseIds: activeCourseIds
      };

    } catch (error) {
      console.error('API extraction failed:', error.message);
      if (typeof getUserFriendlyCanvasError === 'function') {
        const friendly = getUserFriendlyCanvasError(error);
        const friendlyError = new Error(`${friendly.title}: ${friendly.message} ${friendly.action}`);
        friendlyError.status = error.status;
        throw friendlyError;
      }
      throw error;
    }
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
        url.searchParams.append(key, params[key]);
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


} // End of initialization block