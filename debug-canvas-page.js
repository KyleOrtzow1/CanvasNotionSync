// Canvas Page Diagnostic Script
// Run this in browser console on your Canvas dashboard to analyze what's available

function analyzeCanvasPage() {
  console.log('=== CANVAS PAGE ANALYSIS ===');
  console.log('URL:', window.location.href);
  console.log('Page title:', document.title);
  
  // Find all potential assignment containers
  const selectors = [
    '[data-testid*="assignment"]',
    '.assignment',
    '[class*="assignment"]',
    '[data-testid="planner-item"]',
    '.planner-item',
    '.stream-item',
    '.to-do-item',
    'tr', // All table rows
    '.item',
    '[href*="/assignments/"]',
    '.ig-list-item'
  ];
  
  console.log('\n=== SELECTOR ANALYSIS ===');
  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`${selector}: ${elements.length} elements found`);
    }
  });
  
  // Look for completed/submitted assignment indicators
  console.log('\n=== COMPLETION STATUS INDICATORS ===');
  const statusSelectors = [
    '.completed',
    '.submitted',
    '.graded',
    '[class*="complete"]',
    '[class*="submit"]',
    '[class*="grade"]',
    '.check',
    '.success'
  ];
  
  statusSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`${selector}: ${elements.length} elements found`);
    }
  });
  
  // Sample the first few assignment-like elements
  console.log('\n=== SAMPLE ELEMENTS ===');
  const allAssignmentElements = document.querySelectorAll('[href*="/assignments/"], [data-testid*="assignment"], .assignment, .planner-item');
  
  Array.from(allAssignmentElements).slice(0, 5).forEach((element, i) => {
    console.log(`\n--- Element ${i + 1} ---`);
    console.log('Tag:', element.tagName);
    console.log('Classes:', element.className);
    console.log('Text (first 200 chars):', element.textContent?.substring(0, 200));
    console.log('HTML (first 300 chars):', element.outerHTML?.substring(0, 300));
    
    // Look for assignment link
    const link = element.querySelector('a[href*="/assignments/"]') || (element.href?.includes('/assignments/') ? element : null);
    if (link) {
      console.log('Assignment link:', link.href);
    }
  });
  
  // Check for specific text patterns
  console.log('\n=== TEXT PATTERN ANALYSIS ===');
  const pageText = document.body.textContent;
  
  // Count total assignments mentioned
  const assignmentMatches = pageText.match(/assignment/gi);
  console.log('Total "assignment" mentions:', assignmentMatches?.length || 0);
  
  // Look for due date patterns
  const dueDatePatterns = [
    /due\s+\w+\s+\d+/gi,
    /\w+\s+\d+\s+at\s+\d+:\d+/gi,
    /september\s+\d+/gi
  ];
  
  dueDatePatterns.forEach((pattern, i) => {
    const matches = pageText.match(pattern);
    if (matches) {
      console.log(`Due date pattern ${i + 1}:`, matches.slice(0, 3));
    }
  });
  
  // Look for point patterns
  const pointMatches = pageText.match(/\d+\s*(?:pts?|points?)/gi);
  if (pointMatches) {
    console.log('Point patterns found:', pointMatches.slice(0, 10));
  }
  
  // Look for course patterns
  const coursePatterns = [
    /[A-Z]{2,4}\s+\d{3}/g, // Course codes like MATH 101
    /\b[A-Z][a-z]+\s+\d{3}\b/g // Course names like Biology 101
  ];
  
  coursePatterns.forEach((pattern, i) => {
    const matches = pageText.match(pattern);
    if (matches) {
      console.log(`Course pattern ${i + 1}:`, matches.slice(0, 5));
    }
  });
  
  console.log('\n=== ANALYSIS COMPLETE ===');
}

// Run the analysis
analyzeCanvasPage();
