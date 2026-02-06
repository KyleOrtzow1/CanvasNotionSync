#!/usr/bin/env node

/**
 * Performance Check: Debouncing for user actions
 */

const fs = require('fs');
const path = require('path');

const results = {
  checks: [],
  suggestions: []
};

function checkDebouncing() {
  const popupPath = path.join(process.cwd(), 'popup.js');
  const contentPath = path.join(process.cwd(), 'content-script.js');

  const files = [popupPath, contentPath];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);

    // Check for debounce function
    if (content.match(/debounce|throttle/i)) {
      results.checks.push({
        name: `Debounce/throttle in ${relativePath}`,
        passed: true
      });
    }

    // Check for input event listeners (should be debounced)
    const inputListeners = content.match(/addEventListener\s*\(\s*['"]input['"]/g);
    if (inputListeners && !content.match(/debounce|throttle/i)) {
      results.suggestions.push({
        severity: 'MEDIUM',
        file: relativePath,
        message: 'Input event listeners found without debouncing'
      });
    }

    // Check for keyup/keydown (should consider debouncing)
    const keyListeners = content.match(/addEventListener\s*\(\s*['"]key(up|down)['"]/g);
    if (keyListeners && !content.match(/debounce|throttle/i)) {
      results.suggestions.push({
        severity: 'LOW',
        file: relativePath,
        message: 'Key event listeners might benefit from debouncing'
      });
    }
  }
}

console.log('🔍 Checking debouncing implementation...\n');

try {
  checkDebouncing();

  if (results.checks.length > 0) {
    console.log('Debouncing checks:');
    results.checks.forEach(check => {
      console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
    });
  }

  if (results.suggestions.length > 0) {
    console.log('\nSuggestions:');
    results.suggestions.forEach(s => {
      console.log(`  [${s.severity}] ${s.file}: ${s.message}`);
    });
  }

  console.log('\n✅ Debouncing check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking debouncing:', error.message);
  process.exit(1);
}
