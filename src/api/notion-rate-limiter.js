// Optimized Rate limiter for Notion API with burst support
export class NotionRateLimiter {
  constructor() {
    this.requestQueue = [];
    this.processing = false;
    this.requestTimes = []; // Track request timestamps for sliding window
    this.maxRequestsPerSecond = 5; // Allow bursts up to 5 req/sec
    this.averageRequestsPerSecond = 3; // Maintain 3 req/sec average
    this.burstWindow = 1000; // 1 second sliding window
    this.averageWindow = 10000; // 10 second average window
  }

  async execute(requestFunction) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFunction, resolve, reject });
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
        await this.delay(Math.min(delay, 100)); // Cap delay at 100ms for responsiveness
        continue;
      }
      
      const { requestFunction, resolve, reject } = this.requestQueue.shift();
      
      try {
        const result = await requestFunction();
        this.requestTimes.push(Date.now());
        resolve(result);
      } catch (error) {
        if (error.message.includes('rate_limited') || error.status === 429) {
          // Handle 429 rate limit with exponential backoff
          const retryAfter = error.retryAfter || 1000;
          await this.delay(retryAfter);
          this.requestQueue.unshift({ requestFunction, resolve, reject });
        } else {
          reject(error);
        }
      }
      
      // Small delay to prevent overwhelming
      if (this.requestQueue.length > 0) {
        await this.delay(50); // Much smaller delay between requests
      }
    }
    
    this.processing = false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}