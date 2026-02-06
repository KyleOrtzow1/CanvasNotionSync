#!/usr/bin/env node

/**
 * Security Check: No hardcoded credentials in source code
 * Scans for common patterns of API keys, tokens, and secrets
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  issues: [],
  filesScanned: 0
};

// Patterns to detect hardcoded credentials
const credentialPatterns = [
  { name: 'Canvas Token', regex: /bearer\s+[a-zA-Z0-9]{64,}/gi },
  { name: 'Notion Secret', regex: /secret_[a-zA-Z0-9]{43}/gi },
  { name: 'Generic API Key', regex: /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
  { name: 'Token Assignment', regex: /token\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
  { name: 'Password', regex: /password\s*[:=]\s*['"][^'"]{1,}['"]/gi },
  { name: 'AWS Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g }
];

// Whitelist patterns (for test files and documentation)
const whitelistPatterns = [
  /YOUR_CANVAS_TOKEN/,
  /YOUR_API_KEY/,
  /secret_\.\.\./,
  /example\.com/,
  /localhost/,
  /PLACEHOLDER/i,
  /\*\*\*\*\*/
];

function isWhitelisted(content) {
  return whitelistPatterns.some(pattern => pattern.test(content));
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  results.filesScanned++;

  for (const { name, regex } of credentialPatterns) {
    const matches = content.match(regex);

    if (matches) {
      for (const match of matches) {
        if (!isWhitelisted(match)) {
          results.passed = false;
          results.issues.push({
            type: name,
            file: relativePath,
            match: match.substring(0, 50) + '...',
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

function scanDirectory(dir, extensions = ['.js', '.json', '.html']) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    // Skip node_modules and .git
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        scanDirectory(filePath, extensions);
      }
    } else if (extensions.some(ext => file.endsWith(ext))) {
      scanFile(filePath);
    }
  }
}

console.log('🔍 Scanning for hardcoded credentials...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.passed) {
    console.log('✅ No hardcoded credentials found!\n');
    process.exit(0);
  } else {
    console.log('❌ Found potential hardcoded credentials:\n');

    for (const issue of results.issues) {
      console.log(`  File: ${issue.file}:${issue.line}`);
      console.log(`  Type: ${issue.type}`);
      console.log(`  Match: ${issue.match}`);
      console.log('');
    }

    console.log(`Total issues: ${results.issues.length}\n`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error during credential scan:', error.message);
  process.exit(1);
}
