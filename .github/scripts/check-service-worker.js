#!/usr/bin/env node

/**
 * Performance Check: Service worker efficiency
 */

const fs = require('fs');
const path = require('path');

const results = {
  checks: [],
  warnings: []
};

function checkServiceWorker() {
  const bgPath = path.join(process.cwd(), 'background.js');

  if (!fs.existsSync(bgPath)) {
    console.log('⚠️  background.js not found');
    return;
  }

  const content = fs.readFileSync(bgPath, 'utf8');
  const size = Buffer.byteLength(content, 'utf8');
  const lines = content.split('\n').length;

  console.log(`  File size: ${size} bytes (${lines} lines)`);

  // Check file size
  if (size > 100000) {
    results.warnings.push({
      severity: 'MEDIUM',
      message: `Service worker is ${size} bytes - consider code splitting`
    });
  } else {
    results.checks.push({
      name: 'Service worker size is reasonable',
      passed: true
    });
  }

  // Check for message handling (good)
  if (content.includes('chrome.runtime.onMessage')) {
    results.checks.push({
      name: 'Handles messages from content scripts',
      passed: true
    });
  }

  // Check for alarm usage (efficient periodic tasks)
  if (content.includes('chrome.alarms')) {
    results.checks.push({
      name: 'Uses chrome.alarms for periodic tasks',
      passed: true
    });
  } else {
    results.warnings.push({
      severity: 'LOW',
      message: 'Consider using chrome.alarms for periodic sync'
    });
  }

  // Check for long-running operations (bad in service worker)
  if (content.match(/setInterval|setTimeout.*\d{5,}/)) {
    results.warnings.push({
      severity: 'HIGH',
      message: 'Long-running timers detected - service workers can be terminated'
    });
  }

  // Check for cleanup on suspend
  if (content.includes('chrome.runtime.onSuspend')) {
    results.checks.push({
      name: 'Handles onSuspend event',
      passed: true
    });
  }

  // Check for startup handling
  if (content.includes('chrome.runtime.onStartup')) {
    results.checks.push({
      name: 'Handles onStartup event',
      passed: true
    });
  }

  // Check for global state (risky in service workers)
  const globalVars = content.match(/^(var|let|const)\s+\w+\s*=/gm);
  if (globalVars && globalVars.length > 10) {
    results.warnings.push({
      severity: 'MEDIUM',
      message: `${globalVars.length} global variables - service workers can be terminated, use chrome.storage`
    });
  }
}

console.log('🔍 Checking service worker efficiency...\n');

try {
  checkServiceWorker();

  if (results.checks.length > 0) {
    console.log('\nService worker checks:');
    results.checks.forEach(check => {
      console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    results.warnings.forEach(w => {
      console.log(`  [${w.severity}] ${w.message}`);
    });
  }

  console.log('\n✅ Service worker efficiency check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking service worker:', error.message);
  process.exit(1);
}
