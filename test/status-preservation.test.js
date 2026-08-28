/**
 * Unit tests for the status-direction rank table and the preservation logic
 * that uses it (issue #24 — backward manual status changes must be corrected
 * by Canvas truth, forward manual progress must be preserved).
 */
import { describe, test, expect, jest } from '@jest/globals';
import { STATUS_RANK, resolvePreservedStatus, AssignmentSyncer } from '../src/sync/assignment-syncer.js';

// ---------------------------------------------------------------------------
// STATUS_RANK / resolvePreservedStatus
// ---------------------------------------------------------------------------

describe('STATUS_RANK', () => {
  test('covers every status Canvas can emit plus the manual-only "In Progress" value', () => {
    // getSubmissionStatus (content-script.js) emits: Not Started, Submitted,
    // Pending Review, Late, Graded. "In Progress" is manual-only.
    for (const status of ['Not Started', 'Submitted', 'Pending Review', 'Late', 'Graded', 'In Progress']) {
      expect(Object.prototype.hasOwnProperty.call(STATUS_RANK, status)).toBe(true);
    }
  });

  test('Late ranks with Not Started (a deadline state, not progress)', () => {
    expect(STATUS_RANK['Late']).toBe(STATUS_RANK['Not Started']);
  });

  test('Pending Review ranks with Submitted (submitted, awaiting a grader)', () => {
    expect(STATUS_RANK['Pending Review']).toBe(STATUS_RANK['Submitted']);
  });

  test('Graded is the highest rank', () => {
    const maxOther = Math.max(
      STATUS_RANK['Not Started'], STATUS_RANK['Late'], STATUS_RANK['In Progress'],
      STATUS_RANK['Submitted'], STATUS_RANK['Pending Review']
    );
    expect(STATUS_RANK['Graded']).toBeGreaterThan(maxOther);
  });
});

describe('resolvePreservedStatus', () => {
  test('forward progress: manual In Progress + Canvas Not Started → stays In Progress', () => {
    expect(resolvePreservedStatus('In Progress', 'Not Started')).toBe('In Progress');
  });

  test('forward progress: manual Submitted + Canvas Graded → becomes Graded', () => {
    expect(resolvePreservedStatus('Submitted', 'Graded')).toBe('Graded');
  });

  test('backward regression: manual Graded rolled back to Not Started, Canvas still Graded → corrected to Graded', () => {
    expect(resolvePreservedStatus('Not Started', 'Graded')).toBe('Graded');
  });

  test('backward regression: manual Graded rolled back to In Progress, Canvas still Graded → corrected to Graded', () => {
    expect(resolvePreservedStatus('In Progress', 'Graded')).toBe('Graded');
  });

  test('equal rank, same value: Late vs Late → stays Late (no-op)', () => {
    expect(resolvePreservedStatus('Late', 'Late')).toBe('Late');
  });

  test('equal rank, different value: existing Late, Canvas reports Not Started → Canvas wins (not a regression, but not forward progress either)', () => {
    expect(resolvePreservedStatus('Late', 'Not Started')).toBe('Not Started');
  });

  test('equal rank, different value: existing Not Started, Canvas reports Late → Canvas wins', () => {
    expect(resolvePreservedStatus('Not Started', 'Late')).toBe('Late');
  });

  test('equal rank: existing Pending Review, Canvas reports Submitted → Canvas wins', () => {
    expect(resolvePreservedStatus('Pending Review', 'Submitted')).toBe('Submitted');
  });

  test('equal rank: existing Submitted, Canvas reports Pending Review → Canvas wins', () => {
    expect(resolvePreservedStatus('Submitted', 'Pending Review')).toBe('Pending Review');
  });

  test('forward progress preserved across the Pending Review / Late boundary: existing Pending Review, Canvas reports Late → stays Pending Review', () => {
    // Pending Review (rank 2) outranks Late (rank 0) — this is forward progress.
    expect(resolvePreservedStatus('Pending Review', 'Late')).toBe('Pending Review');
  });

  test('unknown existing status falls through to Canvas value, no throw', () => {
    expect(() => resolvePreservedStatus('Some Custom Status', 'Graded')).not.toThrow();
    expect(resolvePreservedStatus('Some Custom Status', 'Graded')).toBe('Graded');
  });

  test('unknown new status falls through to writing it as-is, no throw', () => {
    expect(() => resolvePreservedStatus('Graded', 'Some Custom Status')).not.toThrow();
    expect(resolvePreservedStatus('Graded', 'Some Custom Status')).toBe('Some Custom Status');
  });

  test('null/undefined existing status (no Status property on the page) → Canvas value wins, no throw', () => {
    expect(() => resolvePreservedStatus(null, 'Graded')).not.toThrow();
    expect(resolvePreservedStatus(null, 'Graded')).toBe('Graded');
    expect(resolvePreservedStatus(undefined, 'Graded')).toBe('Graded');
  });
});

// ---------------------------------------------------------------------------
// applyStatusPreservation — the needsUpdate-path guard, using the rank table
// ---------------------------------------------------------------------------

describe('AssignmentSyncer.applyStatusPreservation', () => {
  function makeSyncerWithNotion(getPageResult) {
    const notionAPI = {
      getPage: jest.fn(async () => getPageResult)
    };
    const syncer = new AssignmentSyncer(notionAPI, 'db-id', null);
    return { syncer, notionAPI };
  }

  test('preserves manual In Progress when Canvas still reports Not Started (existing behavior, regression guard)', async () => {
    const { syncer } = makeSyncerWithNotion({
      properties: { Status: { select: { name: 'In Progress' } } }
    });
    const properties = { Status: { select: { name: 'Not Started' } } };

    await syncer.applyStatusPreservation(properties, 'page-1', 'Not Started');

    expect(properties.Status.select.name).toBe('In Progress');
  });

  test('lets Submitted through when Canvas reports Graded', async () => {
    const { syncer } = makeSyncerWithNotion({
      properties: { Status: { select: { name: 'Submitted' } } }
    });
    const properties = { Status: { select: { name: 'Graded' } } };

    await syncer.applyStatusPreservation(properties, 'page-1', 'Graded');

    expect(properties.Status.select.name).toBe('Graded');
  });

  test('corrects a manual backward change: existing Not Started, Canvas Graded → Graded wins', async () => {
    const { syncer } = makeSyncerWithNotion({
      properties: { Status: { select: { name: 'Not Started' } } }
    });
    const properties = { Status: { select: { name: 'Graded' } } };

    await syncer.applyStatusPreservation(properties, 'page-1', 'Graded');

    expect(properties.Status.select.name).toBe('Graded');
  });

  test('Late and Pending Review on both sides: existing Late, Canvas Pending Review → Canvas wins (forward)', async () => {
    const { syncer } = makeSyncerWithNotion({
      properties: { Status: { select: { name: 'Late' } } }
    });
    const properties = { Status: { select: { name: 'Pending Review' } } };

    await syncer.applyStatusPreservation(properties, 'page-1', 'Pending Review');

    expect(properties.Status.select.name).toBe('Pending Review');
  });

  test('Late and Pending Review on both sides: existing Pending Review, Canvas Late → existing preserved (forward progress)', async () => {
    const { syncer } = makeSyncerWithNotion({
      properties: { Status: { select: { name: 'Pending Review' } } }
    });
    const properties = { Status: { select: { name: 'Late' } } };

    await syncer.applyStatusPreservation(properties, 'page-1', 'Late');

    expect(properties.Status.select.name).toBe('Pending Review');
  });

  test('Notion page with no Status property → Canvas value wins, no throw', async () => {
    const { syncer } = makeSyncerWithNotion({ properties: {} });
    const properties = { Status: { select: { name: 'Graded' } } };

    await expect(
      syncer.applyStatusPreservation(properties, 'page-1', 'Graded')
    ).resolves.not.toThrow();

    expect(properties.Status.select.name).toBe('Graded');
  });

  test('getPage failure → falls back to the Canvas value already in properties, no throw', async () => {
    const notionAPI = { getPage: jest.fn(async () => { throw new Error('network error'); }) };
    const syncer = new AssignmentSyncer(notionAPI, 'db-id', null);
    const properties = { Status: { select: { name: 'Graded' } } };

    await expect(
      syncer.applyStatusPreservation(properties, 'page-1', 'Graded')
    ).resolves.not.toThrow();

    expect(properties.Status.select.name).toBe('Graded');
  });
});
