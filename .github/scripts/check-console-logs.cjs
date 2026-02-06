#!/usr/bin/env node

/**
 * Security Check: No sensitive data in console logs
 * Scans for console.log statements that might expose sensitive information
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: [],
  filesScanned: 0
};

// Patterns that suggest sensitive data logging
const sensitivePatterns = [
  { name: 'Token', regex: /console\.(log|debug|info|warn|error)\([^)]*token[^)]*\)/gi },
  { name: 'Password', regex: /console\.(log|debug|info|warn|error)\([^)]*password[^)]*\)/gi },
  { name: 'Credentials', regex: /console\.(log|debug|info|warn|error)\([^)]*credential[^)]*\)/gi },
  { name: 'Secret', regex: /console\.(log|debug|info|warn|error)\([^)]*secret[^)]*\)/gi },
  { name: 'API Key', regex: /console\.(log|debug|info|warn|error)\([^)]*api[_-]?key[^)]*\)/gi },
  { name: 'Authorization', regex: /console\.(log|debug|info|warn|error)\([^)]*authorization[^)]*\)/gi }
];

// Files that should not have console.log in production
const productionFiles = ['background.js', 'content-script.js', 'popup.js'];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);
  const fileName = path.basename(filePath);

  results.filesScanned++;

  // Check for sensitive data in console logs
  for (const { name, regex } of sensitivePatterns) {
    const matches = content.match(regex);

    if (matches) {
      results.passed = false;
      for (const match of matches) {
        results.warnings.push({
          severity: 'HIGH',
          type: `Sensitive ${name} in console.log`,
          file: relativePath,
          match: match.substring(0, 80),
          line: findLineNumber(content, match)
        });
      }
    }
  }

  // Check for any console.log in production files
  if (productionFiles.includes(fileName)) {
    const consoleLogMatches = content.match(/console\.(log|debug|info)\(/g);

    if (consoleLogMatches) {
      results.warnings.push({
        severity: 'MEDIUM',
        type: 'Console statement in production file',
        file: relativePath,
        count: consoleLogMatches.length,
        message: 'Production files should not contain console.log statements'
      });
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

console.log('🔍 Checking for console.log statements with sensitive data...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.warnings.length === 0) {
    console.log('✅ No problematic console.log statements found!\n');
    process.exit(0);
  } else {
    const highSeverity = results.warnings.filter(w => w.severity === 'HIGH');
    const mediumSeverity = results.warnings.filter(w => w.severity === 'MEDIUM');

    if (highSeverity.length > 0) {
      console.log('❌ Found HIGH severity issues:\n');
      for (const warning of highSeverity) {
        console.log(`  File: ${warning.file}:${warning.line}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Match: ${warning.match}`);
        console.log('');
      }
    }

    if (mediumSeverity.length > 0) {
      console.log('⚠️  Found MEDIUM severity issues:\n');
      for (const warning of mediumSeverity) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Count: ${warning.count}`);
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    console.log(`Total warnings: ${results.warnings.length}\n`);

    // Fail only on HIGH severity
    process.exit(highSeverity.length > 0 ? 1 : 0);
  }
} catch (error) {
  console.error('❌ Error during console.log check:', error.message);
  process.exit(1);
}
