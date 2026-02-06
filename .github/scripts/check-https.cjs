#!/usr/bin/env node

/**
 * Security Check: HTTPS used for all API calls
 * Scans for HTTP URLs and ensures HTTPS is used for API endpoints
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  issues: [],
  filesScanned: 0
};

// Patterns to detect HTTP URLs
const httpPatterns = [
  { name: 'HTTP fetch', regex: /fetch\s*\(\s*['"]http:\/\//g },
  { name: 'HTTP XMLHttpRequest', regex: /\.open\s*\([^)]*['"]http:\/\//g },
  { name: 'HTTP URL assignment', regex: /url\s*[:=]\s*['"]http:\/\//g },
  { name: 'HTTP endpoint', regex: /['"]http:\/\/[a-z0-9.-]+\/api\//gi }
];

// Whitelist for localhost and documentation
const whitelist = [
  /http:\/\/localhost/i,
  /http:\/\/127\.0\.0\.1/i,
  /http:\/\/example\.com/i,
  /http:\/\/\{/
];

function isWhitelisted(url) {
  return whitelist.some(pattern => pattern.test(url));
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  results.filesScanned++;

  for (const { name, regex } of httpPatterns) {
    const matches = content.match(regex);

    if (matches) {
      for (const match of matches) {
        if (!isWhitelisted(match)) {
          results.passed = false;
          results.issues.push({
            type: name,
            file: relativePath,
            match: match.substring(0, 80),
            line: findLineNumber(content, match)
          });
        }
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

function scanDirectory(dir, extensions = ['.js', '.json']) {
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

console.log('🔍 Checking for HTTP (non-HTTPS) API calls...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.passed) {
    console.log('✅ All API calls use HTTPS!\n');
    process.exit(0);
  } else {
    console.log('❌ Found HTTP (non-HTTPS) API calls:\n');

    for (const issue of results.issues) {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Type: ${issue.type}`);
      console.log(`  Match: ${issue.match}`);
      console.log('');
    }

    console.log(`Total issues: ${results.issues.length}\n`);
    console.log('⚠️  All API calls should use HTTPS for security.\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error during HTTPS check:', error.message);
  process.exit(1);
}
