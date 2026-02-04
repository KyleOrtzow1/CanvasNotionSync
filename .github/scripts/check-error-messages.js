#!/usr/bin/env node

/**
 * Security Check: No credentials in error messages
 * Scans for error handling that might expose sensitive data
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  issues: [],
  filesScanned: 0
};

// Patterns that might expose credentials in errors
const dangerousPatterns = [
  { name: 'Token in error', regex: /console\.error\([^)]*token[^)]*\)/gi },
  { name: 'Password in error', regex: /console\.error\([^)]*password[^)]*\)/gi },
  { name: 'Credential in error', regex: /console\.error\([^)]*credential[^)]*\)/gi },
  { name: 'Full error object', regex: /console\.error\([^)]*error\s*\)/gi },
  { name: 'Authorization header logged', regex: /console\.(log|error)\([^)]*authorization[^)]*\)/gi }
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  results.filesScanned++;

  for (const { name, regex } of dangerousPatterns) {
    const matches = content.match(regex);

    if (matches) {
      for (const match of matches) {
        // Skip if it's just logging error.message
        if (match.includes('error.message') || match.includes('err.message')) {
          continue;
        }

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

  // Check for try-catch blocks that expose too much
  const tryCatchBlocks = content.match(/catch\s*\([^)]+\)\s*{[^}]+}/g);
  if (tryCatchBlocks) {
    for (const block of tryCatchBlocks) {
      if (block.includes('console.error(error)') || block.includes('console.log(error)')) {
        results.issues.push({
          type: 'Full error object in catch',
          file: relativePath,
          match: 'catch block logs full error object',
          severity: 'MEDIUM',
          line: findLineNumber(content, block)
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

console.log('🔍 Checking error messages for credential exposure...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.passed) {
    console.log('✅ No credentials exposed in error messages!\n');
    process.exit(0);
  } else {
    console.log('❌ Found potential credential exposure in errors:\n');

    for (const issue of results.issues) {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Type: ${issue.type}`);
      console.log(`  Match: ${issue.match}`);
      console.log('');
    }

    console.log(`Total issues: ${results.issues.length}\n`);
    console.log('⚠️  Error messages should not expose sensitive data.\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error checking error messages:', error.message);
  process.exit(1);
}
