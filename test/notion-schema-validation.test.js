/**
 * Tests for the syncer side of #56: the schema is read once per run (and
 * reused across runs while cached), and the select values sync writes are
 * checked against the options the database actually has.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { NotionSchemaCache } from '../src/cache/notion-schema-cache.js';
import {
  AssignmentSyncer,
  VALIDATED_SELECT_PROPERTIES,
  MAX_SELECT_WARNINGS_PER_SYNC
} from '../src/sync/assignment-syncer.js';

// SyncLogger.flush() writes through chrome.storage.local.
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {})
    }
  }
};

const DS_ID = 'ds-1';

function schemaWith({ statusOptions = ['Not Started', 'Graded'], courseOptions = ['ENG101'], checkbox = true } = {}) {
  const schema = {
    'Assignment Name': { id: 'p-title', type: 'title' },
    'Status': { id: 'p-status', type: 'select', select: { options: statusOptions.map(name => ({ name })) } },
    'Course': { id: 'p-course', type: 'select', select: { options: courseOptions.map(name => ({ name })) } }
  };
  if (checkbox) schema.Checkbox = { id: 'p-check', type: 'checkbox' };
  return schema;
}

function makeSyncer({ schema = schemaWith(), cache = new NotionSchemaCache(), getDataSource } = {}) {
  const getDataSourceMock = getDataSource || jest.fn(async () => ({ properties: schema }));
  const notionAPI = {
    getDatabase: jest.fn(async () => ({ id: 'db-1', data_sources: [{ id: DS_ID }] })),
    getDataSource: getDataSourceMock,
    queryDataSource: jest.fn(async () => ({ results: [], has_more: false })),
    createPage: jest.fn(async () => ({ id: 'page-1' })),
    updatePage: jest.fn(async () => ({ id: 'page-1' })),
    getPage: jest.fn(async () => ({ properties: {} }))
  };
  const syncer = new AssignmentSyncer(notionAPI, 'db-1', null, { schemaCache: cache });
  return { syncer, notionAPI, getDataSourceMock, cache };
}

function assignment(overrides = {}) {
  return {
    canvasId: '1',
    title: 'Essay 1',
    course: 'ENG101',
    courseId: 'course-1',
    status: 'Not Started',
    dueDate: null,
    points: null,
    description: null,
    gradePercent: null,
    link: null,
    ...overrides
  };
}

describe('schema loading', () => {
  test('initialize reads the schema once and reuses it for the Checkbox column', async () => {
    const { syncer, getDataSourceMock } = makeSyncer();

    await syncer.initialize();

    expect(getDataSourceMock).toHaveBeenCalledTimes(1);
    expect(syncer.hasCompletionCheckbox).toBe(true);
    expect(syncer.schema.Status.type).toBe('select');
  });

  test('a second sync within the TTL costs no schema request', async () => {
    const cache = new NotionSchemaCache();
    const first = makeSyncer({ cache });
    const second = makeSyncer({ cache });

    await first.syncer.syncAssignments([assignment()], ['course-1']);
    await second.syncer.syncAssignments([assignment()], ['course-1']);

    expect(first.getDataSourceMock).toHaveBeenCalledTimes(1);
    expect(second.getDataSourceMock).not.toHaveBeenCalled();
    expect(second.syncer.hasCompletionCheckbox).toBe(true);
  });

  test('a full sync reads the schema at most once', async () => {
    const { syncer, getDataSourceMock } = makeSyncer();

    await syncer.syncAssignments(
      [assignment({ canvasId: '1' }), assignment({ canvasId: '2' }), assignment({ canvasId: '3' })],
      ['course-1']
    );

    expect(getDataSourceMock).toHaveBeenCalledTimes(1);
  });

  test('a schema request failure degrades to no validation instead of failing the sync', async () => {
    const getDataSource = jest.fn(async () => { throw new Error('boom'); });
    const { syncer } = makeSyncer({ getDataSource });

    await expect(syncer.syncAssignments([assignment()], ['course-1'])).resolves.toMatchObject({ errors: [] });
    // Tried once for the run, not once per consumer of the schema.
    expect(getDataSource).toHaveBeenCalledTimes(1);
    expect(syncer.schema).toBeNull();
    expect(syncer.hasCompletionCheckbox).toBe(false);
    expect(syncer.validateSelectValues({ Course: { select: { name: 'Anything' } } })).toEqual([]);
  });

  test('an API client without getDataSource still syncs', async () => {
    const { syncer, notionAPI } = makeSyncer();
    delete notionAPI.getDataSource;

    await expect(syncer.initialize()).resolves.toMatchObject({ success: true });
    expect(syncer.schema).toBeNull();
    expect(syncer.hasCompletionCheckbox).toBe(false);
  });
});

describe('validateSelectValues', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(globalThis.SyncLogger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function initialisedSyncer(schema) {
    const { syncer } = makeSyncer({ schema, cache: new NotionSchemaCache() });
    await syncer.initialize();
    return syncer;
  }

  test('checks every select column sync writes', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    const unknown = syncer.validateSelectValues({
      Status: { select: { name: 'Blocked' } },
      Course: { select: { name: 'NEW101' } }
    });

    expect(unknown.map(entry => entry.property).sort())
      .toEqual([...VALIDATED_SELECT_PROPERTIES].sort());
  });

  test('says nothing about values the database already offers', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    const unknown = syncer.validateSelectValues({
      Status: { select: { name: 'Graded' } },
      Course: { select: { name: 'ENG101' } }
    });

    expect(unknown).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('reports a value Notion would have to create', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    const unknown = syncer.validateSelectValues({
      Status: { select: { name: 'Graded' } },
      Course: { select: { name: 'ENG 101 (Fall)' } }
    });

    expect(unknown).toEqual([{ property: 'Course', value: 'ENG 101 (Fall)' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('ENG 101 (Fall)');
    expect(warnSpy.mock.calls[0][0]).toContain('Course');
  });

  test('reports a renamed status option too', async () => {
    const syncer = await initialisedSyncer(schemaWith({ statusOptions: ['Todo', 'Done'] }));

    expect(syncer.validateSelectValues({ Status: { select: { name: 'Not Started' } } }))
      .toEqual([{ property: 'Status', value: 'Not Started' }]);
  });

  test('warns once per distinct value, however many assignments carry it', async () => {
    const syncer = await initialisedSyncer(schemaWith());
    const properties = { Course: { select: { name: 'NEW101' } } };

    syncer.validateSelectValues(properties);
    syncer.validateSelectValues(properties);
    syncer.validateSelectValues({ Course: { select: { name: 'NEW102' } } });

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('keeps still-unknown values worth reporting on the next run', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    await syncer.syncAssignments([assignment({ course: 'NEW101' })], ['course-1']);
    const afterFirstRun = warnSpy.mock.calls.length;
    await syncer.syncAssignments([assignment({ course: 'NEW101' })], ['course-1']);

    expect(afterFirstRun).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('caps the warnings one sync can put in the 100-entry log', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    for (let i = 0; i < MAX_SELECT_WARNINGS_PER_SYNC + 10; i++) {
      syncer.validateSelectValues({ Course: { select: { name: `COURSE${i}` } } });
    }

    // The cap, plus one line saying the rest were suppressed.
    expect(warnSpy).toHaveBeenCalledTimes(MAX_SELECT_WARNINGS_PER_SYNC + 1);
    expect(warnSpy.mock.calls.at(-1)[0]).toContain(`first ${MAX_SELECT_WARNINGS_PER_SYNC}`);
  });

  test('says nothing about a column the database does not have', async () => {
    const schema = schemaWith();
    delete schema.Course;
    const syncer = await initialisedSyncer(schema);

    expect(syncer.validateSelectValues({ Course: { select: { name: 'ENG101' } } })).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('says nothing about a column that is not a select (Notion\'s status type)', async () => {
    const schema = schemaWith();
    schema.Status = { id: 'p-status', type: 'status' };
    const syncer = await initialisedSyncer(schema);

    expect(syncer.validateSelectValues({ Status: { select: { name: 'Graded' } } })).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('ignores payloads with no select values (a status-only correction)', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    expect(syncer.validateSelectValues({ Points: { number: 10 } })).toEqual([]);
    expect(syncer.validateSelectValues({})).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('every page write is validated, since it runs inside formatAssignmentProperties', async () => {
    const syncer = await initialisedSyncer(schemaWith());

    syncer.formatAssignmentProperties(assignment({ course: 'UNKNOWN101' }));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('UNKNOWN101');
  });

  test('a value is still written — reporting must not drop a real course', async () => {
    const { syncer, notionAPI } = makeSyncer({ cache: new NotionSchemaCache() });

    await syncer.syncAssignments([assignment({ course: 'UNKNOWN101' })], ['course-1']);

    expect(notionAPI.createPage).toHaveBeenCalledTimes(1);
    const properties = notionAPI.createPage.mock.calls[0][1];
    expect(properties.Course).toEqual({ select: { name: 'UNKNOWN101' } });
  });
});
