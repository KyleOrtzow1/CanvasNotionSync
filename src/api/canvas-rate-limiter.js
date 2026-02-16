// Canvas API Rate Limiter using leaky bucket algorithm
// Canvas uses a cost-based leaky bucket: 700-unit capacity, 10 units/second leak rate.
// Rate limit responses are 403 (not 429). Headers: X-Request-Cost, X-Rate-Limit-Remaining.

class CanvasRateLimiter {
  constructor() {
    // Leaky bucket parameters matching Canvas's model
    this.bucketCapacity = 700;
    this.bucket = 700;           // Start full; self-corrects after first response
    this.leakRate = 10;          // Units refilled per second
    this.lastCheck = Date.now();
    this.defaultEstimatedCost = 2; // Conservative default, adapts via moving average

    // Queue infrastructure
    this.requestQueue = [];
    this.processing = false;

    // Retry configuration
    this.maxRetries = 5;

    // Adaptive throttling thresholds
    this.lowBucketThreshold = 100;
    this.criticalBucketThreshold = 30;
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
      const item = this.requestQueue.shift();
      const { requestFunction, resolve, reject, attempt } = item;

      // Refill bucket based on elapsed time
      this._refillBucket();

      // Adaptive pre-request delay
      const delay = this._calculateDelay(this.defaultEstimatedCost);
      if (delay > 0) {
        await this._delay(delay);
        this._refillBucket();
      }

      try {
        const result = await requestFunction();
        resolve(result);
      } catch (error) {
        if (this._isRateLimitError(error)) {
          if (attempt < this.maxRetries) {
            const backoffDelay = this._calculateBackoff(attempt);
            console.log(
              `Canvas rate limited (403), attempt ${attempt + 1}/${this.maxRetries}, ` +
              `waiting ${backoffDelay}ms before retry`
            );
            await this._delay(backoffDelay);
            this.requestQueue.unshift({
              requestFunction, resolve, reject, attempt: attempt + 1
            });
          } else {
            console.error('Canvas rate limiter: max retries reached (5 attempts)');
            reject(error);
          }
        } else {
          reject(error);
        }
      }
    }

    this.processing = false;
  }

  _refillBucket() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastCheck) / 1000;
    this.bucket = Math.min(
      this.bucketCapacity,
      this.bucket + (elapsedSeconds * this.leakRate)
    );
    this.lastCheck = now;
  }

  _calculateDelay(estimatedCost) {
    // Bucket would go negative — wait for exact refill time
    if (this.bucket < estimatedCost) {
      const waitTime = ((estimatedCost - this.bucket) / this.leakRate) * 1000;
      return Math.ceil(waitTime);
    }

    // Green zone: plenty of capacity
    if (this.bucket >= this.lowBucketThreshold) {
      return 0;
    }

    // Red zone: aggressive delay
    if (this.bucket < this.criticalBucketThreshold) {
      return 500;
    }

    // Yellow zone: proportional delay (0–200ms)
    const ratio = 1 - ((this.bucket - this.criticalBucketThreshold) /
                        (this.lowBucketThreshold - this.criticalBucketThreshold));
    return Math.ceil(ratio * 200);
  }

  _isRateLimitError(error) {
    if (error.status === 403) {
      const message = (error.message || '').toLowerCase();
      return message.includes('rate') || message.includes('throttl') || message.includes('limit');
    }
    return false;
  }

  _calculateBackoff(attempt) {
    // Exponential: 1s, 2s, 4s, 8s, 16s (capped)
    const base = Math.pow(2, attempt) * 1000;
    // Add jitter: ±20% to prevent thundering herd
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.min(Math.ceil(base + jitter), 16000);
  }

  updateFromHeaders(headers) {
    const costStr = headers.get ? headers.get('X-Request-Cost') : headers['X-Request-Cost'];
    const remainingStr = headers.get ? headers.get('X-Rate-Limit-Remaining') : headers['X-Rate-Limit-Remaining'];

    if (remainingStr !== null && remainingStr !== undefined) {
      const remaining = parseFloat(remainingStr);
      if (!isNaN(remaining)) {
        this.bucket = remaining;
      }
    }

    if (costStr !== null && costStr !== undefined) {
      const cost = parseFloat(costStr);
      if (!isNaN(cost)) {
        // Moving average: adapt estimated cost to actual request costs
        this.defaultEstimatedCost = this.defaultEstimatedCost * 0.7 + cost * 0.3;
      }
    }

    this.lastCheck = Date.now();
    return {
      cost: parseFloat(costStr),
      remaining: parseFloat(remainingStr)
    };
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ES module export for test/background contexts
export { CanvasRateLimiter };

// globalThis export for content script (non-module) context
if (typeof globalThis !== 'undefined' && typeof globalThis.CanvasRateLimiter === 'undefined') {
  globalThis.CanvasRateLimiter = CanvasRateLimiter;
}
