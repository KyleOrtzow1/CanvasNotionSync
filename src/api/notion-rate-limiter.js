import '../utils/debug.js';
const { Debug } = globalThis;

// Optimized Rate limiter for Notion API with burst support
export class NotionRateLimiter {
  /**
   * @param {Object} [timings] - optional RequestTimings sink (see #61). Time
   *   spent throttled here is not time spent waiting on Notion, so it is
   *   recorded separately from the request durations themselves.
   */
  constructor(timings = null) {
    this.timings = timings;
    this.requestQueue = [];
    this.processing = false;
    this.requestTimes = []; // Track request timestamps for sliding window
    this.maxRequestsPerSecond = 5; // Burst limit per Notion API guidelines
    this.averageRequestsPerSecond = 3; // Sustained average per Notion API guidelines
    this.burstWindow = 1000; // 1 second sliding window
    this.averageWindow = 10000; // 10 second window for average rate enforcement

    // Retry configuration. The budget belongs to the queued operation, not to
    // the thrown error: every HTTP attempt builds a fresh Error, so a counter
    // stored on the error resets on each 429 and never exhausts.
    this.maxRetries = 5;
    this.maxRetryDelay = 16000; // Cap on the exponential component of the backoff
  }

  async execute(requestFunction) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFunction, resolve, reject, attempt: 0 });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();

      // Clean old request times
      this.requestTimes = this.requestTimes.filter(time => now - time < this.averageWindow);

      // Check if we can make a request
      const recentRequests = this.requestTimes.filter(time => now - time < this.burstWindow);
      const averageRequests = this.requestTimes.length;

      let canMakeRequest = true;
      let delay = 0;

      // Check burst limit (5 req/sec)
      if (recentRequests.length >= this.maxRequestsPerSecond) {
        delay = Math.max(delay, this.burstWindow - (now - recentRequests[0]));
        canMakeRequest = false;
      }

      // Check average limit (3 req/sec over 10 seconds)
      if (averageRequests >= (this.averageRequestsPerSecond * (this.averageWindow / 1000))) {
        const oldestRequest = this.requestTimes[0];
        delay = Math.max(delay, this.averageWindow - (now - oldestRequest));
        canMakeRequest = false;
      }

      if (!canMakeRequest && delay > 0) {
        const throttleDelay = Math.min(delay, 20); // Much shorter delay cap
        this._recordWait('notion_throttle', throttleDelay);
        await this.delay(throttleDelay);
        continue;
      }

      const item = this.requestQueue.shift();
      const { requestFunction, resolve, reject, attempt } = item;

      // Count the attempt before it is sent. A retried 429 still cost Notion a
      // request, so it has to count against the burst/average windows the same
      // way a successful one does.
      this.requestTimes.push(Date.now());

      try {
        const result = await requestFunction();
        resolve(result);
      } catch (error) {
        if (this._isRateLimitError(error)) {
          const nextAttempt = attempt + 1;

          if (nextAttempt >= this.maxRetries) {
            Debug.error(`Notion rate limiter: max retries reached (${this.maxRetries} attempts)`);
            error.rateLimitAttempts = nextAttempt;
            error.rateLimitExhausted = true;
            reject(error);
          } else {
            const backoffDelay = this._calculateBackoff(attempt, error.retryAfter);
            Debug.log(
              `Notion rate limited (429), attempt ${nextAttempt}/${this.maxRetries}, ` +
              `waiting ${backoffDelay}ms before retry`
            );
            this._recordWait('notion_rate_limit_backoff', backoffDelay);
            await this.delay(backoffDelay);
            this.requestQueue.unshift({
              requestFunction, resolve, reject, attempt: nextAttempt
            });
          }
        } else {
          reject(error);
        }
      }

      // Remove artificial delays for personal use - let it run at full speed
      // Rate limiter will handle throttling if needed
    }

    this.processing = false;
  }

  _isRateLimitError(error) {
    if (!error) return false;
    if (error.status === 429) return true;
    return (error.message || '').includes('rate_limited');
  }

  _calculateBackoff(attempt, retryAfter) {
    // Exponential: 1s, 2s, 4s, 8s, 16s (capped), never shorter than Retry-After
    const exponentialDelay = Math.min(Math.pow(2, attempt) * 1000, this.maxRetryDelay);
    const retryAfterDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
    return Math.max(exponentialDelay, retryAfterDelay);
  }

  // Attribute a deliberate wait to the sync's timing summary when one is
  // attached. Optional by design: the limiter works the same without it.
  _recordWait(reason, ms) {
    if (this.timings && typeof this.timings.recordWait === 'function') {
      this.timings.recordWait(reason, ms);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
