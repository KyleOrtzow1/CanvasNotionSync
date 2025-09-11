import { NotionRateLimiter } from './notion-rate-limiter.js';

// Create a shared rate limiter instance
const rateLimiter = new NotionRateLimiter();

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

    return await rateLimiter.execute(requestFunction);
  }

  // Query data source (not database directly)
  async queryDataSource(dataSourceId, filters = {}) {
    const requestFunction = async () => {
      const body = {};
      if (Object.keys(filters).length > 0) {
        body.filter = filters;
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

    return await rateLimiter.execute(requestFunction);
  }

  async updatePage(pageId, properties) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/pages/${pageId}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ properties: properties })
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

    return await rateLimiter.execute(requestFunction);
  }
}