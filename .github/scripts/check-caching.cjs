#!/usr/bin/env node

/**
 * Performance Check: Caching implementation
 * Verifies caching is implemented for static data
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  checks: [],
  suggestions: []
};

function checkCachingImplementation() {
  const bgPath = path.join(process.cwd(), 'background.js');
  const cacheManagerPath = path.join(process.cwd(), 'src', 'cache', 'cache-manager.js');
  const canvasCachePath = path.join(process.cwd(), 'src', 'cache', 'canvas-cache-manager.js');

  if (!fs.existsSync(bgPath)) {
    results.passed = false;
    results.suggestions.push({
      severity: 'CRITICAL',
      message: 'background.js not found'
    });
    return;
  }

  let content = fs.readFileSync(bgPath, 'utf8');

  // Also read cache manager files if they exist
  if (fs.existsSync(cacheManagerPath)) {
    content += '\n' + fs.readFileSync(cacheManagerPath, 'utf8');
  }
  if (fs.existsSync(canvasCachePath)) {
    content += '\n' + fs.readFileSync(canvasCachePath, 'utf8');
  }

  // Check for cache classes
  if (content.match(/class\s+\w*Cache/)) {
    results.checks.push({ name: 'Cache class implemented', passed: true });
  } else {
    results.suggestions.push({
      severity: 'HIGH',
      message: 'No dedicated cache class found - consider implementing caching'
    });
  }

  // Check for TTL (Time To Live)
  if (content.match(/ttl|timeToLive|expiry|expires/i)) {
    results.checks.push({ name: 'Cache TTL implemented', passed: true });
  } else {
    results.suggestions.push({
      severity: 'MEDIUM',
      message: 'No TTL found for cache - consider adding expiration'
    });
  }

  // Check for chrome.storage usage
  if (content.includes('chrome.storage')) {
    results.checks.push({ name: 'Persistent storage used', passed: true });
  } else {
    results.suggestions.push({
      severity: 'LOW',
      message: 'Consider using chrome.storage for persistent caching'
    });
  }

  // Check for Map usage (in-memory cache)
  if (content.includes('new Map()')) {
    results.checks.push({ name: 'In-memory cache (Map) used', passed: true });
  } else {
    results.suggestions.push({
      severity: 'MEDIUM',
      message: 'Consider using Map for in-memory caching'
    });
  }

  // Check for cache invalidation
  if (content.match(/invalidate|clear|delete.*cache/i)) {
    results.checks.push({ name: 'Cache invalidation implemented', passed: true });
  } else {
    results.suggestions.push({
      severity: 'MEDIUM',
      message: 'Cache invalidation mechanism not found'
    });
  }

  // Check for LRU cache patterns
  if (content.match(/maxSize|capacity|limit/i)) {
    results.checks.push({ name: 'Cache size limit implemented', passed: true });
  } else {
    results.suggestions.push({
      severity: 'LOW',
      message: 'Consider implementing cache size limits to prevent memory issues'
    });
  }
}

console.log('🔍 Checking caching implementation...\n');

try {
  checkCachingImplementation();

  console.log('Caching checks:');
  results.checks.forEach(check => {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  });
  console.log('');

  if (results.suggestions.length > 0) {
    const high = results.suggestions.filter(s => s.severity === 'HIGH');
    const medium = results.suggestions.filter(s => s.severity === 'MEDIUM');
    const low = results.suggestions.filter(s => s.severity === 'LOW');

    if (high.length > 0) {
      console.log('❌ HIGH priority:');
      high.forEach(s => console.log(`  - ${s.message}`));
      console.log('');
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM priority:');
      medium.forEach(s => console.log(`  - ${s.message}`));
      console.log('');
    }

    if (low.length > 0) {
      console.log('ℹ️  Suggestions:');
      low.forEach(s => console.log(`  - ${s.message}`));
      console.log('');
    }
  }

  if (results.checks.length >= 3) {
    console.log('✅ Good caching implementation!\n');
    process.exit(0);
  } else {
    console.log('⚠️  Caching could be improved\n');
    process.exit(0); // Warning only
  }
} catch (error) {
  console.error('❌ Error checking caching:', error.message);
  process.exit(1);
}
