// Canvas API-Based Assignment Extraction - Fixed Version
console.log('Canvas API-based assignment extractor loaded');

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

    console.log('Extracting assignments with Canvas API...');
    
    // Try to get assignments with API token
    if (this.canvasToken) {
      return await this.extractWithAPIToken();
    } else {
      return await this.extractWithoutToken();
    }
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
            'order_by': 'due_at'
          });

          console.log(`Found ${assignments.length} assignments in ${course.name}`);

          // Transform to our format
          const transformedAssignments = assignments.map(assignment => ({
            title: assignment.name,
            course: course.name,
            courseCode: course.course_code,
            dueDate: assignment.due_at,
            points: assignment.points_possible,
            canvasId: assignment.id.toString(),
            link: assignment.html_url,
            status: this.getAssignmentStatus(assignment),
            type: assignment.submission_types?.join(', ') || 'Assignment',
            description: assignment.description,
            source: 'canvas_api'
          }));

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

  async extractWithoutToken() {
    console.log('Attempting to extract without API token...');
    
    // Fallback to extracting from intercepted data or DOM
    const interceptedAssignments = this.getInterceptedAssignments();
    if (interceptedAssignments.length > 0) {
      console.log(`Found ${interceptedAssignments.length} assignments from intercepted data`);
      return interceptedAssignments;
    }
    
    // Final fallback to minimal DOM extraction
    return this.extractMinimalFromDOM();
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
        'Content-Type': 'application/json'
      };

      if (this.canvasToken) {
        headers['Authorization'] = `Bearer ${this.canvasToken}`;
      }

      console.log('Making API call to:', url.toString());

      // Use a bound fetch to avoid illegal invocation
      const boundFetch = window.fetch.bind(window);
      const response = await boundFetch(url.toString(), {
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

  getInterceptedAssignments() {
    return window.interceptedAssignments || [];
  }

  extractMinimalFromDOM() {
    console.log('Falling back to minimal DOM extraction...');
    
    const assignments = [];
    const plannerItems = document.querySelectorAll('.planner-item');
    
    plannerItems.forEach((item, index) => {
      try {
        const link = item.querySelector('a[href*="/assignments/"]');
        if (link) {
          const canvasId = this.extractCanvasIdFromLink(link.href);
          const title = link.textContent?.trim();
          
          if (title && canvasId) {
            assignments.push({
              title: title,
              course: this.extractCourseFromDOM(item),
              dueDate: null,
              points: null,
              canvasId: canvasId,
              link: link.href,
              status: 'Unknown',
              type: 'Assignment',
              source: 'dom_fallback'
            });
          }
        }
      } catch (error) {
        console.warn(`Error parsing planner item ${index}:`, error);
      }
    });

    console.log(`DOM fallback found ${assignments.length} assignments`);
    return assignments;
  }

  extractCanvasIdFromLink(href) {
    const match = href.match(/\/assignments\/(\d+)/);
    return match ? match[1] : null;
  }

  extractCourseFromDOM(element) {
    const text = element.textContent;
    const courseMatch = text.match(/([A-Z]{2,4}\s+\d{3}(?:\s*-\s*\d{2})?)/);
    return courseMatch ? courseMatch[1] : null;
  }
}

// Simple network interception for Canvas API calls
window.interceptedAssignments = [];

// Store original fetch
const originalFetch = window.fetch;

window.fetch = function(...args) {
  const url = args[0];
  
  if (typeof url === 'string' && url.includes('/api/v1/')) {
    return originalFetch.apply(this, args).then(response => {
      // Clone response to avoid consuming it
      const clonedResponse = response.clone();
      
      // Process intercepted data
      clonedResponse.json().then(data => {
        try {
          // Intercept planner items
          if (url.includes('/planner/items') && Array.isArray(data)) {
            console.log(`Intercepted ${data.length} planner items`);
            const assignments = data
              .filter(item => item.plannable_type === 'Assignment')
              .map(item => ({
                title: item.plannable.title,
                course: item.context_name,
                dueDate: item.plannable.due_at,
                points: item.plannable.points_possible,
                canvasId: item.plannable.id?.toString(),
                link: item.html_url,
                status: 'Unknown',
                type: 'Assignment',
                source: 'planner_api'
              }));
            
            window.interceptedAssignments = assignments;
          }
          
          // Intercept assignments
          if (url.includes('/assignments') && Array.isArray(data)) {
            console.log(`Intercepted ${data.length} assignments`);
            // Store for potential use
            window.interceptedAssignments = window.interceptedAssignments.concat(
              data.map(assignment => ({
                title: assignment.name,
                course: 'Unknown',
                dueDate: assignment.due_at,
                points: assignment.points_possible,
                canvasId: assignment.id?.toString(),
                link: assignment.html_url,
                status: 'Unknown',
                type: 'Assignment',
                source: 'intercepted_api'
              }))
            );
          }
        } catch (error) {
          // Ignore JSON parsing errors
        }
      }).catch(() => {
        // Ignore errors
      });
      
      return response;
    });
  }
  
  return originalFetch.apply(this, args);
};

// Main extractor class
class EnhancedCanvasExtractor {
  constructor() {
    this.apiExtractor = new CanvasAPIExtractor();
    this.setupMessageListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch(request.type) {
        case 'EXTRACT_ASSIGNMENTS':
          this.extractAllAssignments()
            .then(assignments => sendResponse({ success: true, assignments }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
        case 'SET_CANVAS_TOKEN':
          this.apiExtractor.canvasToken = request.token;
          console.log('Canvas token set for API extractor');
          break;
      }
    });
  }

  async extractAllAssignments() {
    console.log('Starting comprehensive assignment extraction...');
    
    try {
      // Try API extraction first
      const assignments = await this.apiExtractor.extractAssignments();
      
      // Remove duplicates by Canvas ID
      const uniqueAssignments = this.deduplicateAssignments(assignments);
      
      console.log(`Final result: ${uniqueAssignments.length} unique assignments`);
      return uniqueAssignments;
      
    } catch (error) {
      console.error('Assignment extraction failed:', error);
      throw error;
    }
  }

  deduplicateAssignments(assignments) {
    const seen = new Set();
    return assignments.filter(assignment => {
      const key = assignment.canvasId || assignment.title;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async syncAssignments(assignments) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SYNC_ASSIGNMENTS',
        assignments: assignments
      });

      if (response.success) {
        this.showNotification(`Synced ${assignments.length} assignments`);
      } else {
        this.showNotification('Sync failed: ' + response.error, 'error');
      }
    } catch (error) {
      this.showNotification('Sync failed: ' + error.message, 'error');
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

// Initialize the enhanced extractor
const enhancedExtractor = new EnhancedCanvasExtractor();

// Add sync button
function addAPIBasedSyncButton() {
  if (document.querySelector('#canvas-notion-api-sync-btn')) return;
  
  const header = document.querySelector('#header, .ic-app-header, .enhanced_header');
  if (header) {
    const syncBtn = document.createElement('button');
    syncBtn.id = 'canvas-notion-api-sync-btn';
    syncBtn.textContent = 'API Sync to Notion';
    syncBtn.style.cssText = `
      background: #1976d2;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-left: 10px;
      font-size: 14px;
    `;
    
    syncBtn.addEventListener('click', async () => {
      syncBtn.textContent = 'API Syncing...';
      syncBtn.disabled = true;
      
      try {
        const assignments = await enhancedExtractor.extractAllAssignments();
        if (assignments.length > 0) {
          await enhancedExtractor.syncAssignments(assignments);
        } else {
          enhancedExtractor.showNotification('No assignments found via API');
        }
      } catch (error) {
        enhancedExtractor.showNotification('API sync failed: ' + error.message, 'error');
      } finally {
        syncBtn.textContent = 'API Sync to Notion';
        syncBtn.disabled = false;
      }
    });
    
    header.appendChild(syncBtn);
  }
}

setTimeout(addAPIBasedSyncButton, 3000);

console.log('Canvas API-based extraction initialized');