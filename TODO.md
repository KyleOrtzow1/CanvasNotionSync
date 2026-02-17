# Canvas-Notion Sync - Implementation TODO List

**Generated from:** Best Practices Compliance Report (2026-02-05)
**Overall Compliance:** 65% → Target: 90%+
**Estimated Timeline:** 4-6 weeks

---

## 🚨 Critical Priority (Week 1-2)

### 1. Implement Canvas Rate Limiter
**Priority:** CRITICAL | **Estimated Time:** 8 hours
**Reference:** BEST_PRACTICES.md:176-213

- [x] Create new file `src/api/canvas-rate-limiter.js`
- [x] Implement `CanvasRateLimiter` class with leaky bucket algorithm
  - [x] Add constructor with bucket capacity (700 units)
  - [x] Add leak rate (10 units/second)
  - [x] Implement `waitIfNeeded(estimatedCost)` method
  - [x] Implement `updateFromHeaders(headers)` method to sync with actual rate limits
- [x] Import rate limiter in `content-script.js`
- [x] Initialize rate limiter instance in `CanvasAPIExtractor` constructor
- [x] Integrate `waitIfNeeded()` before each Canvas API call in `makeAPICall()` method
- [x] Update rate limiter state from response headers in `content-script.js:245-257`
- [x] Add rate limit monitoring/logging
- [x] Test with multiple rapid API calls to verify throttling works

---

### 2. Add Canvas Pagination Support
**Priority:** CRITICAL | **Estimated Time:** 6 hours
**Reference:** BEST_PRACTICES.md:1057-1093

- [ ] Create `parseLinkHeader(header)` utility function in `content-script.js`
  - [ ] Parse Link header format: `<url>; rel="next"`
  - [ ] Extract all relations (next, prev, first, last)
  - [ ] Return object with named links
- [ ] Refactor `makeAPICall()` to support pagination
  - [ ] Rename to `makeAPISingleCall()` (original behavior)
  - [ ] Create new `makeAPICall()` wrapper that handles pagination
  - [ ] Loop while `next` link exists
  - [ ] Accumulate results across pages
  - [ ] Add optional `maxPages` parameter for safety
- [ ] Update course fetching (`content-script.js:84-100`)
  - [ ] Use paginated `makeAPICall()`
  - [ ] Handle >100 courses
- [ ] Update assignment fetching (`content-script.js:127-144`)
  - [ ] Use paginated `makeAPICall()`
  - [ ] Handle >100 assignments per course
- [ ] Add pagination progress logging
- [ ] Test with mock data >100 items

---

### 3. Add Notion Pagination Support
**Priority:** CRITICAL | **Estimated Time:** 4 hours
**Reference:** BEST_PRACTICES.md:1109-1138

- [ ] Add `queryAllPages()` method to `NotionAPI` class (`notion-api.js`)
  - [ ] Accept `dataSourceId` and `filter` parameters
  - [ ] Loop while `has_more` is true
  - [ ] Pass `start_cursor` from previous response
  - [ ] Set `page_size: 100` for efficiency
  - [ ] Accumulate all results
- [ ] Update `queryDataSource()` to optionally support pagination
  - [ ] Add `paginateAll` parameter (default: false for backward compatibility)
  - [ ] If true, call `queryAllPages()`
- [ ] Update cache loading in `assignment-cache-manager.js`
  - [ ] Use `queryAllPages()` when loading existing assignments
  - [ ] Handle >100 cached assignments
- [ ] Add progress callback for long pagination operations
- [ ] Test with >100 assignments in Notion database

---

### 4. Implement HTML Sanitization
**Priority:** CRITICAL | **Estimated Time:** 3 hours
**Reference:** BEST_PRACTICES.md:129-133

- [x] Create `src/utils/sanitization.js` file
- [x] Implement `sanitizeHTML(html)` function
  - [x] Handle null/undefined input
  - [x] Use `DOMParser` approach to strip HTML (with regex fallback for Node.js)
  - [x] Return sanitized plain text
  - [x] Add option to preserve basic formatting (preserveLineBreaks option)
- [x] Apply sanitization in `content-script.js:191`
  - [x] Load sanitization utility via manifest content_scripts
  - [x] Sanitize `assignment.description` before adding to result
- [x] Apply sanitization in `assignment-syncer.js`
  - [x] Import sanitizeHTML and apply in NotionValidator
  - [x] Add description field to Notion properties via rich_text
- [x] Add unit tests for sanitization
  - [x] Test with malicious script tags
  - [x] Test with onclick handlers
  - [x] Test with normal HTML content
  - [x] Test with null/undefined

---

### 5. Implement Canvas Data Validation
**Priority:** CRITICAL | **Estimated Time:** 5 hours
**Reference:** BEST_PRACTICES.md:536-558

- [ ] Create `src/validators/canvas-validator.js` file
- [ ] Implement `validateCanvasAssignment(assignment)` function
  - [ ] Check required field: `id` (must exist)
  - [ ] Check required field: `name` (must be non-empty string)
  - [ ] Validate `due_at` date format (ISO 8601)
  - [ ] Validate `points_possible` (must be number >= 0 or null)
  - [ ] Validate `course_id` (must exist)
  - [ ] Add warnings for invalid data, set to null instead of throwing
- [ ] Implement `isValidISO8601(dateString)` helper
  - [ ] Use regex: `/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/`
  - [ ] Return boolean
- [ ] Apply validation in `content-script.js:180-196`
  - [ ] Import validator
  - [ ] Wrap each assignment in try-catch
  - [ ] Log validation errors
  - [ ] Skip invalid assignments or use defaults
- [ ] Add unit tests for validation
  - [ ] Test valid assignment
  - [ ] Test missing required fields
  - [ ] Test invalid date formats
  - [ ] Test invalid points_possible values

---

### 6. Implement Notion Data Validation
**Priority:** CRITICAL | **Estimated Time:** 6 hours
**Reference:** BEST_PRACTICES.md:589-638

- [x] Create `src/validators/notion-validator.js` file
- [x] Implement `NotionValidator` class
  - [x] `validateDateProperty(date)` - check ISO 8601 format
  - [x] `validateSelectOption(value, options)` - verify option exists
  - [x] `validateRichText(richTextArray)` - check 2000 char limit per object
  - [x] `validateNumber(value)` - ensure it's actually a number
  - [x] `splitLongText(text, maxChars = 2000)` - split into chunks if needed
- [x] Apply validation in `assignment-syncer.js:32-84`
  - [x] Import `NotionValidator`
  - [x] Validate date before setting "Due Date" property
  - [x] Validate Canvas ID text length before setting rich_text
  - [x] Split long descriptions if needed
  - [x] Add error handling for validation failures
- [ ] Optionally fetch and cache database schema
  - [ ] Get available select options for "Status" and "Course"
  - [ ] Validate against actual schema
- [x] Add unit tests for validation
  - [x] Test each validator method
  - [x] Test edge cases (null, undefined, empty)
  - [x] Test text splitting for long content

---

### 7. Create Comprehensive Test Suite
**Priority:** CRITICAL | **Estimated Time:** 16 hours
**Reference:** BEST_PRACTICES.md:1621-1710

#### Setup Testing Infrastructure
- [ ] Install testing dependencies
  - [ ] `npm install --save-dev jest @types/jest`
  - [ ] `npm install --save-dev @jest/globals`
  - [ ] Configure Jest for ES modules in `package.json`
- [ ] Create `jest.config.js`
  - [ ] Configure test environment
  - [ ] Set up coverage thresholds
  - [ ] Configure module paths
- [ ] Update `package.json` test script
  - [ ] Change from placeholder to `jest --coverage`

#### Canvas API Tests
- [ ] Create `test/canvas-api.test.js`
  - [ ] Test `validateCanvasToken()` with valid/invalid tokens
  - [ ] Test `isValidCanvasUrl()` with various URLs
  - [ ] Test `validateCanvasAssignment()` with various inputs
  - [ ] Test `isValidISO8601()` date validation
  - [x] Test rate limiter behavior
  - [ ] Mock Canvas API responses
  - [ ] Test error handling for all status codes (401, 403, 404, 500, 503)
  - [ ] Test pagination with >100 items
  - [ ] Test null/undefined handling

#### Notion API Tests
- [ ] Create `test/notion-api.test.js`
  - [ ] Test `NotionAPI` class initialization
  - [ ] Test rate limiter integration
  - [ ] Test 429 retry with exponential backoff
  - [ ] Test 409 conflict retry
  - [ ] Test pagination with has_more/next_cursor
  - [ ] Mock Notion API responses
  - [ ] Test error handling for all status codes
  - [ ] Test data source discovery

#### Validation Tests
- [ ] Create `test/validators.test.js`
  - [ ] Test Canvas validator with malformed data
  - [ ] Test Notion validator with invalid properties
  - [ ] Test HTML sanitization with malicious input
  - [ ] Test rich text splitting for long content
  - [ ] Test select option validation

#### Cache Tests
- [ ] Create `test/cache.test.js` (if not already exists)
  - [ ] Test cache hit/miss scenarios
  - [ ] Test TTL expiration
  - [ ] Test LRU eviction
  - [ ] Test persistence to chrome.storage
  - [ ] Test field-level change detection
  - [ ] Test cleanup of expired entries

#### Integration Tests
- [ ] Create `test/integration/sync-flow.test.js`
  - [ ] Test end-to-end sync with mock APIs
  - [ ] Test credential encryption/decryption
  - [ ] Test cache loading and saving
  - [ ] Test error recovery
  - [ ] Test concurrent sync operations

#### Extension Tests
- [ ] Create `test/extension.test.js`
  - [ ] Mock chrome.storage API
  - [ ] Test credential storage/retrieval
  - [ ] Test message handlers
  - [ ] Test background handlers

#### Set up CI/CD
- [ ] Create `.github/workflows/test.yml`
  - [ ] Run tests on push
  - [ ] Run tests on pull request
  - [ ] Upload coverage reports

---

## ⚠️ High Priority (Week 3)

### 8. Remove Production Console Logs
**Priority:** HIGH | **Estimated Time:** 4 hours
**Reference:** BEST_PRACTICES.md:1342-1346

- [ ] Create debug flag system
  - [ ] Add `DEBUG_MODE` constant in `src/utils/debug.js`
  - [ ] Implement `debug.log()`, `debug.warn()`, `debug.error()` wrappers
  - [ ] Check debug flag before logging
- [ ] Replace console.log in `content-script.js`
  - [ ] Replace all `console.log()` with `debug.log()`
  - [ ] Keep error logs as `console.error()` or use `debug.error()`
- [ ] Replace console.log in `assignment-syncer.js`
  - [ ] Replace verbose logging with debug calls
  - [ ] Keep summary logs for users
- [ ] Replace console.log in `notion-rate-limiter.js`
  - [ ] Gate retry logs behind debug flag
- [ ] Replace console.log in `cache-manager.js`
  - [ ] Gate cache operation logs
- [ ] Add setting in popup to enable debug mode
  - [ ] Add checkbox in settings
  - [ ] Store preference in chrome.storage
  - [ ] Load preference on startup
- [ ] Update all other files with console.log statements

---

### 9. Implement Canvas Error Retry Logic
**Priority:** HIGH | **Estimated Time:** 5 hours
**Reference:** BEST_PRACTICES.md:321-341

- [x] Create `canvasRequestWithRetry()` wrapper function in `content-script.js`
  - [x] Accept async function to execute
  - [x] Accept `maxRetries` parameter (default: 3)
  - [x] Implement try-catch with retry loop
  - [ ] Identify transient errors (status >= 500, network errors)
  - [x] Identify rate limit errors (status 403 with rate limit message)
  - [x] Implement exponential backoff (1s, 2s, 4s)
  - [x] Don't retry 4xx errors except 403 rate limits
  - [x] Log retry attempts
- [x] Wrap `makeAPICall()` with retry logic
  - [x] Apply to course fetching
  - [x] Apply to assignment fetching
  - [x] Apply to submission fetching
- [ ] Implement user-friendly error mapping
  - [ ] Create `getUserFriendlyCanvasError(error)` function
  - [ ] Map 401 → "Token invalid/expired"
  - [ ] Map 403 → "Rate limit or permissions"
  - [ ] Map 404 → "Not found"
  - [ ] Map 500 → "Server error"
  - [ ] Map 503 → "Service unavailable"
- [ ] Update error messages shown to users
  - [ ] Replace raw error messages with friendly versions
  - [ ] Add actionable next steps
- [ ] Test retry behavior
  - [ ] Mock transient errors
  - [ ] Verify exponential backoff timing
  - [ ] Verify max retries limit

---

### 10. Add Storage Quota Monitoring
**Priority:** HIGH | **Estimated Time:** 3 hours
**Reference:** BEST_PRACTICES.md:1289-1303

- [ ] Create `src/utils/storage-monitor.js`
- [ ] Implement `checkStorageQuota()` function
  - [ ] Get bytes in use: `chrome.storage.local.getBytesInUse()`
  - [ ] Get quota limit: `chrome.storage.local.QUOTA_BYTES` (10MB)
  - [ ] Calculate percentage used
  - [ ] Return stats object
- [ ] Implement `cleanupOldCache()` function
  - [ ] Remove oldest LRU cache entries
  - [ ] Remove expired credentials (if any)
  - [ ] Target: free up 20% of quota
- [ ] Add monitoring in `background-handlers.js`
  - [ ] Check quota after each sync operation
  - [ ] Log warning if >80% used
  - [ ] Auto-cleanup if >90% used
- [ ] Add quota display in popup UI
  - [ ] Show storage usage bar
  - [ ] Show warning if high usage
  - [ ] Add manual "Clear Old Cache" button
- [ ] Add unit tests for storage monitoring

---

### 11. Improve User-Facing Monitoring
**Priority:** HIGH | **Estimated Time:** 8 hours
**Reference:** BEST_PRACTICES.md:1419-1467

#### Sync Log Viewer
- [ ] Create `src/utils/sync-logger.js`
  - [ ] Implement `SyncLogger` class
  - [ ] Log each sync operation with timestamp
  - [ ] Store last 100 log entries in chrome.storage
  - [ ] Format logs with severity levels (info, warning, error)
- [ ] Update `assignment-syncer.js` to use sync logger
  - [ ] Log sync start/complete
  - [ ] Log each create/update/skip/delete
  - [ ] Log errors with context
- [ ] Add log viewer to popup UI
  - [ ] Create new "Sync Logs" section (collapsible)
  - [ ] Display last 20 logs
  - [ ] Color-code by severity
  - [ ] Add "View All" button to expand
  - [ ] Add "Clear Logs" button

#### Error Count Display
- [ ] Track error counts in sync status
  - [ ] Count errors per sync operation
  - [ ] Store cumulative error count
  - [ ] Reset on successful sync
- [ ] Display in popup
  - [ ] Show error count badge
  - [ ] Click to expand error details
  - [ ] Show specific error messages

#### Progress Indicators
- [ ] Implement progress tracking in `assignment-syncer.js`
  - [ ] Send progress messages to popup
  - [ ] Include: current/total assignments processed
  - [ ] Include: current operation (creating, updating, etc.)
- [ ] Update popup to receive progress
  - [ ] Listen for progress messages
  - [ ] Update UI with "Synced X/Y assignments"
  - [ ] Show progress bar
  - [ ] Show current operation status
- [ ] Add progress to content script sync button
  - [ ] Update button text with progress
  - [ ] Show percentage complete

---

### 12. Fix Notion Rate Limiter Settings
**Priority:** HIGH | **Estimated Time:** 3 hours
**Reference:** BEST_PRACTICES.md:220, 260-264

- [ ] Update rate limits in `notion-rate-limiter.js`
  - [ ] Change `maxRequestsPerSecond` from 25 to 5 (burst)
  - [ ] Change `averageRequestsPerSecond` from 10 to 3 (average)
  - [ ] Adjust `averageWindow` to 10 seconds (for 3 req/sec average)
  - [ ] Update comments to reflect Notion guidelines
- [ ] Remove or restrict `bypassRateLimit` flag
  - [ ] Option 1: Remove entirely from `notion-api.js`
  - [ ] Option 2: Only allow in test environment
  - [ ] Add environment check if keeping
- [ ] Test with adjusted limits
  - [ ] Verify 3 req/sec average is enforced
  - [ ] Verify burst handling still works
  - [ ] Test with large sync operations
- [ ] Update documentation
  - [ ] Update CLAUDE.md with new rate limits
  - [ ] Update comments in code

---

## 🔧 Medium Priority (Week 4+)

### 13. Optimize Canvas API Usage
**Priority:** MEDIUM | **Estimated Time:** 6 hours
**Reference:** BEST_PRACTICES.md:793-814

#### Parallel Batch Processing
- [ ] Refactor course processing in `content-script.js:107-202`
  - [ ] Change from sequential for loop to batched parallel
  - [ ] Create `processCoursesBatch()` helper function
  - [ ] Use `Promise.all()` for batch of 3-5 courses
  - [ ] Add small delay between batches
  - [ ] Handle partial batch failures gracefully
- [ ] Add progress reporting for parallel processing
  - [ ] Track completed courses
  - [ ] Update user with progress

#### Use Batch Submission Endpoint
- [ ] Research Canvas batch submissions endpoint
  - [ ] Investigate `/courses/:course_id/students/submissions`
  - [ ] Determine if it's more efficient than per-assignment
- [ ] Implement batch submission fetching
  - [ ] Replace individual submission calls
  - [ ] Map submissions back to assignments
  - [ ] Handle missing submissions
- [ ] Benchmark performance improvement

#### Request Deduplication
- [ ] Create in-flight request cache
  - [ ] Track pending requests by URL
  - [ ] Return existing promise if request in-flight
  - [ ] Clear after request completes
- [ ] Apply to `makeAPICall()`
  - [ ] Check cache before making request
  - [ ] Store promise in cache
  - [ ] Remove from cache on completion

---

### 14. Add Cache Statistics UI
**Priority:** MEDIUM | **Estimated Time:** 4 hours

- [ ] Update `assignment-cache-manager.js`
  - [ ] Add `getDetailedStats()` method
  - [ ] Include: total entries, hits, misses, hit rate
  - [ ] Include: storage size estimate
  - [ ] Include: oldest/newest entry timestamps
- [ ] Add cache stats section to popup
  - [ ] Create collapsible "Cache Statistics" section
  - [ ] Display hit rate as percentage
  - [ ] Display cache size
  - [ ] Display last cache clear time
  - [ ] Add "Clear Cache" button
  - [ ] Add "Refresh Stats" button
- [ ] Style cache stats
  - [ ] Use visual indicators (bars, colors)
  - [ ] Highlight high hit rates (good)
  - [ ] Warn if cache size is large
- [ ] Update cache stats on sync completion
  - [ ] Refresh stats display
  - [ ] Show improvement over time

---

### 15. Improve Code Quality
**Priority:** MEDIUM | **Estimated Time:** 8 hours

#### Break Up Long Functions
- [ ] Refactor `content-script.js:extractWithAPIToken()`
  - [ ] Extract `fetchCourses()` helper
  - [ ] Extract `fetchAssignmentsForCourse()` helper
  - [ ] Extract `fetchSubmissionForAssignment()` helper
  - [ ] Extract `transformAssignment()` helper
  - [ ] Keep main function as orchestrator
- [ ] Refactor `popup.js` if needed
  - [ ] Break up long event handlers
  - [ ] Extract validation logic to helpers

#### Use More Destructuring
- [ ] Update `message-handlers.js`
  - [ ] Destructure `request` parameter: `const { action, ... } = request`
  - [ ] Apply throughout file
- [ ] Update `assignment-syncer.js`
  - [ ] Destructure assignment properties where appropriate
- [ ] Update other files as needed

#### Use Optional Chaining
- [ ] Replace manual null checks with `?.`
  - [ ] `assignment.submission ? assignment.submission.grade : null` → `assignment.submission?.grade`
  - [ ] Apply throughout codebase
  - [ ] Focus on `content-script.js` and `assignment-syncer.js`

#### Add JSDoc Comments
- [ ] Add JSDoc to public methods in `CanvasAPIExtractor`
  - [ ] Document parameters and return types
  - [ ] Document thrown errors
- [ ] Add JSDoc to `NotionAPI` methods
- [ ] Add JSDoc to `AssignmentSyncer` methods
- [ ] Add JSDoc to all validator functions
- [ ] Add JSDoc to cache manager methods

---

### 16. Enhance Error Messages
**Priority:** MEDIUM | **Estimated Time:** 4 hours
**Reference:** BEST_PRACTICES.md:355-368

#### Create Error Message Mapper
- [ ] Create `src/utils/error-messages.js`
- [ ] Implement Canvas error mapping
  - [ ] Map all common Canvas error codes
  - [ ] Include actionable next steps
  - [ ] Link to documentation where helpful
- [ ] Implement Notion error mapping
  - [ ] Map Notion error codes
  - [ ] Special handling for permission errors
  - [ ] Guide users to share database

#### Apply Error Mapping
- [ ] Update Canvas error handling
  - [ ] Use error mapper in catch blocks
  - [ ] Show user-friendly messages in notifications
  - [ ] Include next steps in popup errors
- [ ] Update Notion error handling
  - [ ] Use error mapper
  - [ ] Provide guidance for common issues
- [ ] Add error documentation
  - [ ] Create troubleshooting guide
  - [ ] Link from error messages

---

## 💡 Low Priority (Future Enhancements)

### 17. Add Circuit Breaker Pattern
**Priority:** LOW | **Estimated Time:** 5 hours

- [ ] Create `src/utils/circuit-breaker.js`
- [ ] Implement `CircuitBreaker` class
  - [ ] Track failure count per endpoint
  - [ ] Open circuit after threshold (e.g., 5 failures)
  - [ ] Implement half-open state for retry
  - [ ] Reset after successful requests
- [ ] Integrate with error handler
  - [ ] Wrap API calls with circuit breaker
  - [ ] Skip requests when circuit is open
  - [ ] Log circuit breaker state changes
- [ ] Add circuit breaker status to monitoring
  - [ ] Show in popup if any circuits are open
  - [ ] Allow manual reset

---

### 18. Implement Monitoring Dashboard
**Priority:** LOW | **Estimated Time:** 12 hours

- [ ] Create `src/utils/analytics.js`
  - [ ] Track API calls over time
  - [ ] Track sync success/failure rates
  - [ ] Track average sync duration
  - [ ] Store metrics in chrome.storage
- [ ] Create dashboard page `dashboard.html`
  - [ ] Create separate HTML page (not popup)
  - [ ] Display API usage charts
  - [ ] Display sync history graph
  - [ ] Display cache performance metrics
  - [ ] Display error frequency
- [ ] Link dashboard from popup
  - [ ] Add "View Dashboard" button
  - [ ] Open in new tab
- [ ] Add export functionality
  - [ ] Export metrics as JSON
  - [ ] Export sync logs as CSV

---

### 19. Add More Granular Permissions
**Priority:** LOW | **Estimated Time:** 3 hours

- [ ] Review current permissions in `manifest.json`
  - [ ] Identify which are strictly necessary
  - [ ] Identify which could be optional
- [ ] Convert to optional permissions where possible
  - [ ] Use `optional_permissions` in manifest
  - [ ] Request at runtime when needed
  - [ ] Add permission management to popup
- [ ] Document permission usage
  - [ ] Explain why each permission is needed
  - [ ] Add to README

---

### 20. Add Canvas Token Validation
**Priority:** LOW | **Estimated Time:** 2 hours
**Reference:** BEST_PRACTICES.md:39-44

- [ ] Create `src/validators/token-validator.js`
- [ ] Implement `validateCanvasToken(token)` function
  - [ ] Check token is string
  - [ ] Check length (typically 69-70 characters)
  - [ ] Check format (alphanumeric with ~)
  - [ ] Return boolean
- [ ] Apply validation in multiple places
  - [ ] In popup when saving token
  - [ ] In content script before making API calls
  - [ ] Show specific error for invalid format
- [ ] Add token format help text in popup
  - [ ] Explain where to get token
  - [ ] Show expected format

---

### 21. Improve Canvas URL Validation
**Priority:** LOW | **Estimated Time:** 2 hours
**Reference:** BEST_PRACTICES.md:117-126

- [ ] Create `src/utils/url-validator.js`
- [ ] Implement `isValidCanvasUrl(url)` function
  - [ ] Use try-catch with URL constructor
  - [ ] Check hostname ends with `.instructure.com`
  - [ ] Or check hostname contains `canvas`
  - [ ] Return boolean
- [ ] Apply in `content-script.js:detectCanvasInstance()`
  - [ ] Validate detected URL
  - [ ] Show error if invalid
- [ ] Add unit tests for URL validation

---

### 22. Add Request Duration Tracking
**Priority:** LOW | **Estimated Time:** 3 hours
**Reference:** BEST_PRACTICES.md:1313-1335

- [ ] Create `src/utils/request-logger.js`
- [ ] Implement `loggedCanvasRequest()` wrapper
  - [ ] Generate unique request ID
  - [ ] Log request start with timestamp
  - [ ] Execute request
  - [ ] Calculate duration
  - [ ] Log response with duration and status
  - [ ] Include rate limit headers
- [ ] Wrap Canvas API calls
  - [ ] Apply to `makeAPICall()`
- [ ] Store request metrics
  - [ ] Track average duration per endpoint
  - [ ] Identify slow endpoints
- [ ] Display in monitoring dashboard
  - [ ] Show slowest endpoints
  - [ ] Show average request time

---

### 23. Implement Schema Caching for Notion
**Priority:** LOW | **Estimated Time:** 4 hours
**Reference:** BEST_PRACTICES.md:852-902

- [ ] Create `src/cache/notion-schema-cache.js`
- [ ] Implement `NotionSchemaCache` class
  - [ ] Cache database schema with 1 hour TTL
  - [ ] Store select options for validation
  - [ ] Implement `getSchema()` method
  - [ ] Implement `invalidate()` method
- [ ] Update `AssignmentSyncer` to use schema cache
  - [ ] Fetch schema once at initialization
  - [ ] Cache for duration of sync operation
  - [ ] Use for validation of select options
- [ ] Add "Refresh Schema" button in popup
  - [ ] Allow users to manually refresh
  - [ ] Clear schema cache

---

## 📊 Progress Tracking

### Compliance Target
- **Current:** 65% compliant
- **Target:** 90% compliant
- **Estimated Timeline:** 4-6 weeks

### Completion by Priority
- **Critical (7 items):** ☑☑☑☐☐☐☐ (3/7 complete)
- **High (5 items):** ☑☐☐☐☐ (1/5 partially — rate limit retry done, error mapping remaining)
- **Medium (4 items):** ☐☐☐☐ (0/4 complete)
- **Low (11 items):** ☐☐☐☐☐☐☐☐☐☐☐ (0/11 complete)

### Overall Progress
```
Critical:    [████████████░░░░░░░░░░░░░░░░░░] 43%
High:        [████░░░░░░░░░░░░░░░░░░░░░░░░░░] 12%
Medium:      [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%
Low:         [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%
─────────────────────────────────────────────
Total:       [█████░░░░░░░░░░░░░░░░░░░░░░░░░] 15%
```

---

## 📝 Notes

- Use `git checkout -b feature/name` for each implementation
- Run tests after each change: `npm test`
- Run security checks: `npm run check:security`
- Run performance checks: `npm run check:performance`
- Update this file as you complete items (check the boxes)
- Reference the full compliance report for detailed explanations

---

**Last Updated:** 2026-02-17
