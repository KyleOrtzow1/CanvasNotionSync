#!/usr/bin/env node

/**
 * Performance Check: Pagination implementation
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: []
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check for Link header parsing (Canvas pagination)
  if (content.includes('Link') && content.includes('next')) {
    console.log(`  ✅ Canvas Link header pagination in ${relativePath}`);
  }

  // Check for Notion cursor pagination
  if (content.includes('next_cursor') && content.includes('has_more')) {
    console.log(`  ✅ Notion cursor pagination in ${relativePath}`);
  }

  // Check for manual page construction (bad practice)
  if (content.match(/page\s*=\s*\d+/)) {
    results.warnings.push({
      severity: 'MEDIUM',
      file: relativePath,
      message: 'Manual page number construction detected - use Link headers instead'
    });
  }

  // Check for pagination in loops
  if (content.match(/while.*has_more|while.*next.*url/i)) {
    console.log(`  ✅ Pagination loop in ${relativePath}`);
  }
}

console.log('🔍 Checking pagination implementation...\n');

try {
  const files = ['background.js', 'content-script.js'];

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      scanFile(filePath);
    }
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  Pagination warnings:');
    results.warnings.forEach(w => {
      console.log(`  [${w.severity}] ${w.file}: ${w.message}`);
    });
  }

  console.log('\n✅ Pagination check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking pagination:', error.message);
  process.exit(1);
}
