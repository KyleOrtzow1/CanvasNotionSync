import { NotionAPI } from '../api/notion-api.js';

// Assignment synchronization logic
export class AssignmentSyncer {
  constructor(notionAPI, databaseId) {
    this.notionAPI = notionAPI;
    this.databaseId = databaseId;
    this.dataSourceId = null;
  }

  async initialize() {
    try {
      // Get database info to find the data source ID
      const database = await this.notionAPI.getDatabase(this.databaseId);
      
      if (!database.data_sources || database.data_sources.length === 0) {
        throw new Error('No data sources found in database');
      }
      
      // Use the first data source
      this.dataSourceId = database.data_sources[0].id;
      
      return { success: true, dataSourceId: this.dataSourceId };
    } catch (error) {
      console.error('Failed to initialize syncer:', error);
      throw error;
    }
  }

  async findExistingAssignment(assignment) {
    try {
      if (!this.dataSourceId) {
        await this.initialize();
      }

      // Try to find by Canvas ID first
      if (assignment.canvasId) {
        const result = await this.notionAPI.queryDataSource(this.dataSourceId, {
          property: 'Canvas ID',
          rich_text: {
            equals: assignment.canvasId.toString()
          }
        });

        if (result.results && result.results.length > 0) {
          return result.results[0];
        }
      }

      // Fallback to title matching
      const titleResult = await this.notionAPI.queryDataSource(this.dataSourceId, {
        property: 'Assignment Name',
        title: {
          equals: assignment.title
        }
      });

      return titleResult.results && titleResult.results.length > 0 ? titleResult.results[0] : null;
    } catch (error) {
      console.error('Error finding existing assignment:', error);
      return null;
    }
  }

  formatAssignmentProperties(assignment) {
    const properties = {
      "Assignment Name": {
        title: [{ text: { content: assignment.title || 'Untitled Assignment' } }]
      }
    };

    if (assignment.course) {
      properties["Course"] = {
        select: { name: assignment.course }
      };
    }

    if (assignment.dueDate) {
      properties["Due Date"] = {
        date: { start: assignment.dueDate }
      };
    }

    if (assignment.status) {
      properties["Status"] = {
        select: { name: assignment.status }
      };
    }

    if (assignment.points) {
      properties["Points"] = {
        number: assignment.points
      };
    }

    if (assignment.link) {
      properties["Link to Resources"] = {
        url: assignment.link
      };
    }

    if (assignment.canvasId) {
      properties["Canvas ID"] = {
        rich_text: [{ text: { content: assignment.canvasId.toString() } }]
      };
    }

    // Add grade as percentage number
    if (assignment.gradePercent !== null && assignment.gradePercent !== undefined) {
      // Use calculated percentage as number
      properties["Grade"] = {
        number: assignment.gradePercent
      };
    }

    return properties;
  }

  async syncAssignment(assignment) {
    try {
      if (!this.dataSourceId) {
        await this.initialize();
      }

      const existing = await this.findExistingAssignment(assignment);
      const properties = this.formatAssignmentProperties(assignment);

      if (existing) {
        // Check if existing assignment has "In Progress" status
        const existingStatus = existing.properties?.Status?.select?.name;
        const newStatus = assignment.status;
        
        // If existing status is "In Progress", only update if new status is "Submitted" or "Graded"
        if (existingStatus === 'In Progress' && 
            newStatus !== 'Submitted' && 
            newStatus !== 'Graded') {
          // Preserve the "In Progress" status
          if (properties.Status) {
            properties.Status = {
              select: { name: 'In Progress' }
            };
          }
        }
        
        // If existing status is "Submitted", only update if new status is "Graded"
        if (existingStatus === 'Submitted' && 
            newStatus !== 'Graded') {
          // Preserve the "Submitted" status
          if (properties.Status) {
            properties.Status = {
              select: { name: 'Submitted' }
            };
          }
        }
        
        // Update existing assignment
        const result = await this.notionAPI.updatePage(existing.id, properties);
        return { action: 'updated', assignment: assignment.title, result };
      } else {
        // Create new assignment
        const result = await this.notionAPI.createPage(this.dataSourceId, properties);
        return { action: 'created', assignment: assignment.title, result };
      }
    } catch (error) {
      console.error('Error syncing assignment:', error);
      return { action: 'error', assignment: assignment.title, error: error.message };
    }
  }

  async syncAssignments(assignments) {
    const results = [];
    
    // Initialize once before syncing
    if (!this.dataSourceId) {
      await this.initialize();
    }

    
    // Batch find existing assignments first to reduce API calls
    const existingAssignments = new Map();
    
    // Get all existing assignments with Canvas IDs in one query
    const canvasIds = assignments
      .filter(a => a.canvasId)
      .map(a => a.canvasId.toString());
    
    if (canvasIds.length > 0) {
      try {
        // Query all existing assignments at once
        const existing = await this.notionAPI.queryDataSource(this.dataSourceId, {
          property: 'Canvas ID',
          rich_text: {
            is_not_empty: true
          }
        });

        // Build lookup map
        if (existing.results) {
          for (const page of existing.results) {
            const canvasIdProp = page.properties['Canvas ID'];
            if (canvasIdProp && canvasIdProp.rich_text && canvasIdProp.rich_text.length > 0) {
              const canvasId = canvasIdProp.rich_text[0].text.content;
              existingAssignments.set(canvasId, page);
            }
          }
        }
        
      } catch (error) {
        console.warn('Failed to batch query existing assignments, falling back to individual queries:', error);
      }
    }
    
    // Process assignments with reduced API calls
    const promises = assignments.map(async (assignment) => {
      try {
        const existing = existingAssignments.get(assignment.canvasId?.toString());
        const properties = this.formatAssignmentProperties(assignment);

        if (existing) {
          // Check if existing assignment has "In Progress" status
          const existingStatus = existing.properties?.Status?.select?.name;
          const newStatus = assignment.status;
          
          // If existing status is "In Progress", only update if new status is "Submitted" or "Graded"
          if (existingStatus === 'In Progress' && 
              newStatus !== 'Submitted' && 
              newStatus !== 'Graded') {
            // Preserve the "In Progress" status
            if (properties.Status) {
              properties.Status = {
                select: { name: 'In Progress' }
              };
            }
          }
          
          // If existing status is "Submitted", only update if new status is "Graded"
          if (existingStatus === 'Submitted' && 
              newStatus !== 'Graded') {
            // Preserve the "Submitted" status
            if (properties.Status) {
              properties.Status = {
                select: { name: 'Submitted' }
              };
            }
          }
          
          // Update existing assignment
          const result = await this.notionAPI.updatePage(existing.id, properties);
          return { action: 'updated', assignment: assignment.title, result };
        } else {
          // Create new assignment
          const result = await this.notionAPI.createPage(this.dataSourceId, properties);
          return { action: 'created', assignment: assignment.title, result };
        }
      } catch (error) {
        console.error('Error syncing assignment:', assignment.title, error);
        return { action: 'error', assignment: assignment.title, error: error.message };
      }
    });

    // Execute up to 3 operations concurrently (respecting rate limits)
    const batchSize = 3;
    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
    }

    return results;
  }
}