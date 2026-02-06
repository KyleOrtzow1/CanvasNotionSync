#!/usr/bin/env node

/**
 * Performance Check: Rate limiter usage throughout codebase
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  checks: [],
  issues: []
};

function checkRateLimiterUsage() {
  const bgPath = path.join(process.cwd(), 'background.js');

  if (!fs.existsSync(bgPath)) {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'background.js not found'
    });
    return;
  }

  const content = fs.readFileSync(bgPath, 'utf8');

  // Check if rate limiter is instantiated
  if (content.match(/new.*RateLimiter/)) {
    results.checks.push({ name: 'Rate limiter instantiated', passed: true });
  } else {
    results.issues.push({
      severity: 'HIGH',
      message: 'Rate limiter not instantiated'
    });
  }

  // Count fetch calls to Notion API
  const notionFetches = (content.match(/api\.notion\.com/g) || []).length;

  // Count rate limiter awaits
  const rateLimiterCalls = (content.match(/await.*rateLimiter/g) || []).length;

  if (notionFetches > 0 && rateLimiterCalls === 0) {
    results.passed = false;
    results.issues.push({
      severity: 'HIGH',
      message: `Found ${notionFetches} Notion API calls but no rate limiter usage`
    });
  } else if (notionFetches > rateLimiterCalls) {
    results.issues.push({
      severity: 'MEDIUM',
      message: `Found ${notionFetches} Notion API calls but only ${rateLimiterCalls} rate limiter calls`
    });
  } else {
    results.checks.push({
      name: 'All Notion API calls use rate limiter',
      passed: true
    });
  }
}

console.log('🔍 Checking rate limiter usage...\n');

try {
  checkRateLimiterUsage();

  console.log('Rate limiter usage checks:');
  results.checks.forEach(check => {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  });
  console.log('');

  if (results.issues.length > 0) {
    for (const issue of results.issues) {
      console.log(`[${issue.severity}] ${issue.message}`);
    }
    console.log('');
  }

  if (results.passed) {
    console.log('✅ Rate limiter is properly used!\n');
    process.exit(0);
  } else {
    console.log('❌ Rate limiter usage issues found!\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error checking rate limiter usage:', error.message);
  process.exit(1);
}
