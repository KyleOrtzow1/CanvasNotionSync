import { NotionRateLimiter } from './notion-rate-limiter.js';
import '../utils/debug.js';
import '../utils/request-timing.js';
const { Debug, RequestTimings } = globalThis;

// Per-request timing for Notion calls (see #61). Shared with the limiter so the
// time spent throttled and the time spent waiting on Notion end up in the same
// summary instead of being indistinguishable inside one total.
export const notionTimings = new RequestTimings({ label: 'Notion' });

// Create a shared rate limiter instance. Exported so tests can drive the real
// API -> limiter -> retry composition instead of a stand-in.
export const notionRateLimiter = new NotionRateLimiter(notionTimings);
const rateLimiter = notionRateLimiter;

// Notion API Integration - Updated for new API structure
export class NotionAPI {
  constructor(token) {
    this.token = token;
    this.baseURL = 'https://api.notion.com/v1';
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2025-09-03'
    };
    this.timings = notionTimings;
  }

  /**
   * fetch(), timed. One entry per HTTP attempt — a request the retry loop or
   * the rate limiter sends again is a second attempt Notion actually served,
   * so it is recorded again rather than folded into the first (see #61).
   * @param {string} url
   * @param {Object} options - fetch init
   * @returns {Promise<Response>}
   */
  async _fetch(url, options) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, options);
      this.timings?.record({ url, durationMs: Date.now() - startedAt, status: response.status });
      return response;
    } catch (error) {
      this.timings?.record({ url, durationMs: Date.now() - startedAt, failed: true });
      throw error;
    }
  }

  // Get database info and data sources
  async getDatabase(databaseId) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/databases/${databaseId}`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'getDatabase'));
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

      const response = await this._fetch(`${this.baseURL}/data_sources/${dataSourceId}/query`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'queryDataSource'));
  }

  // Create page in data source
  async createPage(dataSourceId, properties) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/pages`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'createPage'));
  }

  // Get a data source, including its property schema. Needed to see which
  // columns a database already has, and to resolve property names to the
  // property IDs a view's configuration requires.
  async getDataSource(dataSourceId) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/data_sources/${dataSourceId}`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'getDataSource'));
  }

  // Add or rename properties on an existing data source's schema. Used to fit
  // a database the user built themselves with the columns sync writes to.
  // Renames are expressed as { '<current name>': { name: '<new name>' } }.
  async updateDataSourceProperties(dataSourceId, properties) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/data_sources/${dataSourceId}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ properties: properties })
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'updateDataSourceProperties'));
  }

  // List the views on a data source (used to find the default view Notion
  // auto-creates alongside a new database, so it can be configured)
  async listViews(dataSourceId) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/views?data_source_id=${dataSourceId}`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'listViews'));
  }

  // Update a view's sorts, filter, quick filters, name, or configuration
  async updateView(viewId, updates) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/views/${viewId}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(updates)
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'updateView'));
  }

  // Get page by ID
  async getPage(pageId) {
    const requestFunction = async () => {
      const response = await this._fetch(`${this.baseURL}/pages/${pageId}`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'getPage'));
  }

  async updatePage(pageId, properties, options = {}) {
    const requestFunction = async () => {
      const body = { properties: properties };

      // Support archiving pages
      if (options.archived !== undefined) {
        body.archived = options.archived;
      }

      const response = await this._fetch(`${this.baseURL}/pages/${pageId}`, {
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

    return await rateLimiter.execute(() => this.executeWithRetry(requestFunction, 'updatePage'));
  }

  // Retry logic for 409 conflicts and server errors.
  //
  // 429s are deliberately *not* retried here. Every call site wraps this loop in
  // NotionRateLimiter.execute(), which owns the rate-limit retry budget and the
  // Retry-After backoff. Retrying 429 in both places multiplies the two loops
  // together, so a sustained rate limit takes far more attempts than either
  // budget allows.
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
          Debug.log(`${operationType} conflict (409) on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms...`);

          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        // Rate limits belong to the limiter's budget — hand them straight back
        // so it can apply Retry-After and count the attempt exactly once.
        if (error.status === 429) {
          Debug.log(`${operationType} rate limited (429), deferring to the rate limiter's retry budget`);
          throw error;
        }

        // For other errors, only retry a few times with shorter delays
        if (error.status >= 500 && attempt < 3) {
          const delay = 500 * attempt;
          Debug.log(`${operationType} server error (${error.status}) on attempt ${attempt}/3, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // If it's not a retryable error or we're out of retries, throw immediately
        break;
      }
    }

    Debug.error(`${operationType} failed:`, lastError.message);
    throw lastError;
  }
}
