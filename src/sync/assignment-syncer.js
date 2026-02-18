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

  /**
   * Query Notion for a live (non-archived) page matching a Canvas ID.
   * Used as a fallback when the cached page ID points to an archived page.
   * @param {string} canvasId
   * @returns {Object|null} The matching Notion page, or null if none found
   */
  async findLivePageByCanvasId(canvasId) {
    try {
      const response = await this.notionAPI.queryDataSource(this.dataSourceId, {
        property: 'Canvas ID',
        rich_text: { equals: canvasId }
      });

      // Return the first non-archived result
      if (response.results && response.results.length > 0) {
        return response.results.find(page => !page.archived) || null;
      }
      return null;
    } catch (error) {
      console.warn(`Could not search for existing page with Canvas ID ${canvasId}:`, error.message);
      return null;
    }
  }

  /**
   * Extract plain text Canvas ID from a Notion rich_text property.
   * Handles splitLongText segments via plain_text or text.content.
   */
  extractCanvasIdFromProperty(property) {
    if (!property || !property.rich_text || !Array.isArray(property.rich_text)) {
      return null;
    }
    const text = property.rich_text
      .map(segment => segment.plain_text || segment.text?.content || '')
      .join('');
    return text.trim() || null;
  }

  /**
   * Fetch all non-archived pages from the Notion data source and build
   * a canvasId -> notionPageId ground-truth mapping. Handles pagination.
   * @returns {Map<string, string>} Map of canvasId to notionPageId
   */
  async fetchAllNotionPages() {
    const truthMap = new Map();
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const response = await this.notionAPI.queryDataSource(
        this.dataSourceId,
        {},
        { start_cursor: startCursor, page_size: 100 }
      );

      for (const page of (response.results || [])) {
        if (page.archived) continue;

        const canvasId = this.extractCanvasIdFromProperty(page.properties?.['Canvas ID']);
        if (canvasId && !truthMap.has(canvasId)) {
          truthMap.set(canvasId, page.id);
        }
      }

      hasMore = response.has_more || false;
      startCursor = response.next_cursor || undefined;

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return truthMap;
  }

  /**
   * Reconcile the local cache against the Notion truth map.
   * Fixes stale notionPageId entries and populates missing ones.
   * Only populates cache for assignments in the current Canvas sync set to avoid
   * repeatedly adding and removing entries for inactive courses.
   * When a notionPageId is corrected, wipes canvasData to force a full update.
   * @param {Map<string, string>} truthMap - canvasId -> notionPageId from Notion
   * @param {Set<string>} [currentCanvasIds] - Canvas IDs in the current sync batch
   * @returns {Object} { fixed, populated, orphaned }
   */
  async reconcileCache(truthMap, currentCanvasIds = null) {
    const stats = { fixed: 0, populated: 0, orphaned: 0 };

    // Pass 1: Ensure cache entries match Notion truth
    for (const [canvasId, notionPageId] of truthMap.entries()) {
      const cached = await this.assignmentCache.getCachedAssignment(canvasId);

      if (!cached) {
        // Notion page exists but no cache entry — only populate if this
        // assignment is in the current Canvas sync set (avoids adding entries
        // for inactive courses that would just be removed during cleanup)
        if (!currentCanvasIds || currentCanvasIds.has(canvasId)) {
          await this.assignmentCache.cacheAssignment(canvasId, {}, notionPageId);
          stats.populated++;
        }
      } else if (cached.notionPageId !== notionPageId) {
        // Cache points to wrong Notion page — fix it and wipe canvasData
        await this.assignmentCache.cacheAssignment(canvasId, {}, notionPageId);
        stats.fixed++;
      }
    }

    // Pass 2: Remove cache entries whose notionPageId no longer exists in Notion
    const allCached = await this.assignmentCache.getAllAssignments();
    const truthPageIds = new Set(truthMap.values());

    for (const entry of allCached) {
      if (entry.notionPageId && !truthPageIds.has(entry.notionPageId)) {
        // The page this cache entry points to was deleted
        if (!truthMap.has(entry.canvasId)) {
          // No Notion page at all for this canvasId — remove stale entry
          await this.assignmentCache.removeAssignment(entry.canvasId);
          stats.orphaned++;
        }
        // If truthMap has this canvasId with a different pageId,
        // it was already fixed in Pass 1
      }
    }

    return stats;
  }

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

    if (validated.description) {
      properties["Description"] = {
        rich_text: NotionValidator.splitLongText(validated.description)
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

    // Build Canvas assignment map early so we can pass IDs to reconciliation
    const canvasAssignmentMap = new Map();
    const canvasIds = [];

    for (const assignment of assignments) {
      if (assignment.canvasId) {
        const canvasId = assignment.canvasId.toString();
        canvasAssignmentMap.set(canvasId, assignment);
        canvasIds.push(canvasId);
      }
    }

    const currentCanvasIdSet = new Set(canvasIds);

    // Step 0: Reconcile cache with Notion reality
    this._notionTruthMap = null;
    if (this.assignmentCache) {
      try {
        console.log('🔍 Reconciling cache with Notion...');
        const truthMap = await this.fetchAllNotionPages();
        console.log(`📄 Found ${truthMap.size} existing pages in Notion`);

        const reconcileStats = await this.reconcileCache(truthMap, currentCanvasIdSet);
        if (reconcileStats.fixed > 0 || reconcileStats.populated > 0 || reconcileStats.orphaned > 0) {
          console.log(
            `🔧 Cache reconciliation: ${reconcileStats.fixed} fixed, ` +
            `${reconcileStats.populated} populated, ${reconcileStats.orphaned} orphaned removed`
          );
        }

        this._notionTruthMap = truthMap;
      } catch (error) {
        console.warn('⚠️ Cache reconciliation failed, continuing with existing cache:', error.message);
      }
    }

    // Step 1: Set active courses for deletion detection
    if (this.assignmentCache && activeCourseIds.length > 0) {
      this.assignmentCache.setActiveCourses(activeCourseIds);
      console.log(`📚 Tracking ${activeCourseIds.length} active courses`);
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
          // Check truth map before creating — avoid duplicates
          const existingPageId = this._notionTruthMap?.get(canvasId);

          if (existingPageId) {
            // Page exists in Notion but wasn't in cache — update instead of create
            console.log(`🔗 Found existing Notion page for "${assignment.title}", updating instead of creating`);
            await this.notionAPI.updatePage(existingPageId, properties);

            if (this.assignmentCache) {
              await this.assignmentCache.cacheAssignment(canvasId, assignment, existingPageId);
            }

            results.updated.push({
              canvasId,
              title: assignment.title,
              changedFields: ['all (reconciled)'],
              notionPageId: existingPageId
            });
          } else {
            // Genuinely new assignment - create in Notion
            const result = await this.notionAPI.createPage(this.dataSourceId, properties);

            if (this.assignmentCache) {
              await this.assignmentCache.cacheAssignment(canvasId, assignment, result.id);
            }

            results.created.push({
              canvasId,
              title: assignment.title,
              notionPageId: result.id
            });
          }

        } else if (comparison.needsUpdate) {
          // Assignment changed - update in Notion
          const notionPageId = comparison.cachedEntry.notionPageId;

          try {
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
          } catch (updateError) {
            // If the page was archived/trashed in Notion, find the live page or create new
            if (updateError.message && updateError.message.includes('archived')) {
              console.log(`♻️ Cached page archived in Notion for "${assignment.title}", searching for live page...`);

              const existingPage = await this.findLivePageByCanvasId(canvasId);

              if (existingPage) {
                // Found a live page — update it and fix the cache
                console.log(`🔗 Found existing live page for "${assignment.title}", updating`);
                await this.notionAPI.updatePage(existingPage.id, properties);

                if (this.assignmentCache) {
                  await this.assignmentCache.cacheAssignment(canvasId, assignment, existingPage.id);
                }

                results.updated.push({
                  canvasId,
                  title: assignment.title,
                  changedFields: comparison.changedFields,
                  notionPageId: existingPage.id
                });
              } else {
                // No live page exists — create a new one
                const result = await this.notionAPI.createPage(this.dataSourceId, properties);

                if (this.assignmentCache) {
                  await this.assignmentCache.cacheAssignment(canvasId, assignment, result.id);
                }

                results.created.push({
                  canvasId,
                  title: assignment.title,
                  notionPageId: result.id
                });
              }
            } else {
              throw updateError;
            }
          }

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