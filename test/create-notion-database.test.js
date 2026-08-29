import { describe, test, expect, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock NotionAPI before importing background-handlers.js (ES module mock)
// ---------------------------------------------------------------------------
const createDatabaseMock = jest.fn();

await jest.unstable_mockModule('../src/api/notion-api.js', () => ({
  NotionAPI: jest.fn().mockImplementation(() => ({
    createDatabase: createDatabaseMock
  }))
}));

const { createNotionDatabase } = await import('../src/handlers/background-handlers.js');

describe('createNotionDatabase', () => {
  test('returns success with the new database id and url', async () => {
    createDatabaseMock.mockResolvedValueOnce({
      id: 'new-db-id',
      url: 'https://notion.so/new-db-id'
    });

    const result = await createNotionDatabase('test-token', 'parent-page-id');

    expect(result.success).toBe(true);
    expect(result.databaseId).toBe('new-db-id');
    expect(result.url).toBe('https://notion.so/new-db-id');
    expect(createDatabaseMock).toHaveBeenCalledWith(
      'parent-page-id',
      expect.any(String),
      expect.objectContaining({
        'Assignment Name': { title: {} },
        'Course': expect.any(Object),
        'Due Date': expect.any(Object),
        'Status': expect.any(Object),
        'Points': expect.any(Object),
        'Link to Resources': expect.any(Object),
        'Canvas ID': expect.any(Object),
        'Grade': expect.any(Object)
      })
    );
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
