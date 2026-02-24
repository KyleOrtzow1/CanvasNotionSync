import '../utils/debug.js';
const { Debug } = globalThis;

export const THRESHOLDS = {
  WARNING: 80,
  CRITICAL: 90,
  CLEANUP_TARGET: 70
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Check current chrome.storage.local usage against quota
 * @returns {Object} { bytesInUse, quota, percentUsed, status, formattedUsed, formattedQuota }
 */
export async function checkStorageQuota() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  const quota = chrome.storage.local.QUOTA_BYTES || 10485760;
  const percentUsed = (bytesInUse / quota) * 100;

  let status = 'ok';
  if (percentUsed >= THRESHOLDS.CRITICAL) {
    status = 'critical';
  } else if (percentUsed >= THRESHOLDS.WARNING) {
    status = 'warning';
  }

  return {
    bytesInUse,
    quota,
    percentUsed,
    status,
    formattedUsed: formatBytes(bytesInUse),
    formattedQuota: formatBytes(quota)
  };
}

/**
 * Clean up old cache entries to free storage space
 * @param {AssignmentCacheManager} assignmentCache - Cache singleton
 * @returns {Object} { freedBytes, entriesRemoved, newPercentUsed }
 */
export async function cleanupOldCache(assignmentCache) {
  const before = await chrome.storage.local.getBytesInUse(null);
  const quota = chrome.storage.local.QUOTA_BYTES || 10485760;
  let entriesRemoved = 0;

  // Step 1: clean expired entries (free win)
  assignmentCache.cleanupExpired();

  // Step 2: evict LRU entries until below target
  let currentPercent = (await chrome.storage.local.getBytesInUse(null)) / quota * 100;

  // Persist after expired cleanup
  if (assignmentCache.enablePersistence) {
    await assignmentCache.persistToStorage();
    currentPercent = (await chrome.storage.local.getBytesInUse(null)) / quota * 100;
  }

  let evictions = 0;
  while (currentPercent > THRESHOLDS.CLEANUP_TARGET && assignmentCache.cache.size > 0 && evictions < 50) {
    await assignmentCache.evictLRU();
    evictions++;
    entriesRemoved++;

    // Batch persist every 5 evictions
    if (evictions % 5 === 0 && assignmentCache.enablePersistence) {
      await assignmentCache.persistToStorage();
      currentPercent = (await chrome.storage.local.getBytesInUse(null)) / quota * 100;
    }
  }

  // Final persist
  if (evictions > 0 && assignmentCache.enablePersistence) {
    await assignmentCache.persistToStorage();
  }

  const after = await chrome.storage.local.getBytesInUse(null);
  const freedBytes = before - after;
  const newPercentUsed = (after / quota) * 100;

  Debug.log(`Storage cleanup: removed ${entriesRemoved} entries, freed ${formatBytes(freedBytes)}`);

  return { freedBytes, entriesRemoved, newPercentUsed };
}
