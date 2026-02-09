import { NotionValidator } from '../validators/notion-validator.js';

// Assignment synchronization logic with unified cache system
export class AssignmentSyncer {
  constructor(notionAPI, databaseId, assignmentCache = null) {
    this.notionAPI = notionAPI;
    this.databaseId = databaseId;
    this.assignmentCache = assignmentCache;
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
      console.error('Failed to initialize syncer:', error.message);
      throw error;
    }
  }

  // REMOVED: findExistingAssignment - replaced with batch lookup for performance

  formatAssignmentProperties(assignment) {
    // Validate all fields before building Notion properties
    const { validated, warnings } = NotionValidator.validateAssignmentForNotion(assignment);

    if (warnings.length > 0) {
      console.warn(`⚠️ Validation warnings for "${assignment.title || assignment.canvasId}":`,
        warnings.join('; '));
    }

    const properties = {
      "Assignment Name": {
        title: [{ text: { content: validated.title } }]
      }
    };

    if (validated.course) {
      properties["Course"] = {
        select: { name: validated.course }
      };
    }

    if (validated.dueDate) {
      properties["Due Date"] = {
        date: { start: validated.dueDate }
      };
    }

    if (validated.status) {
      properties["Status"] = {
        select: { name: validated.status }
      };
    }

    if (validated.points !== null) {
      properties["Points"] = {
        number: validated.points
      };
    }

    if (validated.link) {
      properties["Link to Resources"] = {
        url: validated.link
      };
    }

    if (validated.canvasId) {
      properties["Canvas ID"] = {
        rich_text: NotionValidator.splitLongText(validated.canvasId)
      };
    }

    if (validated.gradePercent !== null) {
      properties["Grade"] = {
        number: validated.gradePercent
      };
    }

    return properties;
  }

  /**
   * Main sync method implementing the unified cache algorithm
   * @param {Array} assignments - Canvas assignments to sync
   * @param {Array<string>} activeCourseIds - Currently active Canvas course IDs
   * @returns {Object} Sync results with statistics
   */
  async syncAssignments(assignments, activeCourseIds = []) {
    // Initialize once before syncing
    if (!this.dataSourceId) {
      await this.initialize();
    }

    console.log(`\n🔄 Starting unified cache sync for ${assignments.length} Canvas assignments`);

    // Step 1: Set active courses for deletion detection
    if (this.assignmentCache && activeCourseIds.length > 0) {
      this.assignmentCache.setActiveCourses(activeCourseIds);
      console.log(`📚 Tracking ${activeCourseIds.length} active courses`);
    }

    // Step 2: Build Canvas assignment map
    const canvasAssignmentMap = new Map();
    const canvasIds = [];

    for (const assignment of assignments) {
      if (assignment.canvasId) {
        const canvasId = assignment.canvasId.toString();
        canvasAssignmentMap.set(canvasId, assignment);
        canvasIds.push(canvasId);
      }
    }

    console.log(`📋 Processing ${canvasIds.length} assignments with Canvas IDs`);

    // Step 3: Process each assignment with field-level change detection
    const results = {
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
      errors: []
    };

    for (const [canvasId, assignment] of canvasAssignmentMap.entries()) {
      try {
        // Check cache and compare fields
        const comparison = this.assignmentCache
          ? await this.assignmentCache.compareAndNeedsUpdate(canvasId, assignment)
          : { needsUpdate: true, changedFields: [], cachedEntry: null };

        const properties = this.formatAssignmentProperties(assignment);

        if (!comparison.cachedEntry) {
          // New assignment - create in Notion
          const result = await this.notionAPI.createPage(this.dataSourceId, properties);

          // Cache the new assignment
          if (this.assignmentCache) {
            await this.assignmentCache.cacheAssignment(canvasId, assignment, result.id);
          }

          results.created.push({
            canvasId,
            title: assignment.title,
            notionPageId: result.id
          });

        } else if (comparison.needsUpdate) {
          // Assignment changed - update in Notion
          const notionPageId = comparison.cachedEntry.notionPageId;

          // Preserve manual status changes
          await this.applyStatusPreservation(properties, notionPageId, assignment.status);

          await this.notionAPI.updatePage(notionPageId, properties);

          // Update cache with new data
          if (this.assignmentCache) {
            await this.assignmentCache.cacheAssignment(canvasId, assignment, notionPageId);
          }

          results.updated.push({
            canvasId,
            title: assignment.title,
            changedFields: comparison.changedFields,
            notionPageId
          });

        } else {
          // No changes - skip API call
          results.skipped.push({
            canvasId,
            title: assignment.title
          });
        }

      } catch (error) {
        console.error(`❌ Error syncing assignment ${assignment.title}:`, error.message);
        results.errors.push({
          canvasId,
          title: assignment.title,
          error: error.message
        });
      }

      // Small delay between API calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Step 4: Handle deleted assignments
    if (this.assignmentCache && activeCourseIds.length > 0) {
      console.log(`\n🗑️  Checking for deleted assignments...`);
      const cleanup = await this.assignmentCache.cleanupInactiveCourses(canvasIds);

      // Delete from Notion (active courses only)
      for (const { canvasId, notionPageId, courseId } of cleanup.toDelete) {
        try {
          // Archive the page in Notion
          await this.notionAPI.updatePage(notionPageId, {}, { archived: true });

          // Remove from cache
          await this.assignmentCache.removeAssignment(canvasId);

          results.deleted.push({ canvasId, courseId, notionPageId });
        } catch (error) {
          console.error(`❌ Failed to delete assignment ${canvasId}:`, error.message);
          results.errors.push({
            canvasId,
            error: `Deletion failed: ${error.message}`
          });
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Remove from cache only (inactive courses - keep in Notion as historical data)
      for (const { canvasId } of cleanup.toRemove) {
        await this.assignmentCache.removeAssignment(canvasId);
      }

      console.log(`✅ Cleanup complete: ${cleanup.toDelete.length} deleted, ${cleanup.toRemove.length} archived from cache`);
    }

    // Step 5: Print summary
    this.printSyncSummary(results);

    return results;
  }

  /**
   * Preserve manual "In Progress" and "Submitted" status changes
   * Only allow automatic status updates that progress forward in the workflow
   */
  async applyStatusPreservation(properties, notionPageId, newStatus) {
    try {
      // Fetch current page to check existing status
      const currentPage = await this.notionAPI.getPage(notionPageId);
      const existingStatus = currentPage.properties?.Status?.select?.name;

      // If existing status is "In Progress", only update if new status is "Submitted" or "Graded"
      if (existingStatus === 'In Progress' &&
          newStatus !== 'Submitted' &&
          newStatus !== 'Graded') {
        properties.Status = { select: { name: 'In Progress' } };
      }

      // If existing status is "Submitted", only update if new status is "Graded"
      if (existingStatus === 'Submitted' && newStatus !== 'Graded') {
        properties.Status = { select: { name: 'Submitted' } };
      }
    } catch (error) {
      // If we can't fetch the current page, just use the new status
      console.warn(`Could not fetch existing status for status preservation:`, error.message);
    }
  }

  /**
   * Print detailed sync summary
   */
  printSyncSummary(results) {
    const total = results.created.length + results.updated.length +
                  results.skipped.length + results.deleted.length + results.errors.length;

    console.log(`\n📊 Sync Summary:`);
    console.log(`   Total assignments: ${total}`);
    console.log(`   ➕ Created: ${results.created.length}`);
    console.log(`   🔄 Updated: ${results.updated.length}`);
    console.log(`   ⏭️  Skipped (no changes): ${results.skipped.length}`);
    console.log(`   🗑️  Deleted: ${results.deleted.length}`);
    console.log(`   ❌ Errors: ${results.errors.length}`);

    if (results.skipped.length > 0) {
      const apiSavings = ((results.skipped.length / total) * 100).toFixed(1);
      console.log(`\n💡 API call reduction: ${apiSavings}% (${results.skipped.length}/${total} assignments unchanged)`);
    }

    if (results.errors.length > 0) {
      console.warn(`\n⚠️  Errors encountered:`);
      results.errors.forEach(err => {
        console.warn(`   - ${err.title || err.canvasId}: ${err.error}`);
      });
    } else {
      console.log(`\n✅ Sync completed successfully!`);
    }
  }
}