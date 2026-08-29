/**
 * Tests for the Checkbox column that mirrors the Notion database automation
 * "when Status is set to Graded/Submitted/Pending Review, check Checkbox".
 * Notion exposes no automations API, so the syncer reproduces the behaviour.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import {
  COMPLETION_CHECKBOX_STATUSES,
  shouldTickCompletionCheckbox,
  AssignmentSyncer
} from '../src/sync/assignment-syncer.js';

describe('shouldTickCompletionCheckbox', () => {
  test('covers exactly the statuses the Notion automation triggers on', () => {
    expect([...COMPLETION_CHECKBOX_STATUSES].sort())
      .toEqual(['Graded', 'Pending Review', 'Submitted']);
  });

  test.each(COMPLETION_CHECKBOX_STATUSES)('ticks when entering %s from Not Started', (status) => {
    expect(shouldTickCompletionCheckbox('Not Started', status)).toBe(true);
  });

  test('ticks on a brand new page created at a completion status', () => {
    expect(shouldTickCompletionCheckbox(null, 'Graded')).toBe(true);
    expect(shouldTickCompletionCheckbox(undefined, 'Submitted')).toBe(true);
  });

  test('does not tick while already sitting in a completion status', () => {
    // The key anti-nag case: unchecking a graded assignment by hand must not
    // be undone by the next sync.
    expect(shouldTickCompletionCheckbox('Graded', 'Graded')).toBe(false);
    expect(shouldTickCompletionCheckbox('Submitted', 'Graded')).toBe(false);
    expect(shouldTickCompletionCheckbox('Pending Review', 'Submitted')).toBe(false);
  });

  test('does not tick for non-completion statuses', () => {
    expect(shouldTickCompletionCheckbox('Not Started', 'Late')).toBe(false);
    expect(shouldTickCompletionCheckbox('Graded', 'In Progress')).toBe(false);
    expect(shouldTickCompletionCheckbox(null, undefined)).toBe(false);
  });
});

describe('AssignmentSyncer.detectCompletionCheckbox', () => {
  function syncerWith(getDataSource) {
    const syncer = new AssignmentSyncer({ getDataSource }, 'db1');
    syncer.dataSourceId = 'ds1';
    return syncer;
  }

  test('true when the database has a Checkbox checkbox column', async () => {
    const syncer = syncerWith(jest.fn(async () => ({
      properties: { Checkbox: { id: 'abc', type: 'checkbox' } }
    })));
    await expect(syncer.detectCompletionCheckbox()).resolves.toBe(true);
  });

  test('false when the column is absent (databases predating the template)', async () => {
    const syncer = syncerWith(jest.fn(async () => ({
      properties: { 'Assignment Name': { id: 'title', type: 'title' } }
    })));
    await expect(syncer.detectCompletionCheckbox()).resolves.toBe(false);
  });

  test('false when a same-named column is not a checkbox', async () => {
    const syncer = syncerWith(jest.fn(async () => ({
      properties: { Checkbox: { id: 'abc', type: 'rich_text' } }
    })));
    await expect(syncer.detectCompletionCheckbox()).resolves.toBe(false);
  });

  test('false (not a throw) when the schema request fails', async () => {
    const syncer = syncerWith(jest.fn(async () => { throw new Error('boom'); }));
    await expect(syncer.detectCompletionCheckbox()).resolves.toBe(false);
  });
});

describe('AssignmentSyncer.applyCompletionCheckbox', () => {
  let syncer;

  beforeEach(() => {
    syncer = new AssignmentSyncer({}, 'db1');
    syncer.hasCompletionCheckbox = true;
  });

  test('adds Checkbox on transition into a completion status', () => {
    const properties = { Status: { select: { name: 'Graded' } } };
    syncer.applyCompletionCheckbox(properties, 'Not Started');
    expect(properties.Checkbox).toEqual({ checkbox: true });
  });

  test('leaves properties untouched when already complete', () => {
    const properties = { Status: { select: { name: 'Graded' } } };
    syncer.applyCompletionCheckbox(properties, 'Graded');
    expect(properties.Checkbox).toBeUndefined();
  });

  test('never writes Checkbox when the database lacks the column', () => {
    syncer.hasCompletionCheckbox = false;
    const properties = { Status: { select: { name: 'Graded' } } };
    syncer.applyCompletionCheckbox(properties, 'Not Started');
    expect(properties.Checkbox).toBeUndefined();
  });

  test('uses the preserved status already in properties, not the raw Canvas one', () => {
    // applyStatusPreservation may have rewritten Status to a manual value;
    // the checkbox must follow what is actually being written.
    const properties = { Status: { select: { name: 'In Progress' } } };
    syncer.applyCompletionCheckbox(properties, 'Not Started');
    expect(properties.Checkbox).toBeUndefined();
  });

  test('no-ops when there is no Status in the payload', () => {
    const properties = { Points: { number: 10 } };
    syncer.applyCompletionCheckbox(properties, 'Not Started');
    expect(properties.Checkbox).toBeUndefined();
  });
});
