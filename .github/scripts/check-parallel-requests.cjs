#!/usr/bin/env node

/**
 * Performance Check: Parallel requests usage
 */

const fs = require('fs');
const path = require('path');

const results = {
  checks: [],
  suggestions: []
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check for Promise.all usage
  if (content.includes('Promise.all')) {
    results.checks.push({
      name: `Promise.all used in ${relativePath}`,
      passed: true
    });
  }

  // Check for Promise.allSettled
  if (content.includes('Promise.allSettled')) {
    results.checks.push({
      name: `Promise.allSettled used in ${relativePath}`,
      passed: true
    });
  }

  // Check for map().map() pattern (good for parallel)
  if (content.match(/\.map\s*\([^)]*\)\s*\.map\s*\(/)) {
    results.checks.push({
      name: `Parallel mapping in ${relativePath}`,
      passed: true
    });
  }

  // Check for sequential awaits in loop (anti-pattern)
  const sequentialAwaits = content.match(/for\s*\([^)]+\)\s*{[^}]*await[^}]*}/gs);
  if (sequentialAwaits) {
    // Check if it's intentionally sequential (has comment or rate limiting)
    const hasRateLimiting = content.includes('rateLimiter');
    const hasComment = content.match(/\/\*.*sequential.*\*\/|\/\/.*sequential/i);

    if (!hasRateLimiting && !hasComment) {
      results.suggestions.push({
        severity: 'MEDIUM',
        file: relativePath,
        message: 'Sequential awaits in loop detected - consider Promise.all for independent operations',
        count: sequentialAwaits.length
      });
    }
  }
}

console.log('🔍 Checking parallel request usage...\n');

try {
  const files = ['background.js', 'content-script.js'];

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      scanFile(filePath);
    }
  }

  if (results.checks.length > 0) {
    console.log('Parallel request patterns:');
    results.checks.forEach(check => {
      console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
    });
  }

  if (results.suggestions.length > 0) {
    console.log('\nOptimization opportunities:');
    results.suggestions.forEach(s => {
      console.log(`  [${s.severity}] ${s.file}: ${s.message}`);
      if (s.count) console.log(`    Count: ${s.count}`);
    });
  }

  console.log('\n✅ Parallel request check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking parallel requests:', error.message);
  process.exit(1);
}
