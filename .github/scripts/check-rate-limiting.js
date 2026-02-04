#!/usr/bin/env node

/**
 * Security & Performance Check: Rate limiting implementation
 * Verifies rate limiting is properly implemented
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  checks: [],
  issues: []
};

function checkRateLimiter() {
  const bgPath = path.join(process.cwd(), 'background.js');
  const rateLimiterPath = path.join(process.cwd(), 'src', 'api', 'notion-rate-limiter.js');
  const notionApiPath = path.join(process.cwd(), 'src', 'api', 'notion-api.js');

  let content = '';

  // Check multiple files for rate limiting implementation
  const filesToCheck = [bgPath, rateLimiterPath, notionApiPath].filter(fs.existsSync);

  if (filesToCheck.length === 0) {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'No source files found for rate limiting check'
    });
    return;
  }

  // Combine content from all files
  filesToCheck.forEach(file => {
    content += fs.readFileSync(file, 'utf8') + '\n';
  });

  // Check for NotionRateLimiter class
  if (content.includes('NotionRateLimiter') || content.includes('RateLimiter')) {
    results.checks.push({ name: 'Rate limiter class exists', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'No rate limiter class found'
    });
  }

  // Check for rate limiting logic
  if (content.match(/await.*rateLimiter/i)) {
    results.checks.push({ name: 'Rate limiter is used in async operations', passed: true });
  } else {
    results.issues.push({
      severity: 'HIGH',
      message: 'Rate limiter usage not found in async operations'
    });
  }

  // Check for 429 response handling
  if (content.includes('429') || content.includes('rate_limited')) {
    results.checks.push({ name: '429 rate limit response handling', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'HIGH',
      message: '429 (rate limited) response handling not found'
    });
  }

  // Check for retry-after header
  if (content.match(/retry[-_]after/i)) {
    results.checks.push({ name: 'Retry-After header handling', passed: true });
  } else {
    results.issues.push({
      severity: 'MEDIUM',
      message: 'Retry-After header handling not found'
    });
  }

  // Check for exponential backoff
  if (content.match(/Math\.pow.*\s*\*/)) {
    results.checks.push({ name: 'Exponential backoff implemented', passed: true });
  } else {
    results.issues.push({
      severity: 'LOW',
      message: 'Exponential backoff pattern not detected'
    });
  }

  // Check for Canvas rate limit headers
  if (content.match(/X-Request-Cost|X-Rate-Limit-Remaining/i)) {
    results.checks.push({ name: 'Canvas rate limit headers monitored', passed: true });
  } else {
    results.issues.push({
      severity: 'MEDIUM',
      message: 'Canvas rate limit headers (X-Request-Cost, X-Rate-Limit-Remaining) not monitored'
    });
  }
}

console.log('🔍 Checking rate limiting implementation...\n');

try {
  checkRateLimiter();

  console.log('Rate limiting checks:');
  results.checks.forEach(check => {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  });
  console.log('');

  if (results.issues.length > 0) {
    const critical = results.issues.filter(i => i.severity === 'CRITICAL');
    const high = results.issues.filter(i => i.severity === 'HIGH');
    const medium = results.issues.filter(i => i.severity === 'MEDIUM');
    const low = results.issues.filter(i => i.severity === 'LOW');

    if (critical.length > 0) {
      console.log('🚨 CRITICAL issues:');
      critical.forEach(i => console.log(`  - ${i.message}`));
      console.log('');
    }

    if (high.length > 0) {
      console.log('❌ HIGH severity issues:');
      high.forEach(i => console.log(`  - ${i.message}`));
      console.log('');
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM severity issues:');
      medium.forEach(i => console.log(`  - ${i.message}`));
      console.log('');
    }

    if (low.length > 0) {
      console.log('ℹ️  LOW severity issues:');
      low.forEach(i => console.log(`  - ${i.message}`));
      console.log('');
    }
  }

  if (results.passed) {
    console.log('✅ Rate limiting implementation verified!\n');
    process.exit(0);
  } else {
    console.log('❌ Critical rate limiting issues found!\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error checking rate limiting:', error.message);
  process.exit(1);
}
