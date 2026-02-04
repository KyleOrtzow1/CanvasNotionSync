# Caching System Testing Guide

## Quick Start

### 1. Run Automated Tests
```bash
node test/cache-test.js
```

Expected output:
```
🧪 Starting Cache Tests
...
✅ Tests passed: 28
❌ Tests failed: 0
🎉 All tests passed!
```

### 2. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `CanvasScrape` directory
5. Verify extension loads without errors

### 3. Configure Extension

1. Click the extension icon
2. Enter your Canvas API token
3. Enter your Notion integration token
4. Enter your Notion database ID
5. Click "Save Credentials"

## Manual Testing Scenarios

### Scenario 1: Cold Cache (First Sync)

**Goal**: Verify cache is populated on first sync

**Steps**:
1. Open Chrome DevTools (F12)
2. Navigate to a Canvas page (e.g., https://canvas.instructure.com)
3. Click extension icon → "Sync Now"
4. Check console output

**Expected Output**:
```
🔍 Starting duplicate prevention lookup...
📋 Canvas IDs to check: 25
📊 Cache hit: 0/25 lookups (25 need API query)
🔎 Lookup batch 1/5: Checking 5 Canvas IDs
✅ Lookup batch 1 complete: 3/5 found in Notion
...
📊 Lookup complete: 15/25 assignments already exist
```

**Success Criteria**:
- ✅ No cached data used (first sync)
- ✅ Canvas API calls made for courses and assignments
- ✅ Notion API queries made for all Canvas IDs
- ✅ Sync completes successfully
- ✅ No rate limit warnings

### Scenario 2: Warm Cache (Second Sync)

**Goal**: Verify cache is used and improves performance

**Steps**:
1. Wait 10 seconds after first sync
2. Click "Sync Now" again
3. Check console output

**Expected Output**:
```
✅ Using cached courses
✅ Using cached assignments for course 12345
✅ Using cached assignments for course 67890
...
📊 Cache hit: 25/25 lookups (0 need API query)
📊 All lookups served from cache!
```

**Success Criteria**:
- ✅ Cached courses used (no API call)
- ✅ Cached assignments used (no API calls)
- ✅ Cached Notion lookups used (90%+ hit rate)
- ✅ Sync completes much faster (~60% reduction)
- ✅ Console shows cache hit messages

### Scenario 3: Force Refresh

**Goal**: Verify cache invalidation works

**Steps**:
1. Modify popup.js to add forceRefresh flag:
```javascript
const syncResult = await chrome.runtime.sendMessage({
  action: 'START_BACKGROUND_SYNC',
  canvasToken: canvasToken,
  forceRefresh: true  // Add this
});
```
2. Click "Sync Now"
3. Check console output

**Expected Output**:
```
🗑️ Caches invalidated for manual sync
🗑️ All Canvas cache invalidated for manual sync
```

**Success Criteria**:
- ✅ Cache invalidated before sync
- ✅ Fresh data fetched from Canvas API
- ✅ New lookups performed in Notion
- ✅ Cache repopulated with fresh data

### Scenario 4: Rate Limit Monitoring

**Goal**: Verify rate limit tracking works

**Steps**:
1. Open Canvas page
2. Open Chrome DevTools → Network tab
3. Filter by "api/v1"
4. Click "Sync Now"
5. Check response headers for rate limit info
6. Check console for rate limit tracking

**Expected Console Output**:
```
(No warnings if > 20 requests remaining)
⚠️ Canvas rate limit warning: 15 requests remaining
🚨 Canvas rate limit critical: 5 requests remaining
```

**Success Criteria**:
- ✅ Rate limit headers extracted from Canvas responses
- ✅ Background tracks remaining requests
- ✅ Warning logged when < 20 remaining
- ✅ Critical warning when < 10 remaining
- ✅ Requests blocked when < 10 remaining

### Scenario 5: Cache Statistics

**Goal**: Verify cache statistics are tracked correctly

**Steps**:
1. Open extension popup
2. Open Chrome DevTools → Console
3. Run the following in console:
```javascript
chrome.runtime.sendMessage({
  action: 'GET_CACHE_STATS'
}, (response) => {
  console.log('Cache Stats:', JSON.stringify(response, null, 2));
});
```

**Expected Output**:
```json
{
  "success": true,
  "stats": {
    "canvas": {
      "hits": 45,
      "misses": 5,
      "sets": 15,
      "size": 12,
      "maxSize": 100,
      "hitRate": "90.00%",
      "rateLimit": {
        "remaining": 95,
        "cost": 1.0
      }
    },
    "notion": {
      "hits": 90,
      "misses": 10,
      "sets": 100,
      "size": 95,
      "maxSize": 200,
      "hitRate": "90.00%",
      "lookupCount": 95
    }
  }
}
```

**Success Criteria**:
- ✅ Canvas cache shows > 85% hit rate after 2nd sync
- ✅ Notion cache shows > 90% hit rate after 2nd sync
- ✅ Cache sizes are reasonable (< maxSize)
- ✅ Rate limit info is present

### Scenario 6: Persistent Cache

**Goal**: Verify Notion cache persists across browser restarts

**Steps**:
1. Perform a sync (populate cache)
2. Get cache stats and note Notion cache size
3. Close Chrome completely
4. Reopen Chrome
5. Get cache stats again

**Expected Behavior**:
```javascript
// Before restart
notion.size: 95

// After restart (cache loaded from storage)
notion.size: 95 (or less if some expired)
✅ Loaded 95 cache entries from storage
```

**Success Criteria**:
- ✅ Notion cache persists across restarts
- ✅ Expired entries are cleaned up on load
- ✅ Canvas cache is empty (not persistent)

### Scenario 7: Cache Clear

**Goal**: Verify manual cache clearing works

**Steps**:
1. Perform a sync (populate cache)
2. Run in console:
```javascript
chrome.runtime.sendMessage({
  action: 'CLEAR_CACHE'
}, (response) => {
  console.log('Clear result:', response);
});
```
3. Get cache stats
4. Perform another sync

**Expected Output**:
```
🗑️ Cache cleared
Clear result: { success: true }

Cache Stats after clear:
- canvas.size: 0
- notion.size: 0
```

**Success Criteria**:
- ✅ Both caches cleared
- ✅ Next sync repopulates from APIs
- ✅ No errors during clear

## Performance Benchmarks

### Baseline (No Cache)
Run first sync and measure:
```
Canvas API calls: ~106
Notion API calls: ~200
Total time: 30-45 seconds
```

### With Cache (Warm)
Run second sync and measure:
```
Canvas API calls: ~0-10 (90%+ reduction)
Notion API calls: ~10-20 (90%+ reduction)
Total time: 11-17 seconds (60%+ improvement)
Cache hit rate: 90%+
```

### Measurement Script
Add to popup.js for benchmarking:
```javascript
const startTime = Date.now();
const syncResult = await chrome.runtime.sendMessage({
  action: 'START_BACKGROUND_SYNC',
  canvasToken: canvasToken
});
const duration = Date.now() - startTime;
console.log(`Sync completed in ${duration}ms`);
```

## Troubleshooting

### Cache Not Working

**Symptoms**: Cache hit rate is 0%, no "Using cached..." messages

**Checks**:
1. Verify cache initialization in background.js console:
   ```
   ✅ Cache managers initialized
   ```
2. Check for message handler errors
3. Verify chrome.storage permissions in manifest.json

**Solution**: Check console for errors, verify message handlers are registered

### Rate Limit Warnings

**Symptoms**: Console shows rate limit warnings frequently

**Checks**:
1. Get cache stats to verify cache is working
2. Check if forceRefresh is always true
3. Verify TTL settings aren't too short

**Solution**: Increase cache TTL or reduce sync frequency

### Cache Size Exceeded

**Symptoms**: Frequent eviction messages in console

**Checks**:
1. Get cache stats to see current size
2. Check if hitting maxSize limit
3. Verify TTL expiration is working

**Solution**: Increase maxMemorySize in cache constructor

### Persistent Cache Not Loading

**Symptoms**: Notion cache empty after restart

**Checks**:
1. Verify enablePersistence is true
2. Check chrome.storage.local permissions
3. Look for storage quota errors

**Solution**: Check chrome.storage.local in DevTools → Application → Storage

## Debug Commands

### View Cache Contents
```javascript
// Canvas cache
chrome.storage.local.get('canvas_cache', (result) => {
  console.log('Canvas cache:', result);
});

// Notion cache
chrome.storage.local.get('notion_lookup_cache', (result) => {
  console.log('Notion cache:', result);
});
```

### Force Cache Expiration
```javascript
chrome.runtime.sendMessage({
  action: 'CLEAR_CACHE'
});
```

### Monitor Rate Limits
```javascript
chrome.runtime.sendMessage({
  action: 'GET_CACHE_STATS'
}, (response) => {
  console.log('Rate limit:', response.stats.canvas.rateLimit);
});
```

## Success Criteria Summary

✅ All automated tests pass (28/28)
✅ First sync completes without cache (baseline established)
✅ Second sync uses cache (90%+ hit rate)
✅ Sync time reduced by 60%+ with cache
✅ Rate limit tracking works (warnings appear correctly)
✅ Cache statistics are accurate
✅ Notion cache persists across restarts
✅ Manual cache clear works
✅ No console errors during normal operation

## Next Steps

After verifying all tests pass:
1. Monitor cache performance in production
2. Adjust TTL settings based on usage patterns
3. Consider adding UI controls for cache management
4. Add telemetry for cache hit rates
