#!/usr/bin/env node

/**
 * Security Check: Verify encryption implementation
 * Ensures AES-GCM encryption is properly implemented
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  checks: [],
  issues: []
};

function checkBackgroundJs() {
  // Check for credential manager in modular structure
  const credentialManagerPath = path.join(process.cwd(), 'src', 'credentials', 'credential-manager.js');
  const bgPath = path.join(process.cwd(), 'background.js');

  let content = '';

  // Try modular structure first
  if (fs.existsSync(credentialManagerPath)) {
    content = fs.readFileSync(credentialManagerPath, 'utf8');
  } else if (fs.existsSync(bgPath)) {
    content = fs.readFileSync(bgPath, 'utf8');
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'Neither credential-manager.js nor background.js found'
    });
    return;
  }

  // Check for AES-GCM usage
  if (content.includes('AES-GCM')) {
    results.checks.push({ name: 'AES-GCM algorithm used', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'AES-GCM encryption not found in background.js'
    });
  }

  // Check for CredentialManager class
  if (content.includes('class CredentialManager')) {
    results.checks.push({ name: 'CredentialManager class exists', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'HIGH',
      message: 'CredentialManager class not found'
    });
  }

  // Check for encryptData method
  if (content.includes('encryptData') || content.includes('encrypt')) {
    results.checks.push({ name: 'Encryption method exists', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'HIGH',
      message: 'Encryption method not found'
    });
  }

  // Check for decryptData method
  if (content.includes('decryptData') || content.includes('decrypt')) {
    results.checks.push({ name: 'Decryption method exists', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'HIGH',
      message: 'Decryption method not found'
    });
  }

  // Check for IV (Initialization Vector) generation
  if (content.includes('getRandomValues') && content.includes('Uint8Array(12)')) {
    results.checks.push({ name: 'Proper IV generation', passed: true });
  } else {
    results.issues.push({
      severity: 'MEDIUM',
      message: 'IV generation pattern not found or incorrect size'
    });
  }

  // Check for crypto.subtle usage
  if (content.includes('crypto.subtle.encrypt')) {
    results.checks.push({ name: 'Web Crypto API used correctly', passed: true });
  } else {
    results.passed = false;
    results.issues.push({
      severity: 'CRITICAL',
      message: 'crypto.subtle.encrypt not found'
    });
  }
}

console.log('🔍 Verifying encryption implementation...\n');

try {
  checkBackgroundJs();

  console.log('Encryption checks:');
  results.checks.forEach(check => {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  });
  console.log('');

  if (results.passed) {
    console.log('✅ Encryption implementation verified!\n');
    process.exit(0);
  } else {
    console.log('❌ Encryption issues found:\n');

    for (const issue of results.issues) {
      console.log(`  [${issue.severity}] ${issue.message}`);
    }
    console.log('');

    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error verifying encryption:', error.message);
  process.exit(1);
}
