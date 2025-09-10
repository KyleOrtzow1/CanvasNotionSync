// Canvas-Notion Sync: API-Only Assignment Extractor
console.log('Canvas API-only assignment extractor loaded');

// Prevent multiple initialization
if (window.canvasNotionExtractorLoaded) {
  console.log('Canvas extractor already loaded, skipping...');
} else {
  window.canvasNotionExtractorLoaded = true;

class CanvasAPIExtractor {
  constructor() {
    this.canvasToken = null;
    this.baseURL = null;
    this.setupMessageListener();
    this.detectCanvasInstance();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch(request.type) {
        case 'EXTRACT_ASSIGNMENTS':
          this.extractAssignments()
            .then(assignments => sendResponse({ success: true, assignments }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
        case 'SET_CANVAS_TOKEN':
          this.canvasToken = request.token;
          console.log('Canvas API token set');
          break;
      }
    });
  }

  detectCanvasInstance() {
    // Extract Canvas base URL from current page
    const urlMatch = window.location.href.match(/(https:\/\/[^\/]+\.instructure\.com)/);
    if (urlMatch) {
      this.baseURL = urlMatch[1] + '/api/v1';
      console.log('Detected Canvas instance:', this.baseURL);
    }
  }

  async extractAssignments() {
    if (!this.baseURL) {
      throw new Error('Canvas instance not detected');
    }

    if (!this.canvasToken) {
      throw new Error('Canvas API token required. Please add your Canvas API token in the extension settings.');
    }

    console.log('Extracting assignments with Canvas API...');
    return await this.extractWithAPIToken();
  }

  async extractWithAPIToken() {
    console.log('Using Canvas API token for extraction...');
    
    try {
      // Get all courses for the user
      const courses = await this.makeAPICall('/courses', {
        'enrollment_state': 'active',
        'per_page': 100
      });

      console.log(`Found ${courses.length} active courses`);

      // Get assignments from all courses
      const allAssignments = [];
      
      for (const course of courses) {
        try {
          const assignments = await this.makeAPICall(`/courses/${course.id}/assignments`, {
            'per_page': 100,
            'order_by': 'due_at',
            'include': 'submission'
          });

          console.log(`Found ${assignments.length} assignments in ${course.name}`);

          // Transform to our format and fetch grades
          const transformedAssignments = [];
          for (const assignment of assignments) {
            let grade = null;
            let gradePercent = null;
            let submissionStatus = 'Not Started';

            // Get submission data if available
            if (assignment.submission) {
              const submission = assignment.submission;
              if (submission.grade) {
                grade = submission.grade;
              }
              if (submission.score && assignment.points_possible) {
                gradePercent = Math.round((submission.score / assignment.points_possible) * 100);
              }
              submissionStatus = this.getSubmissionStatus(submission);
            } else {
              // Try to get submission separately if not included
              try {
                const submission = await this.makeAPICall(`/courses/${course.id}/assignments/${assignment.id}/submissions/self`);
                if (submission.grade) {
                  grade = submission.grade;
                }
                if (submission.score && assignment.points_possible) {
                  gradePercent = Math.round((submission.score / assignment.points_possible) * 100);
                }
                submissionStatus = this.getSubmissionStatus(submission);
              } catch (error) {
                console.warn(`Could not fetch submission for assignment ${assignment.name}:`, error);
              }
            }

            transformedAssignments.push({
              title: assignment.name,
              course: course.name,
              courseCode: course.course_code,
              dueDate: assignment.due_at,
              points: assignment.points_possible,
              canvasId: assignment.id.toString(),
              link: assignment.html_url,
              status: submissionStatus,
              type: assignment.submission_types?.join(', ') || 'Assignment',
              description: assignment.description,
              grade: grade,
              gradePercent: gradePercent,
              source: 'canvas_api'
            });
          }

          allAssignments.push(...transformedAssignments);
        } catch (error) {
          console.warn(`Failed to get assignments for course ${course.name}:`, error);
        }
      }

      console.log(`Total assignments extracted via API: ${allAssignments.length}`);
      return allAssignments;

    } catch (error) {
      console.error('API extraction failed:', error);
      throw error;
    }
  }

  async makeAPICall(endpoint, params = {}) {
    try {
      const url = new URL(this.baseURL + endpoint);
      
      // Add parameters
      Object.keys(params).forEach(key => {
        url.searchParams.append(key, params[key]);
      });

      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.canvasToken}`
      };

      console.log('Making API call to:', url.toString());

      // Create a safe fetch function to avoid illegal invocation
      const safeFetch = (() => {
        const originalFetch = window.fetch;
        return function(...args) {
          return originalFetch.apply(window, args);
        };
      })();

      const response = await safeFetch(url.toString(), {
        method: 'GET',
        headers: headers,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Canvas API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`API call successful, received ${Array.isArray(data) ? data.length : 1} items`);
      return data;

    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
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
function addSyncButton() {
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
}

// Add button after page loads
setTimeout(addSyncButton, 2000);

console.log('Canvas API-only extraction initialized');

} // End of initialization block