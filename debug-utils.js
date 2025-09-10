// Debug and Testing Utilities for Canvas-Notion Sync
// Run these functions in browser console for testing

// Test Canvas assignment extraction without sync
window.testCanvasExtraction = async function() {
  console.log('🔍 Testing Canvas assignment extraction...');
  
  const extractor = new CanvasAssignmentExtractor();
  const assignments = await extractor.extractAssignments();
  
  console.log(`📋 Found ${assignments.length} assignments:`);
  assignments.forEach((assignment, index) => {
    console.log(`${index + 1}. ${assignment.title}`);
    console.log(`   Course: ${assignment.course || 'Unknown'}`);
    console.log(`   Due: ${assignment.dueDate || 'No due date'}`);
    console.log(`   Status: ${assignment.status || 'Unknown'}`);
    console.log(`   Points: ${assignment.points || 'N/A'}`);
    console.log(`   Canvas ID: ${assignment.canvasId || 'N/A'}`);
    console.log(`   Source: ${assignment.source}`);
    console.log('   ---');
  });
  
  return assignments;
};

// Test Notion API connection
window.testNotionConnection = async function(token, databaseId) {
  console.log('🔗 Testing Notion API connection...');
  
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({})
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Notion connection successful!');
      console.log(`📊 Database has ${data.results.length} existing entries`);
      return { success: true, data };
    } else {
      const error = await response.text();
      console.error('❌ Notion connection failed:', response.status, error);
      return { success: false, error };
    }
  } catch (error) {
    console.error('❌ Connection error:', error);
    return { success: false, error: error.message };
  }
};

// Create a test assignment in Notion
window.createTestAssignment = async function(token, databaseId) {
  console.log('📝 Creating test assignment in Notion...');
  
  const testAssignment = {
    "Assignment Name": {
      title: [{ text: { content: "Test Assignment from Extension" } }]
    },
    "Course": {
      rich_text: [{ text: { content: "Test Course" } }]
    },
    "Due Date": {
      date: { start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }
    },
    "Status": {
      rich_text: [{ text: { content: "Not Started" } }]
    },
    "Canvas ID": {
      rich_text: [{ text: { content: "test-" + Date.now() } }]
    }
  };

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: testAssignment
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Test assignment created successfully!');
      console.log('🔗 Assignment URL:', data.url);
      return { success: true, data };
    } else {
      const error = await response.text();
      console.error('❌ Failed to create test assignment:', response.status, error);
      return { success: false, error };
    }
  } catch (error) {
    console.error('❌ Error creating test assignment:', error);
    return { success: false, error: error.message };
  }
};

// Check Canvas DOM structure
window.analyzeCanvasDOM = function() {
  console.log('🔍 Analyzing Canvas DOM structure...');
  
  const selectors = [
    '[data-testid*="assignment"]',
    '.assignment',
    '[class*="assignment"]',
    '[data-testid="planner-item"]',
    '.planner-item',
    '.to-do-item',
    '.stream-item',
    '.ig-list-item',
    'a[href*="/assignments/"]'
  ];

  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`📌 Found ${elements.length} elements with selector: ${selector}`);
      elements.forEach((el, index) => {
        if (index < 3) { // Show first 3 elements
          console.log(`   ${index + 1}. Text: "${el.textContent?.trim().substring(0, 100)}..."`);
          console.log(`      Classes: ${el.className}`);
          console.log(`      Data attributes:`, Object.keys(el.dataset));
        }
      });
    }
  });

  // Check for Canvas API calls in network
  console.log('📡 Checking for intercepted Canvas API data...');
  if (window.interceptedAssignments && window.interceptedAssignments.length > 0) {
    console.log(`✅ Found ${window.interceptedAssignments.length} intercepted assignments`);
    window.interceptedAssignments.forEach((assignment, index) => {
      console.log(`${index + 1}. ${assignment.title} (Source: ${assignment.source})`);
    });
  } else {
    console.log('ℹ️ No intercepted API assignments found');
  }
};

// Full end-to-end test
window.runFullTest = async function(notionToken, notionDatabaseId) {
  console.log('🚀 Running full end-to-end test...');
  
  // Step 1: Test Canvas extraction
  console.log('\n1️⃣ Testing Canvas extraction...');
  const assignments = await window.testCanvasExtraction();
  
  if (assignments.length === 0) {
    console.warn('⚠️ No assignments found. Make sure you\'re on a Canvas page with assignments.');
    return;
  }

  // Step 2: Test Notion connection
  console.log('\n2️⃣ Testing Notion connection...');
  const connectionTest = await window.testNotionConnection(notionToken, notionDatabaseId);
  
  if (!connectionTest.success) {
    console.error('❌ Notion connection failed. Cannot proceed with sync test.');
    return;
  }

  // Step 3: Test sync (first assignment only)
  console.log('\n3️⃣ Testing sync with first assignment...');
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'SYNC_ASSIGNMENTS',
      assignments: [assignments[0]]
    });

    if (response.success) {
      console.log('✅ Sync test completed successfully!');
      console.log('📊 Results:', response.results);
    } else {
      console.error('❌ Sync test failed:', response.error);
    }
  } catch (error) {
    console.error('❌ Sync test error:', error);
  }

  console.log('\n🎉 Full test completed!');
};

// Monitor Canvas page changes
window.startCanvasMonitoring = function() {
  console.log('👀 Starting Canvas page monitoring...');
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const assignmentElements = node.querySelectorAll('[data-testid*="assignment"], .assignment, [class*="assignment"]');
            if (assignmentElements.length > 0) {
              console.log(`📱 Page change detected: ${assignmentElements.length} assignment elements added`);
            }
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('✅ Canvas monitoring started. Check console for page change notifications.');
  return observer;
};

// Helper to format assignments for console display
window.displayAssignments = function(assignments) {
  console.table(assignments.map(a => ({
    Title: a.title,
    Course: a.course,
    Due: a.dueDate ? new Date(a.dueDate).toLocaleDateString() : 'No due date',
    Status: a.status,
    Points: a.points,
    Source: a.source
  })));
};

// Export debug functions for global access
console.log('🛠️ Canvas-Notion Sync Debug Utilities Loaded');
console.log('Available functions:');
console.log('- testCanvasExtraction()');
console.log('- testNotionConnection(token, databaseId)');
console.log('- createTestAssignment(token, databaseId)');
console.log('- analyzeCanvasDOM()');
console.log('- runFullTest(notionToken, notionDatabaseId)');
console.log('- startCanvasMonitoring()');
console.log('- displayAssignments(assignments)');
console.log('\nExample usage:');
console.log('testCanvasExtraction().then(assignments => displayAssignments(assignments));');