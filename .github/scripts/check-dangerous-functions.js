#!/usr/bin/env node

/**
 * Security Check: No eval() or similar dangerous functions
 * Scans for potentially dangerous JavaScript functions
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  issues: [],
  filesScanned: 0
};

// Dangerous functions to detect
const dangerousFunctions = [
  { name: 'eval()', regex: /\beval\s*\(/g, severity: 'CRITICAL' },
  { name: 'Function() constructor', regex: /new\s+Function\s*\(/g, severity: 'CRITICAL' },
  { name: 'setTimeout with string', regex: /setTimeout\s*\(\s*['"`]/g, severity: 'HIGH' },
  { name: 'setInterval with string', regex: /setInterval\s*\(\s*['"`]/g, severity: 'HIGH' },
  { name: 'innerHTML with user input', regex: /\.innerHTML\s*=\s*(?!['"`])/g, severity: 'HIGH' },
  { name: 'document.write', regex: /document\.write\s*\(/g, severity: 'MEDIUM' },
  { name: 'execScript', regex: /execScript\s*\(/g, severity: 'CRITICAL' }
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  results.filesScanned++;

  for (const { name, regex, severity } of dangerousFunctions) {
    const matches = content.match(regex);

    if (matches) {
      results.passed = false;
      for (const match of matches) {
        results.issues.push({
          severity,
          function: name,
          file: relativePath,
          match: match,
          line: findLineNumber(content, match)
        });
      }
    }
  }
}

function findLineNumber(content, match) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(match)) {
      return i + 1;
    }
  }
  return -1;
}

function scanDirectory(dir, extensions = ['.js', '.html']) {
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

console.log('🔍 Scanning for dangerous functions...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.passed) {
    console.log('✅ No dangerous functions found!\n');
    process.exit(0);
  } else {
    const critical = results.issues.filter(i => i.severity === 'CRITICAL');
    const high = results.issues.filter(i => i.severity === 'HIGH');
    const medium = results.issues.filter(i => i.severity === 'MEDIUM');

    if (critical.length > 0) {
      console.log('🚨 CRITICAL: Found dangerous functions:\n');
      for (const issue of critical) {
        console.log(`  File: ${issue.file}:${issue.line}`);
        console.log(`  Function: ${issue.function}`);
        console.log(`  Match: ${issue.match}`);
        console.log('');
      }
    }

    if (high.length > 0) {
      console.log('❌ HIGH: Found potentially dangerous patterns:\n');
      for (const issue of high) {
        console.log(`  File: ${issue.file}:${issue.line}`);
        console.log(`  Function: ${issue.function}`);
        console.log(`  Match: ${issue.match}`);
        console.log('');
      }
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM: Found functions to review:\n');
      for (const issue of medium) {
        console.log(`  File: ${issue.file}:${issue.line}`);
        console.log(`  Function: ${issue.function}`);
        console.log('');
      }
    }

    console.log(`Total issues: ${results.issues.length}\n`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error during dangerous function scan:', error.message);
  process.exit(1);
}
