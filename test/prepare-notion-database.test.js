import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// background-handlers.js pulls in sync-logger.js, which calls chrome.storage.local
// on flush() — provide a minimal mock so the handler's logging doesn't throw.
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {})
    }
  }
};

// ---------------------------------------------------------------------------
// Mock NotionAPI before importing background-handlers.js (ES module mock)
// ---------------------------------------------------------------------------
const getDatabaseMock = jest.fn();
const getDataSourceMock = jest.fn();
const updateDataSourcePropertiesMock = jest.fn();
const listViewsMock = jest.fn();
const updateViewMock = jest.fn();

await jest.unstable_mockModule('../src/api/notion-api.js', () => ({
  NotionAPI: jest.fn().mockImplementation(() => ({
    getDatabase: getDatabaseMock,
    getDataSource: getDataSourceMock,
    updateDataSourceProperties: updateDataSourcePropertiesMock,
    listViews: listViewsMock,
    updateView: updateViewMock
  }))
}));

const { prepareNotionDatabase } = await import('../src/handlers/background-handlers.js');

// Every column the template defines, with the type Notion reports for it.
const TEMPLATE_TYPES = {
  'Checkbox': 'checkbox',
  'Course': 'select',
  'Assignment Name': 'title',
  'Status': 'select',
  'Due Date': 'date',
  'Link to Resources': 'url',
  'Points': 'number',
  'Notes': 'rich_text',
  'Description': 'rich_text',
  'Canvas ID': 'rich_text',
  'Grade': 'number'
};

function schemaFor(overrides = {}) {
  const base = Object.fromEntries(
    Object.entries(TEMPLATE_TYPES).map(([name, type]) => [name, { id: `id-${name}`, type }])
  );
  return { ...base, ...overrides };
}

// The shape a database the user just made in Notion arrives in: one title
// column called "Name", plus whatever default Notion gave it.
function freshDatabaseSchema() {
  return {
    'Name': { id: 'id-Name', type: 'title' },
    'Tags': { id: 'id-Tags', type: 'multi_select' }
  };
}

describe('prepareNotionDatabase', () => {
  beforeEach(() => {
    getDatabaseMock.mockReset().mockResolvedValue({
      id: 'db-id',
      url: 'https://notion.so/db-id',
      data_sources: [{ id: 'ds-id' }]
    });
    getDataSourceMock.mockReset().mockResolvedValue({ properties: schemaFor() });
    updateDataSourcePropertiesMock.mockReset().mockResolvedValue({});
    listViewsMock.mockReset().mockResolvedValue({ results: [{ id: 'default-view-id' }] });
    updateViewMock.mockReset().mockResolvedValue({ id: 'default-view-id' });
  });

  test('adds the missing columns and renames the title on a freshly made database', async () => {
    getDataSourceMock.mockResolvedValue({ properties: freshDatabaseSchema() });

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(true);
    expect(result.databaseId).toBe('db-id');
    expect(result.dataSourceId).toBe('ds-id');
    expect(result.renamedTitleFrom).toBe('Name');

    const [dataSourceId, properties] = updateDataSourcePropertiesMock.mock.calls[0];
    expect(dataSourceId).toBe('ds-id');
    // The title is renamed (keyed by property ID), never added a second time.
    expect(properties['id-Name']).toEqual({ name: 'Assignment Name' });
    expect(properties['Assignment Name']).toBeUndefined();
    expect(properties).toMatchObject({
      'Checkbox': { checkbox: {} },
      'Course': expect.any(Object),
      'Status': expect.any(Object),
      'Due Date': expect.any(Object),
      'Link to Resources': expect.any(Object),
      'Points': expect.any(Object),
      'Notes': expect.any(Object),
      'Description': expect.any(Object),
      'Canvas ID': expect.any(Object),
      'Grade': expect.any(Object)
    });
  });

  test('leaves a database that already matches untouched', async () => {
    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.renamedTitleFrom).toBeNull();
    expect(updateDataSourcePropertiesMock).not.toHaveBeenCalled();
    expect(result.message).toMatch(/already had every column/);
  });

  test('keeps an existing column of the right type rather than redefining it', async () => {
    // The user's Status select carries their own options; sync adds any it
    // writes that are missing, so it must not be overwritten here.
    getDataSourceMock.mockResolvedValue({
      properties: schemaFor({ 'Status': { id: 'id-Status', type: 'select' } })
    });

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(true);
    expect(updateDataSourcePropertiesMock).not.toHaveBeenCalled();
  });

  test('reports a column held by an incompatible type instead of retyping it', async () => {
    getDataSourceMock.mockResolvedValue({
      properties: schemaFor({ 'Status': { id: 'id-Status', type: 'status' } })
    });

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"Status" is a status column but sync needs a select one/);
    expect(updateDataSourcePropertiesMock).not.toHaveBeenCalled();
  });

  test('frees up the old title name for a column that needs it', async () => {
    // Title property named "Course" — renaming it to "Assignment Name" leaves
    // "Course" available, so it gets added rather than reported as a conflict.
    getDataSourceMock.mockResolvedValue({
      properties: { 'Course': { id: 'id-Course', type: 'title' } }
    });

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(true);
    const properties = updateDataSourcePropertiesMock.mock.calls[0][1];
    expect(properties['id-Course']).toEqual({ name: 'Assignment Name' });
    expect(properties['Course']).toEqual({ select: {} });
    expect(result.added).toContain('Course');
  });

  test('applies the default sort and column layout, keeping the user\'s own columns visible', async () => {
    getDataSourceMock.mockResolvedValue({
      properties: schemaFor({ 'Tags': { id: 'id-Tags', type: 'multi_select' } })
    });

    await prepareNotionDatabase('test-token', 'db-id');

    expect(listViewsMock).toHaveBeenCalledWith('ds-id');
    expect(updateViewMock).toHaveBeenCalledWith('default-view-id', {
      sorts: [
        { property: 'Checkbox', direction: 'ascending' },
        { property: 'Due Date', direction: 'ascending' },
        { property: 'Assignment Name', direction: 'ascending' }
      ],
      configuration: {
        type: 'table',
        properties: [
          { property_id: 'id-Checkbox', visible: true },
          { property_id: 'id-Course', visible: true },
          { property_id: 'id-Assignment Name', visible: true },
          { property_id: 'id-Status', visible: true },
          { property_id: 'id-Due Date', visible: true },
          { property_id: 'id-Link to Resources', visible: true },
          { property_id: 'id-Points', visible: true },
          { property_id: 'id-Notes', visible: true },
          { property_id: 'id-Description', visible: true },
          { property_id: 'id-Canvas ID', visible: true },
          { property_id: 'id-Grade', visible: false },
          { property_id: 'id-Tags', visible: true }
        ]
      }
    });
  });

  test('still succeeds if configuring the default view fails', async () => {
    getDataSourceMock.mockResolvedValue({ properties: freshDatabaseSchema() });
    listViewsMock.mockRejectedValueOnce(new Error('views API unavailable'));

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(true);
    expect(result.databaseId).toBe('db-id');
  });

  test('rejects a link to something that is not a database', async () => {
    getDatabaseMock.mockResolvedValue({ id: 'db-id', url: 'https://notion.so/db-id', data_sources: [] });

    const result = await prepareNotionDatabase('test-token', 'db-id');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a plain page/);
  });

  test('returns a connection-specific message on 404', async () => {
    const error = new Error('Notion API error: 404 - not found');
    error.status = 404;
    getDatabaseMock.mockRejectedValueOnce(error);

    const result = await prepareNotionDatabase('test-token', 'missing-db');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Connections/);
  });

  test('returns a friendly error on other failures', async () => {
    const error = new Error('Notion API error: 401 - unauthorized');
    error.status = 401;
    getDatabaseMock.mockRejectedValueOnce(error);

    const result = await prepareNotionDatabase('bad-token', 'db-id');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid Notion Token/);
  });
});
