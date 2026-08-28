// Accepts a Notion database ID in any of the forms a user can copy out of Notion.

// Notion database IDs are 32 hex characters. Users paste them in several shapes:
//   - bare:    26ab2d53e56180fb8081d659402f9ece
//   - dashed:  26ab2d53-e561-80fb-8081-d659402f9ece
//   - URL:     https://app.notion.com/p/26ab2d53e56180fb8081d659402f9ece?v=<view id>
//   - slug:    https://www.notion.so/workspace/My-Tasks-26ab2d53e56180fb8081d659402f9ece
// Returns the normalized 32-character ID, or '' when no ID can be found.
function normalizeNotionDatabaseId(value) {
  if (!value) return '';

  let input = String(value).trim();

  if (/^https?:\/\//i.test(input) || input.includes('/')) {
    // Drop the query string first: a Notion URL's `?v=` parameter is the *view* ID,
    // which is also 32 hex characters and must not be mistaken for the database ID.
    input = input.split(/[?#]/)[0].replace(/\/+$/, '');
    input = input.substring(input.lastIndexOf('/') + 1);
  }

  // A slug segment is "Some-Page-Title-<32 hex>", so the ID is the trailing run.
  const compact = input.replace(/-/g, '');
  const match = compact.match(/[a-f0-9]{32}$/i);

  return match ? match[0].toLowerCase() : '';
}

// For popup (non-module) context
if (typeof globalThis !== 'undefined' && typeof globalThis.normalizeNotionDatabaseId === 'undefined') {
  globalThis.normalizeNotionDatabaseId = normalizeNotionDatabaseId;
}
