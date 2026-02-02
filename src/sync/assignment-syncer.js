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

  // REMOVED: findExistingAssignment - replaced with batch lookup for performance

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

  // REMOVED: syncAssignment - replaced with batch processing in syncAssignments

  async syncAssignments(assignments) {
    // Initialize once before syncing
    if (!this.dataSourceId) {
      await this.initialize();
    }

    console.log(`🔍 Starting duplicate prevention lookup for ${assignments.length} assignments from Canvas`);

    // Build lookup map by querying each Canvas ID individually
    // This ensures we find all existing assignments, avoiding duplicates
    const existingAssignments = new Map();

    // Get all Canvas IDs we need to check
    const canvasIds = assignments
      .filter(a => a.canvasId)
      .map(a => a.canvasId.toString());

    console.log(`📋 Canvas IDs to check: ${canvasIds.length}`);

    if (canvasIds.length > 0) {
      // Query each Canvas ID individually to avoid pagination issues
      // Process in small batches to respect rate limits
      const lookupBatchSize = 5;
      let foundCount = 0;

      for (let i = 0; i < canvasIds.length; i += lookupBatchSize) {
        const batchIds = canvasIds.slice(i, i + lookupBatchSize);
        const batchNumber = Math.floor(i / lookupBatchSize) + 1;
        const totalLookupBatches = Math.ceil(canvasIds.length / lookupBatchSize);

        console.log(`🔎 Lookup batch ${batchNumber}/${totalLookupBatches}: Checking ${batchIds.length} Canvas IDs`);

        // Query each ID in this batch
        const lookupPromises = batchIds.map(async (canvasId) => {
          try {
            const result = await this.notionAPI.queryDataSource(this.dataSourceId, {
              property: 'Canvas ID',
              rich_text: {
                equals: canvasId  // Specific filter - finds exact match
              }
            });

            // Store the first result (should only be one per Canvas ID)
            if (result.results && result.results.length > 0) {
              const page = result.results[0];
              existingAssignments.set(canvasId, page);
              return { canvasId, found: true };
            }
            return { canvasId, found: false };
          } catch (error) {
            console.warn(`Failed to query Canvas ID ${canvasId}:`, error.message);
            return { canvasId, found: false, error: true };
          }
        });

        const batchResults = await Promise.all(lookupPromises);
        const batchFoundCount = batchResults.filter(r => r.found).length;
        foundCount += batchFoundCount;

        console.log(`✅ Lookup batch ${batchNumber} complete: ${batchFoundCount}/${batchIds.length} found in Notion`);

        // Small delay between lookup batches
        if (i + lookupBatchSize < canvasIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`\n📊 Lookup complete: ${foundCount}/${canvasIds.length} assignments already exist in Notion`);
      console.log(`   ➕ Will create: ${canvasIds.length - foundCount} new assignments`);
      console.log(`   🔄 Will update: ${foundCount} existing assignments\n`);
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

    // Process assignments in controlled batches for 100% success rate
    const results = [];
    const batchSize = 4; // Safe concurrency level to prevent 409 conflicts
    const batchDelay = 200; // 200ms delay between batches
    const totalBatches = Math.ceil(promises.length / batchSize);
    
    // Track success metrics
    let successCount = 0;
    let errorCount = 0;
    let retryCount = 0;
    
    console.log(`🚀 Starting sync: ${promises.length} assignments in ${totalBatches} batches of ${batchSize}`);
    
    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      const batchNumber = Math.floor(i/batchSize) + 1;
      
      console.log(`📦 Batch ${batchNumber}/${totalBatches}: Processing ${batch.length} assignments`);
      
      try {
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
        
        // Count successes and errors for this batch
        const batchSuccesses = batchResults.filter(r => r.action !== 'error').length;
        const batchErrors = batchResults.filter(r => r.action === 'error').length;
        successCount += batchSuccesses;
        errorCount += batchErrors;
        
        console.log(`✅ Batch ${batchNumber} complete: ${batchSuccesses} success, ${batchErrors} errors`);
        
        // Add delay between batches to prevent conflicts (except for last batch)
        if (i + batchSize < promises.length) {
          console.log(`⏳ Waiting ${batchDelay}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      } catch (error) {
        console.error(`❌ Batch ${batchNumber} failed:`, error);
        
        // Process this batch sequentially as fallback
        console.log(`🔄 Falling back to sequential processing for batch ${batchNumber}...`);
        for (const promise of batch) {
          try {
            const result = await promise;
            results.push(result);
            if (result.action !== 'error') {
              successCount++;
            } else {
              errorCount++;
            }
          } catch (err) {
            console.error('❌ Sequential fallback also failed:', err);
            const errorResult = { action: 'error', assignment: 'Unknown', error: err.message };
            results.push(errorResult);
            errorCount++;
          }
        }
      }
    }
    
    // Final summary
    const successRate = ((successCount / results.length) * 100).toFixed(1);
    console.log(`\n📊 Sync Complete:`);
    console.log(`   Total: ${results.length} assignments`);
    console.log(`   ✅ Success: ${successCount} (${successRate}%)`);
    console.log(`   ❌ Errors: ${errorCount}`);
    
    if (successRate < 100) {
      console.warn(`⚠️ Success rate below 100% - check errors above`);
    } else {
      console.log(`🎉 Perfect sync achieved!`);
    }
    
    return results;
  }
}