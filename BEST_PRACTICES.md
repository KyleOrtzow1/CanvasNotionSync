# Best Practices Guide

This document provides comprehensive best practices for the Canvas-Notion Assignment Sync extension, covering both Canvas API and Notion API integration, as well as Chrome extension development.

## Table of Contents

- [Authentication & Security](#authentication--security)
- [Rate Limiting & Request Management](#rate-limiting--request-management)
- [Error Handling & Retry Logic](#error-handling--retry-logic)
- [Data Integrity & Validation](#data-integrity--validation)
- [Performance Optimization](#performance-optimization)
- [API Request Patterns](#api-request-patterns)
- [Pagination Strategies](#pagination-strategies)
- [Caching & Storage](#caching--storage)
- [Monitoring & Logging](#monitoring--logging)
- [User Experience](#user-experience)
- [Code Organization](#code-organization)
- [Testing](#testing)
- [Deployment & Maintenance](#deployment--maintenance)

---

## Authentication & Security

### Canvas API - Token Management

**✓ DO:**
- Use the `Authorization` header for access tokens (never query parameters)
  ```javascript
  headers: {
    'Authorization': 'Bearer YOUR_CANVAS_TOKEN'
  }
  ```
- Store tokens securely with AES-GCM encryption (already implemented in extension)
- Request minimal OAuth scopes necessary for functionality
- Validate tokens before making API calls
- Provide clear instructions for users to generate Canvas tokens

**✗ DON'T:**
- Never log or expose tokens in client-side code or console
- Never commit tokens to version control
- Don't store tokens in plain text in localStorage or chrome.storage
- Don't include tokens in URLs or query parameters
- Don't use tokens across different Canvas instances without validation

**Implementation Example:**
```javascript
// Current extension implementation (GOOD)
class CredentialManager {
  async encryptData(data) {
    const key = await this.getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(data))
    )
    return { encrypted: Array.from(new Uint8Array(encrypted)), iv: Array.from(iv) }
  }
}
```

---

### Notion API - Integration Security

**✓ DO:**
- Store integration tokens in encrypted storage (using same AES-GCM as Canvas)
- Use environment variables during development
- Create separate integrations for development and production
- Rotate tokens periodically (every 90 days recommended)
- Audit token permissions regularly
- Always include `Notion-Version` header in every request
  ```javascript
  headers: {
    'Authorization': 'Bearer secret_...',
    'Notion-Version': '2025-09-03',
    'Content-Type': 'application/json'
  }
  ```

**✗ DON'T:**
- Never expose internal integration tokens in public repositories
- Don't use the same token across multiple projects
- Don't grant more permissions than necessary
- Don't forget to revoke tokens when no longer needed
- Don't hardcode tokens in source code

**Permission Best Practices:**
- Only request permissions you actually use
- Start with minimal permissions and expand as needed
- Document why each permission is required
- Remind users to share databases with the integration

---

### Chrome Extension Security

**✓ DO:**
- Use Content Security Policy (CSP) to prevent XSS attacks
- Validate all user inputs before processing
- Sanitize HTML content from Canvas before displaying
- Use `chrome.storage.local` with encryption for sensitive data
- Implement secure cleanup on extension uninstall/suspend (already implemented)
- Validate URLs before making requests
- Use HTTPS for all API calls

**✗ DON'T:**
- Never use `eval()` or `new Function()` with user input
- Don't inject untrusted scripts into pages
- Don't expose API tokens to content scripts
- Don't trust data from web pages without validation
- Don't store passwords or credit card information

**Security Checklist:**
```javascript
// Validate Canvas instance URL
function isValidCanvasUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.endsWith('.instructure.com') ||
           parsed.hostname.includes('canvas')
  } catch {
    return false
  }
}

// Sanitize HTML from Canvas
function sanitizeHTML(html) {
  const div = document.createElement('div')
  div.textContent = html // Converts to plain text, removing all HTML
  return div.innerHTML
}
```

---

## Rate Limiting & Request Management

### Canvas API - Leaky Bucket Algorithm

**Understanding Canvas Rate Limits:**
- **Algorithm:** Leaky bucket with dynamic cost
- **Request Cost:** CPU time (seconds) + Database time (seconds)
- **Bucket Capacity:** 700 units (High Water Mark)
- **Leak Rate:** 10 units/second (default)
- **Recovery Time:** Full bucket empties in ~60 seconds
- **Throttle Response:** 403 Forbidden (not 429!)

**✓ DO:**
- Monitor `X-Request-Cost` and `X-Rate-Limit-Remaining` headers on every request
  ```javascript
  const cost = parseFloat(response.headers.get('X-Request-Cost'))
  const remaining = parseFloat(response.headers.get('X-Rate-Limit-Remaining'))

  console.log(`Request cost: ${cost}, Remaining: ${remaining}`)

  if (remaining < 100) {
    // Slow down requests
    await wait(1000)
  }
  ```
- Run processes sequentially when possible (bucket leaks faster than it fills)
- Implement exponential backoff for 403 rate limit responses
- Use batch endpoints when available (e.g., list submissions for multiple assignments)
- Contact Customer Success Manager for high-volume usage optimization

**✗ DON'T:**
- Don't make rapid concurrent requests without monitoring headers
- Don't ignore `X-Request-Cost` warnings
- Don't retry immediately after receiving 403 rate limit error
- Don't assume you have remaining quota without checking headers
- Don't make unnecessary API calls that could be cached

**Implementation Example:**
```javascript
class CanvasRateLimiter {
  constructor() {
    this.bucket = 700 // Full bucket
    this.leakRate = 10 // units per second
    this.lastCheck = Date.now()
  }

  async waitIfNeeded(estimatedCost = 2) {
    const now = Date.now()
    const timePassed = (now - this.lastCheck) / 1000

    // Refill bucket based on leak rate
    this.bucket = Math.min(700, this.bucket + (timePassed * this.leakRate))
    this.lastCheck = now

    // Wait if not enough capacity
    if (this.bucket < estimatedCost) {
      const waitTime = ((estimatedCost - this.bucket) / this.leakRate) * 1000
      await new Promise(resolve => setTimeout(resolve, waitTime))
      this.bucket = 0
    } else {
      this.bucket -= estimatedCost
    }
  }

  updateFromHeaders(headers) {
    const cost = parseFloat(headers.get('X-Request-Cost') || '0')
    const remaining = parseFloat(headers.get('X-Rate-Limit-Remaining'))

    if (!isNaN(remaining)) {
      this.bucket = remaining
    }

    return { cost, remaining }
  }
}
```

---

### Notion API - Average Rate Limiting

**Understanding Notion Rate Limits:**
- **Average:** 3 requests per second
- **Bursts:** Temporary bursts beyond 3 req/sec allowed
- **Calculated per:** Integration token (not workspace/user)
- **Throttle Response:** 429 with `Retry-After` header

**✓ DO:**
- Implement token bucket or leaky bucket rate limiter (already implemented in extension)
  ```javascript
  class NotionRateLimiter {
    constructor() {
      this.tokens = 5 // Burst capacity
      this.lastRefill = Date.now()
      this.refillRate = 3 // per second
    }

    async acquire() {
      const now = Date.now()
      const timePassed = (now - this.lastRefill) / 1000

      // Refill tokens based on time passed
      this.tokens = Math.min(5, this.tokens + (timePassed * this.refillRate))
      this.lastRefill = now

      // Wait if no tokens available
      if (this.tokens < 1) {
        const waitTime = ((1 - this.tokens) / this.refillRate) * 1000
        await new Promise(resolve => setTimeout(resolve, waitTime))
        this.tokens = 0
      } else {
        this.tokens -= 1
      }
    }
  }
  ```
- Respect `Retry-After` header in 429 responses (value is in seconds)
- Use batch operations when possible (create page with 100 blocks in one request)
- Queue requests during high load periods
- Monitor and log rate limit hits

**✗ DON'T:**
- Don't make more than 3 requests per second on average
- Don't retry immediately after 429 without waiting
- Don't ignore `Retry-After` header
- Don't use multiple tokens to bypass rate limits (violates terms)
- Don't assume bursts are unlimited (they're temporary)

**Handling 429 Responses:**
```javascript
async function makeNotionRequest(url, options) {
  try {
    await rateLimiter.acquire()
    const response = await fetch(url, options)

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5')
      console.warn(`Rate limited. Waiting ${retryAfter} seconds...`)
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
      return makeNotionRequest(url, options) // Retry
    }

    return response
  } catch (error) {
    console.error('Notion API error:', error)
    throw error
  }
}
```

---

### Extension - Coordinated Rate Limiting

**✓ DO:**
- Use the existing `NotionRateLimiter` class with bypass option for testing
- Coordinate rate limiting across multiple sync operations
- Show progress indicators during rate-limited operations
- Batch Canvas API calls when syncing multiple courses
- Implement request queuing for user-initiated actions

**✗ DON'T:**
- Don't make Canvas and Notion requests simultaneously at maximum rate
- Don't block UI while waiting for rate limits
- Don't retry failed requests without exponential backoff
- Don't sync large datasets without user confirmation

---

## Error Handling & Retry Logic

### Canvas API - Error Responses

**Common Canvas Error Codes:**
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (rate limited or insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `422` - Unprocessable Entity (validation error)
- `500`/`503` - Server errors (retry with backoff)

**✓ DO:**
- Implement exponential backoff for transient errors (500, 503, network errors)
  ```javascript
  async function canvasRequestWithRetry(fn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        const isTransient = error.status >= 500 || error.code === 'NETWORK_ERROR'
        const isRateLimit = error.status === 403 && error.message.includes('rate')

        if ((isTransient || isRateLimit) && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
          console.log(`Retry attempt ${attempt + 1} after ${delay}ms`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        throw error
      }
    }
  }
  ```
- Parse Canvas error messages for user-friendly display
- Log errors with context (request URL, parameters, but NOT tokens)
- Handle authentication errors by prompting for new token
- Validate Canvas URLs before making requests

**✗ DON'T:**
- Don't retry 4xx errors (except 429/rate limits) - they won't succeed
- Don't retry authentication errors (401) without new credentials
- Don't log full request/response bodies (may contain sensitive data)
- Don't show raw API error messages to users
- Don't retry indefinitely without maximum attempt limit

**Error Message Mapping:**
```javascript
function getUserFriendlyCanvasError(error) {
  const errorMap = {
    401: 'Canvas token is invalid or expired. Please update your credentials.',
    403: 'Rate limit reached or insufficient permissions. Please wait and try again.',
    404: 'Assignment or course not found. It may have been deleted.',
    422: 'Invalid data format. Please check assignment details.',
    500: 'Canvas server error. Please try again in a few minutes.',
    503: 'Canvas is temporarily unavailable. Please try again later.'
  }

  return errorMap[error.status] || 'An unexpected error occurred. Please try again.'
}
```

---

### Notion API - Error Responses

**Common Notion Error Codes:**
- `400` - `validation_error`, `invalid_json`, `invalid_request_url`, `invalid_request`
- `401` - `unauthorized` (invalid/missing token)
- `403` - `restricted_resource` (no access to resource)
- `404` - `object_not_found` (page/database doesn't exist)
- `409` - `conflict_error` (transaction failed)
- `429` - `rate_limited` (too many requests)
- `500` - `internal_server_error` (retry with backoff)
- `503` - `service_unavailable` (retry with backoff)

**✓ DO:**
- Check error codes and provide specific handling
  ```javascript
  async function handleNotionError(error) {
    switch (error.code) {
      case 'rate_limited':
        const retryAfter = parseInt(error.headers['retry-after'] || '5')
        await wait(retryAfter * 1000)
        return 'RETRY'

      case 'restricted_resource':
        return 'PERMISSION_ERROR: Database not shared with integration'

      case 'object_not_found':
        return 'NOT_FOUND: Page or database no longer exists'

      case 'validation_error':
        return `VALIDATION: ${error.message}`

      case 'unauthorized':
        return 'AUTH_ERROR: Invalid Notion token'

      default:
        if (error.status >= 500) {
          return 'RETRY'
        }
        return `ERROR: ${error.message}`
    }
  }
  ```
- Validate request bodies before sending to avoid validation errors
- Catch permission errors and guide users to share databases
- Implement retry for conflict errors (409)
- Log error context (error code, status, message, but NOT tokens)

**✗ DON'T:**
- Don't retry validation errors (400) - fix the request instead
- Don't retry permission errors (403) - user action required
- Don't retry not found errors (404) - resource doesn't exist
- Don't expose internal error details to users
- Don't continue syncing after critical errors

**Validation Before Request:**
```javascript
function validateNotionPageProperties(properties) {
  const errors = []

  for (const [name, prop] of Object.entries(properties)) {
    // Title is required
    if (prop.type === 'title' && (!prop.title || prop.title.length === 0)) {
      errors.push(`${name}: Title property cannot be empty`)
    }

    // Date format validation
    if (prop.type === 'date' && prop.date) {
      if (!isValidISO8601(prop.date.start)) {
        errors.push(`${name}: Invalid date format (expected ISO 8601)`)
      }
    }

    // Select requires name
    if (prop.type === 'select' && prop.select && !prop.select.name) {
      errors.push(`${name}: Select property requires a name`)
    }

    // Number validation
    if (prop.type === 'number' && prop.number !== null) {
      if (typeof prop.number !== 'number' || isNaN(prop.number)) {
        errors.push(`${name}: Invalid number value`)
      }
    }

    // Rich text character limit
    if (prop.type === 'rich_text') {
      const totalChars = prop.rich_text.reduce((sum, rt) =>
        sum + rt.text.content.length, 0
      )
      if (totalChars > 2000) {
        errors.push(`${name}: Rich text exceeds 2000 character limit`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.join('\n')}`)
  }
}
```

---

### Extension - Centralized Error Handling

**✓ DO:**
- Create a centralized error handler for both APIs
- Show user-friendly notifications for common errors
- Provide actionable error messages with next steps
- Log errors with sufficient context for debugging
- Track error frequency to identify systemic issues
- Implement circuit breaker pattern for repeated failures

**Implementation Example:**
```javascript
class ErrorHandler {
  constructor() {
    this.errorCounts = new Map()
    this.circuitBreakerThreshold = 5
  }

  async handleError(error, context) {
    const errorKey = `${context.api}:${error.code || error.status}`
    const count = (this.errorCounts.get(errorKey) || 0) + 1
    this.errorCounts.set(errorKey, count)

    // Circuit breaker: too many errors from one source
    if (count >= this.circuitBreakerThreshold) {
      return {
        shouldRetry: false,
        userMessage: `Too many errors from ${context.api}. Please check your settings and try again later.`,
        action: 'CIRCUIT_BREAKER'
      }
    }

    // API-specific handling
    if (context.api === 'Canvas') {
      return this.handleCanvasError(error, context)
    } else if (context.api === 'Notion') {
      return this.handleNotionError(error, context)
    }
  }

  resetErrorCount(key) {
    this.errorCounts.delete(key)
  }
}
```

**✗ DON'T:**
- Don't swallow errors silently
- Don't show technical error messages to end users
- Don't retry errors without informing the user
- Don't continue operations after critical failures

---

## Data Integrity & Validation

### Canvas API - Data Validation

**✓ DO:**
- Validate assignment data before processing
  ```javascript
  function validateCanvasAssignment(assignment) {
    if (!assignment.id) {
      throw new Error('Assignment missing required field: id')
    }

    if (!assignment.name || assignment.name.trim() === '') {
      throw new Error('Assignment missing required field: name')
    }

    if (assignment.due_at && !isValidISO8601(assignment.due_at)) {
      console.warn(`Invalid due_at format for assignment ${assignment.id}`)
      assignment.due_at = null
    }

    if (assignment.points_possible !== null &&
        (typeof assignment.points_possible !== 'number' ||
         assignment.points_possible < 0)) {
      console.warn(`Invalid points_possible for assignment ${assignment.id}`)
      assignment.points_possible = null
    }

    return assignment
  }
  ```
- Use Canvas ID as the source of truth for deduplication
- Handle null/undefined values gracefully
- Validate date formats (ISO 8601) before using
- Check for required fields (id, name, course_id)
- Sanitize HTML descriptions before displaying or syncing

**✗ DON'T:**
- Don't assume all fields are present
- Don't trust points_possible to always be a number
- Don't use assignment names for deduplication (they can change)
- Don't ignore validation warnings
- Don't sync malformed data to Notion

---

### Notion API - Data Validation

**✓ DO:**
- Validate property types match database schema
- Check required properties (title) are present
- Ensure date properties use ISO 8601 format
- Verify select/multi-select values exist in schema options
- Validate rich text character limits (2,000 chars per object)
- Check block limits (100 per request, 1,000 total)
- Validate URLs are properly formatted
- Ensure number values are actual numbers, not strings

**Validation Helper:**
```javascript
class NotionValidator {
  static validateDateProperty(date) {
    if (!date) return null

    const iso8601Regex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/
    if (!iso8601Regex.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected ISO 8601.`)
    }

    return date
  }

  static validateSelectOption(value, options) {
    const validOptions = options.map(opt => opt.name)
    if (!validOptions.includes(value)) {
      throw new Error(`Invalid select value: "${value}". Valid options: ${validOptions.join(', ')}`)
    }
    return value
  }

  static validateRichText(richTextArray) {
    if (!Array.isArray(richTextArray)) {
      throw new Error('Rich text must be an array')
    }

    for (const rt of richTextArray) {
      if (rt.text.content.length > 2000) {
        throw new Error('Rich text object exceeds 2000 character limit')
      }
    }

    return richTextArray
  }

  static splitLongText(text, maxChars = 2000) {
    if (text.length <= maxChars) {
      return [{ type: 'text', text: { content: text } }]
    }

    const chunks = []
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({
        type: 'text',
        text: { content: text.substring(i, i + maxChars) }
      })
    }

    return chunks
  }
}
```

**✗ DON'T:**
- Don't send properties not defined in database schema
- Don't use invalid select option names
- Don't exceed rich text character limits
- Don't send more than 100 blocks in one request
- Don't assume property IDs remain constant (use names)

---

### Extension - Cross-API Data Mapping

**✓ DO:**
- Create a consistent mapping between Canvas and Notion data models
  ```javascript
  class AssignmentMapper {
    static canvasToNotion(canvasAssignment) {
      return {
        properties: {
          'Name': {
            title: [
              { type: 'text', text: { content: canvasAssignment.name || 'Untitled' } }
            ]
          },
          'Due Date': {
            date: canvasAssignment.due_at ? {
              start: new Date(canvasAssignment.due_at).toISOString()
            } : null
          },
          'Points': {
            number: canvasAssignment.points_possible || null
          },
          'Canvas ID': {
            number: canvasAssignment.id
          },
          'Canvas Link': {
            url: canvasAssignment.html_url || null
          },
          'Course': {
            rich_text: [
              { type: 'text', text: { content: canvasAssignment.course_name || '' } }
            ]
          }
        }
      }
    }

    static notionToCanvas(notionPage) {
      // For future bidirectional sync
      return {
        name: notionPage.properties.Name.title[0]?.text.content,
        due_at: notionPage.properties['Due Date'].date?.start,
        points_possible: notionPage.properties.Points.number
      }
    }
  }
  ```
- Use Canvas ID stored in Notion for deduplication
- Handle missing/null values at mapping layer
- Validate mapped data before sending to either API
- Log mapping failures for debugging
- Preserve data types during transformation

**✗ DON'T:**
- Don't lose data during transformation
- Don't assume all Canvas fields map to Notion properties
- Don't modify Canvas IDs or use them for display
- Don't sync without validating the mapping
- Don't create duplicate pages due to poor deduplication

**Deduplication Strategy:**
```javascript
async function findExistingNotionPage(dataSourceId, canvasId) {
  const response = await notion.databases.query({
    database_id: dataSourceId,
    filter: {
      property: 'Canvas ID',
      number: {
        equals: canvasId
      }
    }
  })

  return response.results.length > 0 ? response.results[0] : null
}

async function syncAssignment(canvasAssignment, dataSourceId) {
  const existingPage = await findExistingNotionPage(
    dataSourceId,
    canvasAssignment.id
  )

  const properties = AssignmentMapper.canvasToNotion(canvasAssignment).properties

  if (existingPage) {
    // Update existing page
    return notion.pages.update({
      page_id: existingPage.id,
      properties
    })
  } else {
    // Create new page
    return notion.pages.create({
      parent: { database_id: dataSourceId },
      properties
    })
  }
}
```

---

## Performance Optimization

### Canvas API - Optimization Strategies

**✓ DO:**
- Use `include[]` parameters to reduce API calls
  ```javascript
  // Good: Single request with all data
  GET /api/v1/courses/123/assignments?include[]=submission&include[]=score_statistics

  // Bad: Multiple requests
  GET /api/v1/courses/123/assignments
  GET /api/v1/courses/123/assignments/456/submissions
  GET /api/v1/courses/123/assignments/789/submissions
  ```
- Use batch endpoints when available
  ```javascript
  // Get all submissions for multiple assignments in one call
  GET /api/v1/courses/:course_id/students/submissions
  ```
- Request appropriate page sizes (50-100 items per page)
- Use specific queries instead of fetching all data and filtering client-side
- Cache course information (changes infrequently)
- Cache user data (changes infrequently)
- Make independent API calls in parallel
  ```javascript
  // Parallel requests for different courses
  const coursePromises = courseIds.map(id =>
    canvas.getCourseAssignments(id)
  )
  const results = await Promise.all(coursePromises)
  ```

**✗ DON'T:**
- Don't fetch all assignments then filter by due date (use Canvas filters)
- Don't make sequential requests when parallel is possible
- Don't request more data than needed
- Don't ignore `include[]` parameters
- Don't fetch full assignment details when list view is sufficient

**Efficient Batch Processing:**
```javascript
async function syncMultipleCourses(courseIds) {
  // Process in batches of 3 to respect rate limits
  const batchSize = 3
  const results = []

  for (let i = 0; i < courseIds.length; i += batchSize) {
    const batch = courseIds.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(courseId => syncCourse(courseId))
    )
    results.push(...batchResults)

    // Brief pause between batches
    if (i + batchSize < courseIds.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return results
}
```

---

### Notion API - Optimization Strategies

**✓ DO:**
- Batch page creation with child blocks (up to 100 blocks per request)
  ```javascript
  // Good: Create page with content in one request
  await notion.pages.create({
    parent: { database_id: dataSourceId },
    properties: {...},
    children: [
      { type: 'heading_2', heading_2: {...} },
      { type: 'paragraph', paragraph: {...} },
      { type: 'bulleted_list_item', bulleted_list_item: {...} }
    ]
  })

  // Bad: Create page then add blocks separately
  const page = await notion.pages.create({...})
  await notion.blocks.children.append({ block_id: page.id, children: [...] })
  ```
- Update multiple properties in single PATCH request
- Cache database schemas (don't fetch on every sync)
- Use filters to reduce query result size
- Request maximum page_size (100) when fetching all results
- Make parallel requests for independent operations
- Cache user mappings

**✗ DON'T:**
- Don't fetch entire database when you only need specific pages
- Don't make separate requests for each property update
- Don't query database schema on every page creation
- Don't ignore pagination when fetching all pages
- Don't make sequential requests when parallel is possible

**Schema Caching:**
```javascript
class NotionSchemaCache {
  constructor(ttl = 3600000) { // 1 hour TTL
    this.cache = new Map()
    this.ttl = ttl
  }

  async getSchema(dataSourceId, fetchFn) {
    const cached = this.cache.get(dataSourceId)

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.schema
    }

    const schema = await fetchFn()
    this.cache.set(dataSourceId, {
      schema,
      timestamp: Date.now()
    })

    return schema
  }

  invalidate(dataSourceId) {
    this.cache.delete(dataSourceId)
  }

  clear() {
    this.cache.clear()
  }
}

// Usage
const schemaCache = new NotionSchemaCache()

async function createNotionPage(dataSourceId, properties) {
  const schema = await schemaCache.getSchema(dataSourceId, () =>
    notion.databases.retrieve({ database_id: dataSourceId })
  )

  // Validate properties against schema
  validatePropertiesAgainstSchema(properties, schema.properties)

  // Create page
  return notion.pages.create({
    parent: { database_id: dataSourceId },
    properties
  })
}
```

---

### Extension - Overall Performance

**✓ DO:**
- Show progress indicators for long-running operations
- Implement background sync with Service Worker
- Use `chrome.alarms` for periodic sync instead of setInterval
- Debounce user-initiated sync actions
- Process assignments in batches with progress updates
- Use web workers for heavy computations
- Minimize content script execution time
- Lazy load features that aren't immediately needed

**✗ DON'T:**
- Don't block UI thread during sync operations
- Don't sync all courses simultaneously without user confirmation
- Don't make sync operations synchronous
- Don't process large datasets without chunking
- Don't poll APIs continuously

**Efficient Background Sync:**
```javascript
// In background.js
chrome.alarms.create('periodicSync', {
  delayInMinutes: 30,
  periodInMinutes: 30
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodicSync') {
    const tabs = await chrome.tabs.query({
      url: '*://*.instructure.com/*'
    })

    if (tabs.length > 0) {
      // User has Canvas open, perform sync
      await performBackgroundSync()
    }
  }
})

async function performBackgroundSync() {
  try {
    const courses = await getActiveCourses()
    let synced = 0
    let errors = 0

    for (const course of courses) {
      try {
        await syncCourse(course.id)
        synced++
      } catch (error) {
        errors++
        console.error(`Failed to sync course ${course.id}:`, error)
      }

      // Show progress notification
      if (synced % 5 === 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Sync Progress',
          message: `Synced ${synced}/${courses.length} courses`
        })
      }
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Sync Complete',
      message: `Synced ${synced} courses. ${errors} errors.`
    })
  } catch (error) {
    console.error('Background sync failed:', error)
  }
}
```

---

## API Request Patterns

### Canvas API - Request Patterns

**✓ DO:**
- Use specific Canvas IDs instead of paginated queries for targeted data
  ```javascript
  // Good: Direct query using Canvas ID
  GET /api/v1/courses/123/assignments?search_term=Assignment1

  // Better: If you have the Canvas ID
  GET /api/v1/courses/123/assignments/456
  ```
- Filter assignments by bucket to reduce response size
  ```javascript
  GET /api/v1/courses/123/assignments?bucket=upcoming
  ```
- Use search_term parameter to find specific assignments
- Order results to get most relevant data first
  ```javascript
  GET /api/v1/courses/123/assignments?order_by=due_at&per_page=50
  ```
- Leverage Canvas's server-side filtering instead of client-side

**✗ DON'T:**
- Don't fetch all assignments when you only need upcoming ones
- Don't use `-uall` flag with git status or Canvas list endpoints (memory issues)
- Don't ignore available query parameters
- Don't filter large datasets client-side

---

### Notion API - Request Patterns

**✓ DO:**
- Use compound filters to reduce query results
  ```javascript
  {
    filter: {
      and: [
        { property: 'Status', select: { equals: 'Active' } },
        { property: 'Due Date', date: { on_or_after: '2026-02-01' } }
      ]
    }
  }
  ```
- Sort results at query time, not client-side
  ```javascript
  {
    sorts: [
      { property: 'Due Date', direction: 'ascending' },
      { property: 'Priority', direction: 'descending' }
    ]
  }
  ```
- Request specific page_size based on your needs
- Use cursor-based pagination for large result sets
- Check for duplicates using Canvas ID filter before creating

**✗ DON'T:**
- Don't query all pages then filter in JavaScript
- Don't sort large datasets client-side
- Don't create pages without checking for duplicates first

---

## Pagination Strategies

### Canvas API - Pagination

**✓ DO:**
- Always use Link headers for pagination (treat URLs as opaque)
  ```javascript
  async function fetchAllPages(url) {
    const allResults = []
    let currentUrl = url

    while (currentUrl) {
      const response = await fetch(currentUrl, { headers: {...} })
      const data = await response.json()
      allResults.push(...data)

      // Parse Link header for next page
      const linkHeader = response.headers.get('Link')
      currentUrl = parseLinkHeader(linkHeader)?.next || null
    }

    return allResults
  }

  function parseLinkHeader(header) {
    if (!header) return {}

    const links = {}
    const parts = header.split(',')

    for (const part of parts) {
      const [url, rel] = part.split(';')
      const cleanUrl = url.trim().slice(1, -1) // Remove < >
      const relMatch = rel.match(/rel="(.+)"/)
      if (relMatch) {
        links[relMatch[1]] = cleanUrl
      }
    }

    return links
  }
  ```
- Set per_page to reasonable values (50-100)
- Check for next page before requesting
- Implement timeout for very large result sets
- Show progress indicator during pagination

**✗ DON'T:**
- Don't manually construct pagination URLs
- Don't assume page count based on per_page
- Don't fetch all pages if you only need first few results
- Don't use per_page > 100 (may cause issues)

---

### Notion API - Pagination

**✓ DO:**
- Always check `has_more` before requesting next page
- Use `next_cursor` exactly as returned (opaque string)
  ```javascript
  async function queryAllPages(dataSourceId, filter = {}) {
    const allResults = []
    let hasMore = true
    let startCursor = undefined

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: dataSourceId,
        filter,
        start_cursor: startCursor,
        page_size: 100
      })

      allResults.push(...response.results)
      hasMore = response.has_more
      startCursor = response.next_cursor

      // Optional: Progress callback
      if (onProgress) {
        onProgress(allResults.length)
      }
    }

    return allResults
  }
  ```
- Request page_size of 100 for bulk operations
- Implement progress tracking for user feedback
- Handle empty result sets gracefully

**✗ DON'T:**
- Don't modify or construct cursor values manually
- Don't assume next_cursor format or content
- Don't ignore has_more flag
- Don't request all pages if you only need first 10

---

## Caching & Storage

### Canvas API - Caching Strategy

**✓ DO:**
- Cache course information (courses don't change often)
  ```javascript
  class CourseCache {
    constructor(ttl = 86400000) { // 24 hours
      this.cache = new Map()
      this.ttl = ttl
    }

    async getCourse(courseId, fetchFn) {
      const cached = this.cache.get(courseId)

      if (cached && Date.now() - cached.timestamp < this.ttl) {
        return cached.data
      }

      const data = await fetchFn()
      this.cache.set(courseId, {
        data,
        timestamp: Date.now()
      })

      return data
    }

    invalidate(courseId) {
      this.cache.delete(courseId)
    }
  }
  ```
- Cache user information (users rarely change)
- Cache Canvas instance URL (from current tab)
- Store last sync timestamp to fetch only new assignments
- Use chrome.storage for persistent cache
- Set appropriate TTL based on data volatility

**✗ DON'T:**
- Don't cache assignment data (changes frequently)
- Don't cache submission status (changes frequently)
- Don't cache without TTL or invalidation strategy
- Don't exceed chrome.storage quota limits (10MB)

---

### Notion API - Caching Strategy

**✓ DO:**
- Cache database schemas (properties rarely change)
- Cache data source IDs after discovery
- Cache Notion workspace users
- Store page ID mappings (Canvas ID → Notion Page ID)
- Implement cache invalidation on user request
- Use LRU cache for page ID mappings

**Implementation:**
```javascript
class PageIdCache {
  constructor(maxSize = 1000) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  set(canvasId, notionPageId) {
    // LRU: Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    this.cache.set(canvasId, notionPageId)
  }

  get(canvasId) {
    const value = this.cache.get(canvasId)

    if (value) {
      // LRU: Move to end (delete and re-add)
      this.cache.delete(canvasId)
      this.cache.set(canvasId, value)
    }

    return value
  }

  has(canvasId) {
    return this.cache.has(canvasId)
  }

  clear() {
    this.cache.clear()
  }
}
```

**✗ DON'T:**
- Don't cache page properties (may change frequently)
- Don't cache without size limits (memory leaks)
- Don't trust stale cache entries

---

### Extension - Storage Management

**✓ DO:**
- Use `chrome.storage.local` for extension settings
- Encrypt sensitive data before storage (already implemented)
- Implement data cleanup on uninstall (already implemented)
- Store sync metadata (last sync time, error counts)
- Version your storage schema for migrations
  ```javascript
  const STORAGE_VERSION = 2

  async function migrateStorage() {
    const { version = 1 } = await chrome.storage.local.get('version')

    if (version < 2) {
      // Perform migration
      const oldData = await chrome.storage.local.get(null)
      const newData = transformToV2(oldData)
      await chrome.storage.local.clear()
      await chrome.storage.local.set({ ...newData, version: 2 })
    }
  }
  ```
- Monitor storage quota usage
- Compress large data before storage

**✗ DON'T:**
- Don't store large binary data in chrome.storage
- Don't store credentials unencrypted
- Don't exceed storage quotas (causes sync failures)
- Don't store temporary data (use in-memory cache)

**Storage Quota Monitoring:**
```javascript
async function checkStorageQuota() {
  const bytesInUse = await chrome.storage.local.getBytesInUse()
  const quota = chrome.storage.local.QUOTA_BYTES // 10MB
  const percentUsed = (bytesInUse / quota) * 100

  if (percentUsed > 80) {
    console.warn(`Storage quota ${percentUsed.toFixed(1)}% used`)
    // Cleanup old cache entries
    await cleanupOldCache()
  }

  return { bytesInUse, quota, percentUsed }
}
```

---

## Monitoring & Logging

### Canvas API - Monitoring

**✓ DO:**
- Log all API requests with timestamps and duration
  ```javascript
  async function loggedCanvasRequest(url, options) {
    const startTime = Date.now()
    const requestId = generateRequestId()

    console.log(`[${requestId}] Canvas Request: ${options.method || 'GET'} ${url}`)

    try {
      const response = await fetch(url, options)
      const duration = Date.now() - startTime
      const cost = response.headers.get('X-Request-Cost')
      const remaining = response.headers.get('X-Rate-Limit-Remaining')

      console.log(`[${requestId}] Response: ${response.status} (${duration}ms, cost: ${cost}, remaining: ${remaining})`)

      return response
    } catch (error) {
      const duration = Date.now() - startTime
      console.error(`[${requestId}] Error after ${duration}ms:`, error.message)
      throw error
    }
  }
  ```
- Track rate limit usage (X-Request-Cost, X-Rate-Limit-Remaining)
- Monitor average request duration
- Log failed requests with context
- Track sync success/failure rates
- Alert on repeated failures from same endpoint

**✗ DON'T:**
- Don't log access tokens or sensitive data
- Don't log full request/response bodies (privacy + performance)
- Don't use console.log in production (use logging service)
- Don't ignore error patterns

---

### Notion API - Monitoring

**✓ DO:**
- Log all API requests with context
- Track 429 rate limit responses
- Monitor average response times
- Log validation errors with property details
- Track sync operations (created vs updated pages)
- Monitor Retry-After values to adjust rate limiting
  ```javascript
  class NotionMonitor {
    constructor() {
      this.stats = {
        requests: 0,
        rateLimits: 0,
        errors: 0,
        created: 0,
        updated: 0,
        totalDuration: 0
      }
    }

    recordRequest(duration, status) {
      this.stats.requests++
      this.stats.totalDuration += duration

      if (status === 429) {
        this.stats.rateLimits++
      } else if (status >= 400) {
        this.stats.errors++
      }
    }

    recordPageOperation(operation) {
      if (operation === 'create') {
        this.stats.created++
      } else if (operation === 'update') {
        this.stats.updated++
      }
    }

    getStats() {
      return {
        ...this.stats,
        averageDuration: this.stats.totalDuration / this.stats.requests,
        errorRate: this.stats.errors / this.stats.requests,
        rateLimitRate: this.stats.rateLimits / this.stats.requests
      }
    }

    reset() {
      Object.keys(this.stats).forEach(key => {
        this.stats[key] = 0
      })
    }
  }
  ```

**✗ DON'T:**
- Don't log integration tokens
- Don't log full page content
- Don't ignore error patterns
- Don't log user data without consent

---

### Extension - User-Facing Monitoring

**✓ DO:**
- Show sync status in extension popup
- Display last sync timestamp
- Show error counts with details
- Provide sync logs accessible to users
- Use chrome.notifications for important events
- Implement a debug mode for troubleshooting
  ```javascript
  class SyncStatusManager {
    constructor() {
      this.status = {
        lastSync: null,
        inProgress: false,
        lastError: null,
        successCount: 0,
        errorCount: 0
      }
    }

    async updateStatus(updates) {
      this.status = { ...this.status, ...updates }
      await chrome.storage.local.set({ syncStatus: this.status })
      this.notifyPopup()
    }

    async startSync() {
      await this.updateStatus({
        inProgress: true,
        lastError: null
      })
    }

    async completeSync(success, error = null) {
      await this.updateStatus({
        inProgress: false,
        lastSync: new Date().toISOString(),
        lastError: error,
        successCount: success ? this.status.successCount + 1 : this.status.successCount,
        errorCount: error ? this.status.errorCount + 1 : this.status.errorCount
      })
    }

    notifyPopup() {
      chrome.runtime.sendMessage({
        type: 'SYNC_STATUS_UPDATE',
        status: this.status
      })
    }
  }
  ```

**✗ DON'T:**
- Don't hide errors from users
- Don't show technical error details
- Don't spam notifications
- Don't update UI without debouncing

---

## User Experience

### Canvas Integration UX

**✓ DO:**
- Auto-detect Canvas instance from URL
- Validate Canvas token on settings save
- Provide clear instructions for token generation
- Show which courses will be synced
- Allow selective course sync
- Add sync button to Canvas UI (already implemented)
- Show sync progress in real-time

**✗ DON'T:**
- Don't sync without user confirmation on first run
- Don't auto-sync large amounts of data
- Don't hide sync failures
- Don't make users hunt for Canvas token

---

### Notion Integration UX

**✓ DO:**
- Provide step-by-step setup guide
- Validate Notion token and database ID on save
- Check if database is shared with integration
- Show preview of database properties
- Allow property mapping customization
- Explain why database sharing is required
- Provide link to create new integration

**✗ DON'T:**
- Don't assume users understand Notion integrations
- Don't sync to wrong database without warning
- Don't show technical Notion API errors
- Don't require manual data source ID entry

---

### Extension UX Best Practices

**✓ DO:**
- Show progress indicators for all async operations
- Provide success/error notifications
- Allow users to view sync logs
- Implement undo for destructive actions
- Save settings automatically with validation
- Provide default settings that work for most users
- Include helpful tooltips and documentation links
- Support keyboard shortcuts for power users
- Remember user preferences

**✗ DON'T:**
- Don't block UI during background operations
- Don't show "Loading..." without timeout
- Don't lose unsaved changes
- Don't require configuration that could be auto-detected
- Don't use jargon without explanation

---

## Code Organization

### Project Structure Best Practices

**✓ DO:**
- Organize code by feature/responsibility
  ```
  CanvasScrape/
  ├── background/
  │   ├── background.js          # Main service worker
  │   ├── credentialManager.js   # Credential handling
  │   ├── notionAPI.js           # Notion API wrapper
  │   ├── rateLimiter.js         # Rate limiting
  │   └── assignmentSyncer.js    # Sync logic
  ├── content-scripts/
  │   ├── content-script.js      # Canvas page integration
  │   └── canvasAPI.js           # Canvas API wrapper
  ├── popup/
  │   ├── popup.html
  │   ├── popup.js
  │   └── popup.css
  ├── docs/
  │   ├── CANVAS_API_DOCUMENTATION.md
  │   ├── NOTION_API_DOCUMENTATION.md
  │   └── BEST_PRACTICES.md
  └── manifest.json
  ```
- Use classes for complex components (already implemented)
- Separate API logic from business logic
- Create reusable utility functions
- Document complex algorithms and edge cases
- Use consistent naming conventions
- Add JSDoc comments to public methods

**✗ DON'T:**
- Don't put all code in one file
- Don't mix concerns (UI + API + business logic)
- Don't use global variables
- Don't duplicate code across files

---

### Code Style & Standards

**✓ DO:**
- Use async/await instead of callbacks
  ```javascript
  // Good
  async function syncAssignments() {
    const assignments = await canvas.getAssignments()
    const results = await notion.createPages(assignments)
    return results
  }

  // Bad
  function syncAssignments(callback) {
    canvas.getAssignments((err, assignments) => {
      if (err) return callback(err)
      notion.createPages(assignments, callback)
    })
  }
  ```
- Use const/let instead of var
- Use arrow functions for callbacks
- Use template literals for string interpolation
- Use destructuring for object properties
- Use optional chaining (?.) for nested properties
- Handle promise rejections
- Use try-catch for async operations

**✗ DON'T:**
- Don't use var
- Don't use callbacks when promises are available
- Don't ignore linter warnings
- Don't use == instead of ===
- Don't mutate function parameters

---

## Testing

### Canvas API Testing

**✓ DO:**
- Test with real Canvas tokens in development
- Mock Canvas API responses for unit tests
- Test rate limiting behavior
- Test error handling for all error codes
- Test pagination with large datasets
- Test with various assignment types (quizzes, discussions, etc.)
- Test with missing/null values
- Validate date parsing and formatting

**Test Example:**
```javascript
describe('CanvasAPIExtractor', () => {
  it('should handle missing due_at gracefully', () => {
    const assignment = {
      id: 123,
      name: 'Test Assignment',
      due_at: null,
      points_possible: 100
    }

    const result = validateCanvasAssignment(assignment)
    expect(result.due_at).toBeNull()
  })

  it('should validate ISO 8601 dates', () => {
    const validDate = '2026-02-15T23:59:00Z'
    const invalidDate = '02/15/2026'

    expect(isValidISO8601(validDate)).toBe(true)
    expect(isValidISO8601(invalidDate)).toBe(false)
  })
})
```

**✗ DON'T:**
- Don't test in production without safeguards
- Don't use production tokens in tests
- Don't skip error case testing
- Don't assume API behavior without testing

---

### Notion API Testing

**✓ DO:**
- Test with real Notion integration tokens in development
- Mock Notion API responses for unit tests
- Test property validation for all types
- Test rate limiting and retry logic
- Test pagination with large result sets
- Test with various database schemas
- Test error handling for permission errors
- Validate data source discovery logic

**Test Example:**
```javascript
describe('NotionValidator', () => {
  it('should validate select options', () => {
    const options = [
      { name: 'Not Started', color: 'red' },
      { name: 'In Progress', color: 'yellow' }
    ]

    expect(() =>
      NotionValidator.validateSelectOption('In Progress', options)
    ).not.toThrow()

    expect(() =>
      NotionValidator.validateSelectOption('Invalid', options)
    ).toThrow()
  })

  it('should split long text into chunks', () => {
    const longText = 'a'.repeat(3000)
    const chunks = NotionValidator.splitLongText(longText)

    expect(chunks.length).toBe(2)
    expect(chunks[0].text.content.length).toBe(2000)
    expect(chunks[1].text.content.length).toBe(1000)
  })
})
```

**✗ DON'T:**
- Don't test against shared production databases
- Don't test without cleaning up created pages
- Don't skip validation testing
- Don't assume property types without testing

---

### Extension Testing

**✓ DO:**
- Test extension in Chrome developer mode
- Test on actual Canvas pages with real data
- Test popup UI with various states (loading, error, success)
- Test content script injection on different Canvas pages
- Test credential encryption/decryption
- Test storage quota limits
- Test extension updates and migrations
- Test background sync behavior
- Perform end-to-end testing of complete sync flow

**Manual Test Checklist:**
```
☐ Install extension in developer mode
☐ Configure Canvas token
☐ Configure Notion integration and database
☐ Test initial sync from popup
☐ Test sync button on Canvas page
☐ Test with multiple courses
☐ Test with assignments missing due dates
☐ Test with assignments already in Notion
☐ Test error handling (invalid tokens, network errors)
☐ Test rate limiting with many assignments
☐ Test extension update scenario
☐ Test credential cleanup on uninstall
☐ Check browser console for errors
☐ Verify no sensitive data in logs
```

**✗ DON'T:**
- Don't test only in development environment
- Don't skip manual testing
- Don't test without real Canvas/Notion data
- Don't ignore browser console warnings

---

## Deployment & Maintenance

### Pre-Deployment Checklist

**✓ DO:**
- Remove all console.log statements (or use debug flag)
- Validate manifest.json structure
- Test on fresh Chrome profile
- Verify all API tokens are encrypted
- Check for hardcoded URLs or credentials
- Test extension update flow
- Prepare user documentation
- Set up error tracking (optional: Sentry, etc.)
- Test on Windows, Mac, Linux
- Verify permissions are minimal and necessary

**✗ DON'T:**
- Don't include development tokens
- Don't leave debug code enabled
- Don't deploy without testing
- Don't forget to update version number

---

### Monitoring Production

**✓ DO:**
- Monitor error rates via user reports
- Track extension usage metrics (with user consent)
- Set up alerts for critical failures
- Monitor API version deprecations
- Keep documentation up to date
- Respond to user feedback promptly
- Maintain changelog for version history

**✗ DON'T:**
- Don't collect user data without consent
- Don't ignore error patterns
- Don't let dependencies become outdated
- Don't break backwards compatibility without warning

---

### Maintenance Schedule

**✓ DO:**
- Check for Canvas API updates quarterly
- Check for Notion API updates quarterly
- Update dependencies regularly
- Test extension with new Chrome versions
- Review and update documentation
- Address security vulnerabilities immediately
- Migrate to new API versions when available

**Example Maintenance Calendar:**
```
Monthly:
- Review user feedback and bug reports
- Check for Chrome extension API changes
- Update dependencies (if needed)

Quarterly:
- Review Canvas API changelog
- Review Notion API changelog
- Perform security audit
- Update documentation

Annually:
- Major version review
- Deprecate outdated features
- Plan new features based on user feedback
```

**✗ DON'T:**
- Don't ignore API deprecation notices
- Don't let technical debt accumulate
- Don't wait for breakage to update
- Don't forget to test after updates

---

## API Version Migration

### Canvas API Version Updates

**Current Status:** Extension uses Canvas API v1 (stable)

**✓ DO:**
- Monitor Canvas API changelog for breaking changes
- Test new endpoints before migrating
- Update gradually (endpoint by endpoint)
- Maintain backward compatibility during migration
- Document API version dependencies

**✗ DON'T:**
- Don't assume API behavior remains unchanged
- Don't migrate without thorough testing

---

### Notion API Version Updates

**Current Status:** Extension should upgrade to 2025-09-03

**CRITICAL MIGRATION NEEDED:**

The extension currently uses an older Notion API pattern. It should be upgraded to 2025-09-03 for:
- Multi-source database support
- Future compatibility
- Access to latest features

**Migration Steps:**
1. Add data source discovery to `NotionAPI` class
2. Store `data_source_id` in credentials
3. Update query methods to use data source endpoints
4. Update page creation to use `data_source_id`
5. Test thoroughly with existing synced databases
6. Provide migration guide for users

**✓ DO:**
- Follow Notion's official upgrade guide
- Test with real databases before deploying
- Provide clear migration path for users
- Keep old API version as fallback during transition

**✗ DON'T:**
- Don't break existing user setups
- Don't migrate without user notification
- Don't assume all users will upgrade immediately

---

## Security Checklist

### Before Every Release

```
☐ All API tokens encrypted with AES-GCM
☐ No hardcoded credentials in source code
☐ No sensitive data in console logs
☐ Content Security Policy properly configured
☐ Input validation on all user inputs
☐ HTML sanitization for Canvas content
☐ No eval() or similar dangerous functions
☐ Minimal permissions in manifest.json
☐ Secure cleanup on uninstall implemented
☐ HTTPS used for all API calls
☐ No credentials in error messages
☐ Rate limiting implemented correctly
☐ Error handling doesn't expose internals
☐ Storage quota limits respected
☐ User data handled according to privacy policy
```

---

## Performance Checklist

### Before Every Release

```
☐ API calls are batched where possible
☐ Unnecessary API calls eliminated
☐ Caching implemented for static data
☐ Rate limiters working correctly
☐ Pagination implemented efficiently
☐ Large operations show progress indicators
☐ Background operations don't block UI
☐ Memory leaks checked and fixed
☐ Storage usage optimized
☐ No polling without purpose
☐ Debouncing implemented for user actions
☐ Parallel requests used appropriately
☐ Content scripts execute quickly
☐ Service worker efficient and minimal
```

---

## Conclusion

This best practices document serves as a comprehensive guide for maintaining and enhancing the Canvas-Notion Assignment Sync extension. Following these guidelines will ensure:

- **Security:** Proper credential management and data protection
- **Reliability:** Robust error handling and retry logic
- **Performance:** Efficient API usage and optimization
- **User Experience:** Clear feedback and intuitive interface
- **Maintainability:** Clean code and thorough documentation

Remember: **When in doubt, favor user safety and data integrity over convenience.**

For questions or clarifications, refer to:
- [Canvas API Documentation](./CANVAS_API_DOCUMENTATION.md)
- [Notion API Documentation](./NOTION_API_DOCUMENTATION.md)
- [Project README](./README.md)
- [CLAUDE.md](./CLAUDE.md) for Claude Code guidance

---

**Document Version:** 1.0
**Last Updated:** 2026-02-01
**Maintained By:** Canvas-Notion Assignment Sync Project
