#!/usr/bin/env node

/**
 * Performance Check: API calls optimization
 * Verifies API calls are batched and not redundant
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: [],
  filesScanned: 0
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  results.filesScanned++;

  // Check for sequential API calls in loops (should be batched)
  const loopApiPattern = /for\s*\([^)]+\)\s*{[^}]*fetch[^}]*}/gs;
  const loopMatches = content.match(loopApiPattern);

  if (loopMatches) {
    results.warnings.push({
      severity: 'HIGH',
      type: 'Sequential API calls in loop',
      file: relativePath,
      message: 'Consider using Promise.all() to batch these requests',
      count: loopMatches.length
    });
  }

  // Check for forEach with fetch (should use Promise.all)
  const forEachFetch = /\.forEach\([^{]*{[^}]*fetch[^}]*}\)/gs;
  const forEachMatches = content.match(forEachFetch);

  if (forEachMatches) {
    results.warnings.push({
      severity: 'HIGH',
      type: 'forEach with fetch',
      file: relativePath,
      message: 'Use Promise.all with map() instead of forEach for parallel requests',
      count: forEachMatches.length
    });
  }

  // Check for redundant GET requests to same endpoint
  const fetchCalls = content.match(/fetch\([^)]+\)/g) || [];
  const endpoints = fetchCalls.map(call => {
    const match = call.match(/['"`]([^'"`]+)['"`]/);
    return match ? match[1] : null;
  }).filter(Boolean);

  const duplicates = endpoints.filter((item, index) => endpoints.indexOf(item) !== index);
  if (duplicates.length > 0) {
    results.warnings.push({
      severity: 'MEDIUM',
      type: 'Duplicate API endpoint calls',
      file: relativePath,
      message: 'Consider caching or combining these requests',
      endpoints: [...new Set(duplicates)]
    });
  }

  // Check for missing include[] parameters in Canvas API calls
  const canvasApiCalls = content.match(/\/api\/v1\/courses\/[^?]+(?!\?include)/g);
  if (canvasApiCalls && canvasApiCalls.length > 0) {
    results.warnings.push({
      severity: 'MEDIUM',
      type: 'Canvas API without include[] parameters',
      file: relativePath,
      message: 'Consider using include[] to reduce API calls',
      count: canvasApiCalls.length
    });
  }

  // Check for pagination without proper handling
  const fetchWithoutPagination = content.match(/fetch\([^)]*\/api\/[^)]*\)(?!.*Link|.*next_cursor)/gs);
  if (fetchWithoutPagination && fetchWithoutPagination.length > 0) {
    results.warnings.push({
      severity: 'LOW',
      type: 'API call without pagination handling',
      file: relativePath,
      message: 'Ensure pagination is handled for list endpoints'
    });
  }
}

function scanDirectory(dir, extensions = ['.js']) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        scanDirectory(filePath, extensions);
      }
    } else if (extensions.some(ext => file.endsWith(ext))) {
      scanFile(filePath);
    }
  }
}

console.log('🔍 Checking API call optimization...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.warnings.length === 0) {
    console.log('✅ API calls are well optimized!\n');
    process.exit(0);
  } else {
    const high = results.warnings.filter(w => w.severity === 'HIGH');
    const medium = results.warnings.filter(w => w.severity === 'MEDIUM');
    const low = results.warnings.filter(w => w.severity === 'LOW');

    if (high.length > 0) {
      console.log('❌ HIGH priority optimizations:\n');
      for (const warning of high) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        if (warning.count) console.log(`  Count: ${warning.count}`);
        console.log('');
      }
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM priority optimizations:\n');
      for (const warning of medium) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        if (warning.count) console.log(`  Count: ${warning.count}`);
        if (warning.endpoints) console.log(`  Endpoints: ${warning.endpoints.join(', ')}`);
        console.log('');
      }
    }

    if (low.length > 0) {
      console.log('ℹ️  LOW priority suggestions:\n');
      for (const warning of low) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    console.log(`Total suggestions: ${results.warnings.length}\n`);

    // Warning only - don't fail the build
    process.exit(0);
  }
} catch (error) {
  console.error('❌ Error checking API calls:', error.message);
  process.exit(1);
}
