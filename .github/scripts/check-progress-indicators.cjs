#!/usr/bin/env node

/**
 * Performance Check: Progress indicators for long operations
 */

const fs = require('fs');
const path = require('path');

const results = {
  checks: [],
  suggestions: []
};

function checkProgressIndicators() {
  const popupPath = path.join(process.cwd(), 'popup.js');
  const bgPath = path.join(process.cwd(), 'background.js');

  // Check popup for progress indicators
  if (fs.existsSync(popupPath)) {
    const content = fs.readFileSync(popupPath, 'utf8');

    if (content.match(/progress|loading|spinner/i)) {
      results.checks.push({
        name: 'Progress indicators in popup',
        passed: true
      });
    } else {
      results.suggestions.push({
        severity: 'MEDIUM',
        message: 'No progress indicators found in popup.js'
      });
    }

    if (content.includes('chrome.notifications')) {
      results.checks.push({
        name: 'Notifications for long operations',
        passed: true
      });
    }
  }

  // Check background for progress updates
  if (fs.existsSync(bgPath)) {
    const content = fs.readFileSync(bgPath, 'utf8');

    if (content.match(/sendMessage.*progress|postMessage.*progress/i)) {
      results.checks.push({
        name: 'Background sends progress updates',
        passed: true
      });
    } else {
      results.suggestions.push({
        severity: 'LOW',
        message: 'Consider sending progress updates from background'
      });
    }
  }
}

console.log('🔍 Checking progress indicators...\n');

try {
  checkProgressIndicators();

  console.log('Progress indicator checks:');
  results.checks.forEach(check => {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  });

  if (results.suggestions.length > 0) {
    console.log('\nSuggestions:');
    results.suggestions.forEach(s => {
      console.log(`  [${s.severity}] ${s.message}`);
    });
  }

  console.log('\n✅ Progress indicator check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking progress indicators:', error.message);
  process.exit(1);
}
