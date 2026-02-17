import { NotionRateLimiter } from './notion-rate-limiter.js';

// Create a shared rate limiter instance
const rateLimiter = new NotionRateLimiter();

// Notion API Integration - Updated for new API structure
export class NotionAPI {
  constructor(token, options = {}) {
    this.token = token;
    this.baseURL = 'https://api.notion.com/v1';
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2025-09-03'
    };
    this.bypassRateLimit = options.bypassRateLimit || false; // Option for personal use
  }

  // Get database info and data sources
  async getDatabase(databaseId) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/databases/${databaseId}`, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
      }

      return await response.json();
    };

    // Bypass rate limiter for personal use
    if (this.bypassRateLimit) {
      return await requestFunction();
    }
    return await rateLimiter.execute(requestFunction);
  }

  // Query data source (not database directly)
  async queryDataSource(dataSourceId, filters = {}, options = {}) {
    const requestFunction = async () => {
      const body = {};
      if (Object.keys(filters).length > 0) {
        body.filter = filters;
      }
      if (options.start_cursor) {
        body.start_cursor = options.start_cursor;
      }
      if (options.page_size) {
        body.page_size = options.page_size;
      }

      const response = await fetch(`${this.baseURL}/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
      }

      return await response.json();
    };

    // Bypass rate limiter for personal use
    if (this.bypassRateLimit) {
      return await requestFunction();
    }
    return await rateLimiter.execute(requestFunction);
  }

  // Create page in data source
  async createPage(dataSourceId, properties) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/pages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          properties: properties
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
      }

      return await response.json();
    };

    // Bypass rate limiter for personal use with 409 retry logic
    if (this.bypassRateLimit) {
      return await this.executeWithRetry(requestFunction, 'createPage');
    }
    return await rateLimiter.execute(requestFunction);
  }

  // Get page by ID
  async getPage(pageId) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/pages/${pageId}`, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000;
          }
        }

        throw error;
      }

      return await response.json();
    };

    if (this.bypassRateLimit) {
      return await requestFunction();
    }
    return await rateLimiter.execute(requestFunction);
  }

  async updatePage(pageId, properties, options = {}) {
    const requestFunction = async () => {
      const body = { properties: properties };

      // Support archiving pages
      if (options.archived !== undefined) {
        body.archived = options.archived;
      }

      const response = await fetch(`${this.baseURL}/pages/${pageId}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
      }

      return await response.json();
    };

    // Bypass rate limiter for personal use with 409 retry logic
    if (this.bypassRateLimit) {
      return await this.executeWithRetry(requestFunction, 'updatePage');
    }
    return await rateLimiter.execute(requestFunction);
  }

  // Bulletproof retry logic for 409 conflicts and other errors
  async executeWithRetry(requestFunction, operationType, maxRetries = 5) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await requestFunction();
        return result;
      } catch (error) {
        lastError = error;
        
        // Handle 409 conflicts with exponential backoff
        if (error.status === 409) {
          const delay = Math.min(200 * Math.pow(2, attempt - 1), 2000); // 200ms, 400ms, 800ms, 1600ms, 2000ms
          console.log(`⚠️ ${operationType} conflict (409) on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms...`);
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // Handle 429 rate limits with exponential backoff + Retry-After
        if (error.status === 429) {
          const retryAfterDelay = error.retryAfter || 1000;
          const exponentialDelay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s, 8s, 16s
          const delay = Math.max(retryAfterDelay, exponentialDelay);

          console.log(`⚠️ ${operationType} rate limited (429) on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms (Retry-After: ${retryAfterDelay}ms, exponential: ${exponentialDelay}ms)...`);

          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // For other errors, only retry a few times with shorter delays
        if (error.status >= 500 && attempt < 3) {
          const delay = 500 * attempt;
          console.log(`⚠️ ${operationType} server error (${error.status}) on attempt ${attempt}/3, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // If it's not a retryable error or we're out of retries, throw immediately
        break;
      }
    }
    
    console.error(`❌ ${operationType} failed:`, lastError.message);
    throw lastError;
  }
}