import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// background-handlers.js pulls in sync-logger.js, which calls chrome.storage.local
// on flush() — provide a minimal mock so createNotionDatabase's logging doesn't throw.
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
const createDatabaseMock = jest.fn();
const listViewsMock = jest.fn();
const updateViewMock = jest.fn();
const getDataSourceMock = jest.fn();

await jest.unstable_mockModule('../src/api/notion-api.js', () => ({
  NotionAPI: jest.fn().mockImplementation(() => ({
    createDatabase: createDatabaseMock,
    listViews: listViewsMock,
    updateView: updateViewMock,
    getDataSource: getDataSourceMock
  }))
}));

const { createNotionDatabase } = await import('../src/handlers/background-handlers.js');

// Stand-in for the schema Notion returns after creating the database: every
// template property, each with the opaque property ID a view config needs.
const ALL_COLUMNS = [
  'Checkbox', 'Course', 'Assignment Name', 'Status', 'Due Date',
  'Link to Resources', 'Points', 'Notes', 'Description', 'Canvas ID', 'Grade'
];

function schemaFor(names) {
  return Object.fromEntries(names.map(name => [name, { id: `id-${name}` }]));
}

describe('createNotionDatabase', () => {
  beforeEach(() => {
    listViewsMock.mockReset().mockResolvedValue({ results: [{ id: 'default-view-id' }] });
    updateViewMock.mockReset().mockResolvedValue({ id: 'default-view-id' });
    getDataSourceMock.mockReset().mockResolvedValue({ properties: schemaFor(ALL_COLUMNS) });
  });

  test('returns success with the new database id and url', async () => {
    createDatabaseMock.mockResolvedValueOnce({
      id: 'new-db-id',
      url: 'https://notion.so/new-db-id',
      data_sources: [{ id: 'new-ds-id' }]
    });

    const result = await createNotionDatabase('test-token', 'parent-page-id');

    expect(result.success).toBe(true);
    expect(result.databaseId).toBe('new-db-id');
    expect(result.dataSourceId).toBe('new-ds-id');
    expect(result.url).toBe('https://notion.so/new-db-id');
    expect(createDatabaseMock).toHaveBeenCalledWith(
      'parent-page-id',
      expect.any(String),
      expect.objectContaining({
        'Assignment Name': { title: {} },
        'Checkbox': { checkbox: {} },
        'Course': expect.any(Object),
        'Due Date': expect.any(Object),
        'Status': expect.any(Object),
        'Points': expect.any(Object),
        'Link to Resources': expect.any(Object),
        'Notes': expect.any(Object),
        'Description': expect.any(Object),
        'Canvas ID': expect.any(Object),
        'Grade': expect.any(Object)
      })
    );
  });

  test('applies the default sort and column layout to the auto-created view', async () => {
    createDatabaseMock.mockResolvedValueOnce({
      id: 'new-db-id',
      url: 'https://notion.so/new-db-id',
      data_sources: [{ id: 'new-ds-id' }]
    });

    await createNotionDatabase('test-token', 'parent-page-id');

    expect(listViewsMock).toHaveBeenCalledWith('new-ds-id');
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
          { property_id: 'id-Grade', visible: false }
        ]
      }
    });
  });

  test('skips columns missing from the returned schema instead of failing', async () => {
    createDatabaseMock.mockResolvedValueOnce({
      id: 'new-db-id',
      url: 'https://notion.so/new-db-id',
      data_sources: [{ id: 'new-ds-id' }]
    });
    getDataSourceMock.mockResolvedValueOnce({
      properties: schemaFor(['Checkbox', 'Assignment Name', 'Due Date'])
    });

    const result = await createNotionDatabase('test-token', 'parent-page-id');

    expect(result.success).toBe(true);
    expect(updateViewMock.mock.calls[0][1].configuration.properties).toEqual([
      { property_id: 'id-Checkbox', visible: true },
      { property_id: 'id-Assignment Name', visible: true },
      { property_id: 'id-Due Date', visible: true }
    ]);
  });

  test('still succeeds if configuring the default view fails', async () => {
    createDatabaseMock.mockResolvedValueOnce({
      id: 'new-db-id',
      url: 'https://notion.so/new-db-id',
      data_sources: [{ id: 'new-ds-id' }]
    });
    listViewsMock.mockRejectedValueOnce(new Error('views API unavailable'));

    const result = await createNotionDatabase('test-token', 'parent-page-id');

    expect(result.success).toBe(true);
    expect(result.databaseId).toBe('new-db-id');
  });

  test('returns a page-specific message on 404 (page not shared with integration)', async () => {
    const error = new Error('Notion API error: 404 - not found');
    error.status = 404;
    createDatabaseMock.mockRejectedValueOnce(error);

    const result = await createNotionDatabase('test-token', 'missing-page');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Connections/);
  });

  test('returns a friendly error on other failures', async () => {
    const error = new Error('Notion API error: 401 - unauthorized');
    error.status = 401;
    createDatabaseMock.mockRejectedValueOnce(error);

    const result = await createNotionDatabase('bad-token', 'parent-page-id');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid Notion Token/);
  });
});
