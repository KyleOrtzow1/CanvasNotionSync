# Automated Security and Performance Checks

This directory contains scripts that automatically check the Canvas-Notion Assignment Sync extension against the security and performance checklists from BEST_PRACTICES.md.

## Overview

These checks run automatically on every commit and pull request via GitHub Actions. They help ensure code quality, security, and performance standards are maintained.

## Security Checks

### check-credentials.js
Scans for hardcoded credentials, API keys, tokens, and secrets.
- **Checks for:** Canvas tokens, Notion secrets, AWS keys, private keys
- **Severity:** CRITICAL if found
- **Exit code:** 1 if issues found

### check-console-logs.js
Detects console.log statements that might expose sensitive data.
- **Checks for:** Tokens, passwords, credentials in console logs
- **Severity:** HIGH for sensitive data, MEDIUM for production console.log
- **Exit code:** 1 if HIGH severity found

### check-dangerous-functions.js
Scans for potentially dangerous JavaScript functions.
- **Checks for:** eval(), Function(), innerHTML, document.write, etc.
- **Severity:** CRITICAL for eval/Function, HIGH for innerHTML
- **Exit code:** 1 if found

### verify-encryption.js
Verifies AES-GCM encryption is properly implemented.
- **Checks for:** AES-GCM usage, CredentialManager, proper IV generation
- **Severity:** CRITICAL if encryption missing
- **Exit code:** 1 if critical issues found

### check-https.js
Ensures all API calls use HTTPS.
- **Checks for:** HTTP URLs in fetch, XMLHttpRequest
- **Severity:** HIGH (localhost exceptions allowed)
- **Exit code:** 1 if HTTP API calls found

### check-permissions.js
Validates manifest.json permissions are minimal.
- **Checks for:** Dangerous permissions, overly broad host permissions
- **Severity:** HIGH for dangerous/broad permissions
- **Exit code:** 1 if HIGH severity found

### check-csp.js
Verifies Content Security Policy configuration.
- **Checks for:** unsafe-eval, unsafe-inline, wildcard sources
- **Severity:** CRITICAL for unsafe-eval, HIGH for unsafe-inline
- **Exit code:** 1 if CRITICAL found

### check-rate-limiting.js
Ensures rate limiting is properly implemented.
- **Checks for:** Rate limiter class, 429 handling, retry logic
- **Severity:** CRITICAL if rate limiter missing
- **Exit code:** 1 if critical issues found

### check-error-messages.js
Scans for credentials exposed in error messages.
- **Checks for:** Tokens, passwords in console.error
- **Severity:** HIGH for credential exposure
- **Exit code:** 1 if found

## Performance Checks

### check-api-calls.js
Analyzes API call patterns for optimization opportunities.
- **Checks for:** Sequential calls in loops, missing batching, duplicate endpoints
- **Severity:** HIGH for loop API calls, MEDIUM for duplicates
- **Exit code:** 0 (warnings only)

### check-caching.js
Verifies caching implementation for static data.
- **Checks for:** Cache classes, TTL, chrome.storage, Map usage
- **Severity:** HIGH if no caching, MEDIUM for missing features
- **Exit code:** 0 (warnings only)

### check-blocking-operations.js
Detects operations that might block the UI.
- **Checks for:** While loops in UI, synchronous XHR, long loops
- **Severity:** CRITICAL for sync XHR, HIGH for while loops
- **Exit code:** 1 if CRITICAL found

## Additional Scripts (Stubs)

These scripts are referenced in workflows but need full implementation:

- `check-rate-limiter-usage.js` - Verify rate limiter is used throughout
- `check-pagination.js` - Check pagination patterns
- `check-progress-indicators.js` - Verify progress UI
- `check-polling.js` - Detect unnecessary polling
- `check-debouncing.js` - Check debounce implementation
- `check-parallel-requests.js` - Verify parallel request usage
- `check-content-script-efficiency.js` - Content script performance
- `check-service-worker.js` - Service worker efficiency

## Report Generation

### generate-security-report.js
Creates a comprehensive JSON security report with:
- Timestamp and version
- Summary (passed/failed/warnings)
- Individual check results
- Detailed findings

### generate-performance-report.json
Creates a comprehensive JSON performance report with similar structure.

## Running Locally

Install dependencies:
```bash
npm install
```

Run all security checks:
```bash
npm run check:security
```

Run all performance checks:
```bash
npm run check:performance
```

Run all checks:
```bash
npm run check:all
```

Run individual check:
```bash
node .github/scripts/check-credentials.js
```

## Exit Codes

- **0:** All checks passed or warnings only
- **1:** Critical or high severity issues found

## GitHub Actions Integration

Checks run automatically via:
- `.github/workflows/security-checks.yml` - Security workflow
- `.github/workflows/performance-checks.yml` - Performance workflow

Both workflows:
- Run on push to main/develop/feature branches
- Run on pull requests
- Generate reports as artifacts
- Fail builds on critical issues

## Customization

To add new checks:

1. Create a new script in `.github/scripts/`
2. Follow the pattern of existing scripts
3. Add to appropriate workflow YAML file
4. Add npm script to package.json
5. Update this README

## Best Practices for Check Scripts

1. **Exit codes:** Use 1 for failures, 0 for success/warnings
2. **Severity levels:** CRITICAL, HIGH, MEDIUM, LOW, INFO
3. **Console output:** Clear emoji indicators (✅❌⚠️ℹ️🚨)
4. **File scanning:** Skip node_modules and .git
5. **Patterns:** Use regex for flexibility
6. **Context:** Provide file paths and line numbers
7. **Documentation:** Explain what each check does

## Contributing

When adding new checks based on BEST_PRACTICES.md:
1. Identify the checklist item
2. Determine if it's automatable
3. Create appropriate detection patterns
4. Add to workflow
5. Test thoroughly
6. Document in this README
