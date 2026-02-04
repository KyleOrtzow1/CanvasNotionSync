# Notion API Documentation

This document provides comprehensive documentation of the Notion API features relevant to the Canvas-Notion Assignment Sync extension and future feature development.

## Table of Contents

- [Getting Started](#getting-started)
- [API Versioning](#api-versioning)
- [Authentication & Authorization](#authentication--authorization)
- [Rate Limiting & Request Limits](#rate-limiting--request-limits)
- [Pagination](#pagination)
- [Core Concepts](#core-concepts)
  - [Databases vs Data Sources](#databases-vs-data-sources)
  - [Pages](#pages)
  - [Blocks](#blocks)
  - [Properties](#properties)
  - [Rich Text](#rich-text)
- [Core APIs](#core-apis)
  - [Data Sources API](#data-sources-api)
  - [Pages API](#pages-api)
  - [Blocks API](#blocks-api)
  - [Users API](#users-api)
  - [Comments API](#comments-api)
  - [Search API](#search-api)
- [Property Types Reference](#property-types-reference)
- [Filtering & Sorting](#filtering--sorting)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)
- [Future Feature Ideas](#future-feature-ideas)

---

## Getting Started

### Base URL
```
https://api.notion.com/v1/
```

### Current API Version
**2025-09-03** (Latest stable version)

This version introduces multi-source databases - a major architectural change.

### Official Documentation
- **Main Developer Portal**: https://developers.notion.com
- **API Reference**: https://developers.notion.com/reference/intro
- **Changelog**: https://developers.notion.com/page/changelog
- **Getting Started Guide**: https://developers.notion.com/guides/get-started/getting-started

---

## API Versioning

### Version Header
Every request must include the `Notion-Version` header:

```javascript
headers: {
  'Notion-Version': '2025-09-03'
}
```

### Versioning Philosophy
- Notion only versions backwards-incompatible changes
- New features are available without upgrading versions
- Different version headers can be used for different requests
- You can upgrade incrementally to the latest version

### Major Version History

#### **2025-09-03** (Current - Breaking Changes)
**Key Changes:**
- Introduction of multi-source databases
- Databases can now contain multiple data sources
- New `/v1/data_sources` API namespace
- `data_source_id` required instead of just `database_id`
- TypeScript SDK v5+ required for this version

**Breaking Changes:**
- Database query endpoints moved to data source endpoints
- Page creation requires `data_source_id`
- Relations now specify `data_source_id`

**Migration Required:** Yes - see [Migration Guide](#migration-guide)

#### **2022-06-28**
**Key Changes:**
- Page properties must be retrieved via page properties endpoint
- Parents are always direct parents
- Added `parent` field to blocks

#### **2022-02-22**
**Key Changes:**
- Renamed `text` to `rich_text` in blocks
- Deprecated List Databases API endpoint

**Documentation:** https://developers.notion.com/docs/upgrade-guide-2025-09-03

---

## Authentication & Authorization

### Integration Types

Notion supports two types of integrations:
1. **Internal Integrations** - Used within your own workspace
2. **Public Integrations** - OAuth-based, distributed to other users

### Integration Token (Internal)

For internal integrations (like this extension), use an integration token.

**Creating an Integration:**
1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Give it a name and select your workspace
4. Copy the "Internal Integration Token"

**Token Format:**
```
secret_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Authentication Header:**
```javascript
headers: {
  'Authorization': 'Bearer secret_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json'
}
```

### Security Best Practices
- **Never store tokens in source code**
- **Use environment variables or encrypted storage** (extension uses AES-GCM encryption)
- **Never commit tokens to version control**
- **Tokens are workspace-specific** - different workspaces need different tokens
- **Rotate tokens periodically** for security

### Permissions & Sharing

**CRITICAL:** Integrations can only access resources that have been explicitly shared with them.

**To share a database:**
1. Open the database in Notion
2. Click "..." menu → "Connections"
3. Select your integration

**Permission Scopes:**
- Read content
- Update content
- Insert content
- Read comments
- Insert comments
- Read user information without email addresses
- Read user information with email addresses

### OAuth (Public Integrations)

For public integrations distributed to other users:
- Use OAuth 2.0 authorization flow
- Request specific scopes
- Handle authorization callbacks
- Store access tokens per user

**Documentation:** https://developers.notion.com/docs/authorization

---

## Rate Limiting & Request Limits

### Rate Limits

Notion enforces rate limiting to ensure service stability.

**Rate Limit:**
- **Average:** 3 requests per second
- **Bursts allowed:** Temporary bursts beyond 3 req/sec are permitted
- **Calculated per:** Integration token (not per workspace or user)

**Rate Limit Response:**
```json
{
  "object": "error",
  "status": 429,
  "code": "rate_limited",
  "message": "Rate limited"
}
```

**Headers:**
```
Retry-After: 5  // Wait this many seconds before retrying
```

**Handling Rate Limits:**
```javascript
try {
  const response = await notion.request(...)
} catch (error) {
  if (error.code === 'rate_limited') {
    const retryAfter = error.headers['retry-after']
    await wait(retryAfter * 1000)
    // Retry request
  }
}
```

### Request Size Limits

**Payload Limits:**
- Maximum payload size: **500 KB**
- Maximum block elements: **1,000 blocks**
- Maximum blocks when creating pages: **100 blocks** per array

**Rich Text Limits:**
- Maximum characters per rich text object: **2,000 characters**
- If content exceeds 2,000 characters, split into multiple rich text objects

**Schema Size:**
- Recommended maximum database schema size: **50 KB**
- Updates to oversized schemas will be blocked

### Future Rate Limit Changes

Notion may:
- Adjust rate limits based on demand and reliability
- Introduce different rate limits for different pricing plans
- Provide higher limits for paid plans

**Documentation:** https://developers.notion.com/reference/request-limits

---

## Pagination

### How Pagination Works

Notion uses **cursor-based pagination** for endpoints that return lists.

**Default Behavior:**
- Returns 10 items by default
- Maximum: 100 items per request

### Pagination Response

```json
{
  "object": "list",
  "results": [...],
  "next_cursor": "fe2cc560-036c-44cd-90e8-294d3a74dddd",
  "has_more": true,
  "type": "page_or_database",
  "page_or_database": {}
}
```

**Fields:**
- `results` - Array of objects returned
- `has_more` - Boolean indicating if more results exist
- `next_cursor` - Cursor string for next page (null if no more results)

### Requesting Pages

**GET Requests (Query Parameters):**
```javascript
GET /v1/users?page_size=50&start_cursor=fe2cc560-036c-44cd-90e8-294d3a74dddd
```

**POST Requests (Body Parameters):**
```javascript
POST /v1/data_sources/{data_source_id}/query

Body:
{
  "page_size": 100,
  "start_cursor": "fe2cc560-036c-44cd-90e8-294d3a74dddd",
  "filter": {...}
}
```

### Best Practices

1. **Always check `has_more`** before requesting next page
2. **Use `next_cursor`** exactly as returned (treat as opaque)
3. **Request reasonable page sizes** (50-100 items)
4. **Handle empty result sets** gracefully
5. **Implement retry logic** for pagination errors

### Example Implementation

```javascript
async function getAllPages(dataSourceId) {
  let allResults = []
  let hasMore = true
  let startCursor = undefined

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: dataSourceId,
      start_cursor: startCursor,
      page_size: 100
    })

    allResults = allResults.concat(response.results)
    hasMore = response.has_more
    startCursor = response.next_cursor
  }

  return allResults
}
```

**Documentation:** https://developers.notion.com/docs/working-with-page-content

---

## Core Concepts

### Databases vs Data Sources

This is the most important change in API version 2025-09-03.

#### Traditional Model (Pre-2025-09-03)
- A **database** was a table of pages/records
- You queried databases directly using `database_id`

#### New Model (2025-09-03+)
- A **database** is now a container that can hold multiple **data sources**
- A **data source** is the actual table of pages/records
- You query data sources using `data_source_id`

**Analogy:**
```
Database = Spreadsheet File
Data Source = Individual Sheets/Tabs in that file
```

#### Why This Matters

**Before (Legacy):**
```javascript
POST /v1/databases/{database_id}/query
```

**After (Current):**
```javascript
POST /v1/data_sources/{data_source_id}/query
```

**For Simple Databases:**
If a database only contains one data source (most common case), you'll need to:
1. Get the `database_id` from the URL
2. Query the database to find its `data_source_id`
3. Use that `data_source_id` for all operations

**Documentation:**
- https://developers.notion.com/docs/upgrade-guide-2025-09-03
- https://thomasjfrank.com/notion-databases-can-now-have-multiple-data-sources/

### Pages

**Pages are the fundamental unit of content in Notion.**

Every database row is a page. Every document is a page. Pages can contain:
- Properties (metadata like title, date, status)
- Content blocks (paragraphs, headings, images, etc.)
- Child pages

**Page Object:**
```json
{
  "object": "page",
  "id": "59833787-2cf9-4fdf-8782-e53db20768a5",
  "created_time": "2022-03-01T19:05:00.000Z",
  "last_edited_time": "2022-07-06T19:41:00.000Z",
  "created_by": { "object": "user", "id": "..." },
  "last_edited_by": { "object": "user", "id": "..." },
  "cover": { "type": "external", "external": { "url": "..." } },
  "icon": { "type": "emoji", "emoji": "🥬" },
  "parent": {
    "type": "database_id",
    "database_id": "..."
  },
  "archived": false,
  "properties": {
    "Name": {
      "id": "title",
      "type": "title",
      "title": [
        {
          "type": "text",
          "text": { "content": "My Page", "link": null }
        }
      ]
    }
  },
  "url": "https://www.notion.so/My-Page-..."
}
```

### Blocks

**Blocks are the building blocks of page content.**

Everything in a Notion page is a block:
- Paragraphs
- Headings
- Lists
- Tables
- Images
- Code blocks
- Embeds

**Block Object:**
```json
{
  "object": "block",
  "id": "c02fc1d3-db8b-45c5-a222-27595b15aea7",
  "parent": { "type": "page_id", "page_id": "..." },
  "created_time": "2022-03-01T19:05:00.000Z",
  "last_edited_time": "2022-03-01T19:05:00.000Z",
  "created_by": { "object": "user", "id": "..." },
  "last_edited_by": { "object": "user", "id": "..." },
  "has_children": false,
  "archived": false,
  "type": "paragraph",
  "paragraph": {
    "rich_text": [
      {
        "type": "text",
        "text": { "content": "This is a paragraph.", "link": null },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        }
      }
    ],
    "color": "default"
  }
}
```

**Block Types:**
- `paragraph`, `heading_1`, `heading_2`, `heading_3`
- `bulleted_list_item`, `numbered_list_item`, `to_do`
- `toggle`, `code`, `quote`, `callout`
- `table`, `table_row`
- `image`, `video`, `file`, `pdf`
- `bookmark`, `embed`, `link_preview`
- `equation`, `divider`, `breadcrumb`
- `table_of_contents`, `column_list`, `column`
- `child_page`, `child_database`

### Properties

**Properties are the columns in a database (data source).**

Each page in a database has values for each property.

**Property Schema (Column Definition):**
```json
{
  "Name": {
    "id": "title",
    "name": "Name",
    "type": "title",
    "title": {}
  },
  "Due Date": {
    "id": "due_date",
    "name": "Due Date",
    "type": "date",
    "date": {}
  },
  "Status": {
    "id": "status",
    "name": "Status",
    "type": "select",
    "select": {
      "options": [
        { "name": "Not started", "color": "red" },
        { "name": "In progress", "color": "yellow" },
        { "name": "Done", "color": "green" }
      ]
    }
  }
}
```

**Property Values (Row Data):**
```json
{
  "Name": {
    "id": "title",
    "type": "title",
    "title": [
      { "type": "text", "text": { "content": "Assignment 1" } }
    ]
  },
  "Due Date": {
    "id": "due_date",
    "type": "date",
    "date": {
      "start": "2026-02-15",
      "end": null,
      "time_zone": null
    }
  },
  "Status": {
    "id": "status",
    "type": "select",
    "select": {
      "name": "In progress",
      "color": "yellow"
    }
  }
}
```

See [Property Types Reference](#property-types-reference) for all property types.

### Rich Text

**Rich text is Notion's way of representing formatted text.**

Used in:
- Block content (paragraphs, headings, etc.)
- Property values (title, rich_text properties)

**Rich Text Object:**
```json
{
  "type": "text",
  "text": {
    "content": "This is bold and italic text",
    "link": null
  },
  "annotations": {
    "bold": true,
    "italic": true,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "This is bold and italic text",
  "href": null
}
```

**Rich Text Types:**
- `text` - Regular text with optional link
- `mention` - Mention of user, page, database, or date
- `equation` - LaTeX equation

**Character Limit:** 2,000 characters per rich text object

**Colors:**
- `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`
- Background variants: `gray_background`, `brown_background`, etc.

**Documentation:** https://developers.notion.com/reference/rich-text

---

## Core APIs

### Data Sources API

**IMPORTANT:** In API version 2025-09-03, you query data sources, not databases directly.

#### Get Database (to find Data Sources)

```javascript
GET /v1/databases/{database_id}
```

**Response includes:**
```json
{
  "object": "database",
  "id": "...",
  "data_sources": [
    {
      "type": "database",
      "id": "data_source_id_here"
    }
  ],
  "title": [...],
  "properties": {...}
}
```

#### Query a Data Source

```javascript
POST /v1/data_sources/{data_source_id}/query

Headers:
  Authorization: Bearer {token}
  Notion-Version: 2025-09-03
  Content-Type: application/json

Body:
{
  "filter": {
    "property": "Status",
    "select": {
      "equals": "In progress"
    }
  },
  "sorts": [
    {
      "property": "Due Date",
      "direction": "ascending"
    }
  ],
  "page_size": 100
}
```

**Response:**
```json
{
  "object": "list",
  "results": [
    { "object": "page", ... },
    { "object": "page", ... }
  ],
  "next_cursor": "...",
  "has_more": false
}
```

#### Create Data Source

```javascript
POST /v1/data_sources

Body:
{
  "parent": {
    "type": "page_id",
    "page_id": "..."
  },
  "title": [
    {
      "type": "text",
      "text": { "content": "My Data Source" }
    }
  ],
  "properties": {
    "Name": { "title": {} },
    "Status": {
      "select": {
        "options": [
          { "name": "Not started", "color": "red" }
        ]
      }
    }
  }
}
```

#### Update Data Source Properties

```javascript
PATCH /v1/data_sources/{data_source_id}

Body:
{
  "properties": {
    "New Property": {
      "rich_text": {}
    }
  }
}
```

**Documentation:** https://developers.notion.com/docs/working-with-databases

---

### Pages API

#### Create a Page

**In a database (data source):**
```javascript
POST /v1/pages

Body:
{
  "parent": {
    "type": "database_id",
    "database_id": "{data_source_id}"  // Use data_source_id in 2025-09-03
  },
  "properties": {
    "Name": {
      "title": [
        {
          "text": { "content": "Assignment 1" }
        }
      ]
    },
    "Due Date": {
      "date": {
        "start": "2026-02-15T23:59:00.000Z"
      }
    },
    "Points": {
      "number": 100
    }
  },
  "children": [  // Optional: Add content blocks
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [
          {
            "type": "text",
            "text": { "content": "Assignment description here." }
          }
        ]
      }
    }
  ]
}
```

**As a child page:**
```javascript
POST /v1/pages

Body:
{
  "parent": {
    "type": "page_id",
    "page_id": "..."
  },
  "properties": {
    "title": {
      "title": [
        { "text": { "content": "Child Page Title" } }
      ]
    }
  }
}
```

#### Retrieve a Page

```javascript
GET /v1/pages/{page_id}
```

**Include Options:**
- Default: Returns page object with properties
- Does NOT include page content (blocks)
- Use Blocks API to retrieve content

#### Update Page Properties

```javascript
PATCH /v1/pages/{page_id}

Body:
{
  "properties": {
    "Status": {
      "select": {
        "name": "Done"
      }
    },
    "Points": {
      "number": 95
    }
  }
}
```

#### Archive/Delete a Page

```javascript
PATCH /v1/pages/{page_id}

Body:
{
  "archived": true
}
```

**Note:** Archiving is reversible. There's no permanent delete via API.

#### Retrieve Page Property Item

For retrieving property values separately (useful for large properties):

```javascript
GET /v1/pages/{page_id}/properties/{property_id}
```

**Documentation:** https://developers.notion.com/reference/post-page

---

### Blocks API

#### Retrieve Block Children

```javascript
GET /v1/blocks/{block_id}/children?page_size=100
```

**Response:**
```json
{
  "object": "list",
  "results": [
    {
      "object": "block",
      "id": "...",
      "type": "paragraph",
      "paragraph": { ... }
    }
  ],
  "next_cursor": "...",
  "has_more": false
}
```

**Note:** Blocks are retrieved in the order they appear on the page.

#### Retrieve a Block

```javascript
GET /v1/blocks/{block_id}
```

Returns a single block object.

#### Append Block Children

```javascript
PATCH /v1/blocks/{block_id}/children

Body:
{
  "children": [
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [
          { "type": "text", "text": { "content": "New Section" } }
        ]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [
          { "type": "text", "text": { "content": "Paragraph text." } }
        ]
      }
    }
  ]
}
```

**Limit:** Maximum 100 blocks per request.

#### Update a Block

```javascript
PATCH /v1/blocks/{block_id}

Body:
{
  "paragraph": {
    "rich_text": [
      { "type": "text", "text": { "content": "Updated text." } }
    ]
  }
}
```

#### Delete a Block

```javascript
DELETE /v1/blocks/{block_id}
```

**Note:** This archives the block (sets `archived: true`).

**Documentation:** https://developers.notion.com/docs/working-with-page-content

---

### Users API

#### List All Users

```javascript
GET /v1/users?page_size=100
```

Returns all users in the workspace.

#### Retrieve a User

```javascript
GET /v1/users/{user_id}
```

#### Retrieve Bot User

```javascript
GET /v1/users/me
```

Returns the bot user associated with the integration.

**User Object:**
```json
{
  "object": "user",
  "id": "...",
  "type": "person",  // or "bot"
  "name": "Jane Doe",
  "avatar_url": "...",
  "person": {
    "email": "jane@example.com"  // Only if integration has email permission
  }
}
```

**User Types:**
- `person` - Real human user
- `bot` - Bot/integration user

**Documentation:** https://developers.notion.com/reference/get-user

---

### Comments API

#### Create a Comment

**On a page:**
```javascript
POST /v1/comments

Body:
{
  "parent": {
    "page_id": "..."
  },
  "rich_text": [
    {
      "type": "text",
      "text": { "content": "This is a comment." }
    }
  ]
}
```

**On a discussion thread:**
```javascript
POST /v1/comments

Body:
{
  "discussion_id": "...",
  "rich_text": [
    {
      "type": "text",
      "text": { "content": "Reply to discussion." }
    }
  ]
}
```

#### Retrieve Comments

```javascript
GET /v1/comments?block_id={block_id}&page_size=100
```

Or by discussion:
```javascript
GET /v1/comments?discussion_id={discussion_id}
```

**Comment Object:**
```json
{
  "object": "comment",
  "id": "...",
  "parent": { "page_id": "..." },
  "discussion_id": "...",
  "created_time": "...",
  "last_edited_time": "...",
  "created_by": { "object": "user", "id": "..." },
  "rich_text": [
    { "type": "text", "text": { "content": "Comment text." } }
  ]
}
```

**Limitations:**
- Cannot update or delete comments via API
- Cannot retrieve comments on blocks within pages (only page-level comments)

**Documentation:** https://developers.notion.com/changelog/comments-api

---

### Search API

Search across pages and databases in the workspace.

```javascript
POST /v1/search

Body:
{
  "query": "assignment",
  "filter": {
    "value": "page",  // or "database"
    "property": "object"
  },
  "sort": {
    "direction": "descending",
    "timestamp": "last_edited_time"
  },
  "page_size": 100
}
```

**Response:**
```json
{
  "object": "list",
  "results": [
    {
      "object": "page",
      "id": "...",
      ...
    }
  ],
  "next_cursor": "...",
  "has_more": false
}
```

**Limitations:**
- Only searches titles of pages and databases
- Does not search page content or comments
- Only returns results the integration has access to
- Maximum 100 results per request

**Sort Options:**
- `last_edited_time` - When page was last edited
- `created_time` - When page was created

**Documentation:** https://developers.notion.com/reference/post-search

---

## Property Types Reference

### Overview

Notion supports 20+ property types for database columns.

| Property Type | Description | Use Case |
|--------------|-------------|----------|
| title | Single-line title text (required in every database) | Assignment name, page title |
| rich_text | Multi-line formatted text | Descriptions, notes |
| number | Numeric value | Points, scores, grades |
| select | Single choice from predefined options | Status, priority |
| multi_select | Multiple choices from predefined options | Tags, categories |
| date | Date or date range with optional time | Due dates, start/end dates |
| people | User references | Assigned to, created by |
| files | File uploads or external URLs | Attachments, images |
| checkbox | Boolean true/false | Completed, published |
| url | Web URL | Link to Canvas, external resources |
| email | Email address | Contact info |
| phone_number | Phone number | Contact info |
| formula | Computed value based on other properties | Grade calculations, days remaining |
| relation | Link to pages in another database | Related assignments, prerequisites |
| rollup | Aggregate values from related pages | Total points, average score |
| created_time | Timestamp when page was created (auto) | Tracking creation |
| created_by | User who created page (auto) | Tracking authorship |
| last_edited_time | Timestamp when page was last edited (auto) | Tracking updates |
| last_edited_by | User who last edited page (auto) | Tracking changes |
| status | Workflow status with groups | Not started, In progress, Done |
| unique_id | Auto-incrementing unique identifier | ID numbers |

### Detailed Property Types

#### Title
**Required in every database.** Only one title property per database.

```json
{
  "Name": {
    "id": "title",
    "type": "title",
    "title": [
      {
        "type": "text",
        "text": { "content": "Assignment 1: Variables" },
        "plain_text": "Assignment 1: Variables"
      }
    ]
  }
}
```

#### Rich Text
Multi-line text with formatting.

```json
{
  "Description": {
    "id": "desc",
    "type": "rich_text",
    "rich_text": [
      {
        "type": "text",
        "text": { "content": "Complete the exercises on variables." },
        "annotations": { "bold": false, "italic": false }
      }
    ]
  }
}
```

#### Number
Numeric values with optional formatting.

```json
{
  "Points": {
    "id": "points",
    "type": "number",
    "number": 100
  }
}
```

**Format Options:** number, number_with_commas, percent, dollar, canadian_dollar, euro, pound, yen, ruble, rupee, won, yuan, real, lira, rupiah, franc, hong_kong_dollar, new_zealand_dollar, krona, norwegian_krone, mexican_peso, rand, new_taiwan_dollar, danish_krone, zloty, baht, forint, koruna, shekel, chilean_peso, philippine_peso, dirham, colombian_peso, riyal, ringgit, leu, argentine_peso, uruguayan_peso

#### Select
Single choice from dropdown.

```json
{
  "Status": {
    "id": "status",
    "type": "select",
    "select": {
      "id": "...",
      "name": "In Progress",
      "color": "yellow"
    }
  }
}
```

**Colors:** default, gray, brown, orange, yellow, green, blue, purple, pink, red

**Creating options:**
```json
{
  "select": {
    "options": [
      { "name": "Not Started", "color": "red" },
      { "name": "In Progress", "color": "yellow" },
      { "name": "Done", "color": "green" }
    ]
  }
}
```

#### Multi-Select
Multiple choices from dropdown.

```json
{
  "Tags": {
    "id": "tags",
    "type": "multi_select",
    "multi_select": [
      { "id": "...", "name": "Homework", "color": "blue" },
      { "id": "...", "name": "Graded", "color": "green" }
    ]
  }
}
```

#### Date
Date or date range with optional time.

```json
{
  "Due Date": {
    "id": "due",
    "type": "date",
    "date": {
      "start": "2026-02-15T23:59:00.000Z",
      "end": null,
      "time_zone": "America/Los_Angeles"
    }
  }
}
```

**Date Range:**
```json
{
  "date": {
    "start": "2026-02-01",
    "end": "2026-02-15",
    "time_zone": null
  }
}
```

**Date Formats:**
- Date only: `"2026-02-15"`
- Date with time: `"2026-02-15T23:59:00.000Z"` (ISO 8601)
- `time_zone` is optional and uses IANA timezone names

#### People
References to Notion users.

```json
{
  "Assigned To": {
    "id": "assigned",
    "type": "people",
    "people": [
      {
        "object": "user",
        "id": "...",
        "name": "Jane Doe",
        "avatar_url": "..."
      }
    ]
  }
}
```

#### Files
File uploads or external file links.

```json
{
  "Attachments": {
    "id": "files",
    "type": "files",
    "files": [
      {
        "name": "assignment.pdf",
        "type": "external",
        "external": {
          "url": "https://example.com/file.pdf"
        }
      }
    ]
  }
}
```

**File Types:**
- `external` - External URL
- `file` - Uploaded file (not directly settable via API)

#### Checkbox
Boolean value.

```json
{
  "Completed": {
    "id": "done",
    "type": "checkbox",
    "checkbox": true
  }
}
```

#### URL
Web URL.

```json
{
  "Canvas Link": {
    "id": "url",
    "type": "url",
    "url": "https://canvas.example.com/courses/123/assignments/456"
  }
}
```

#### Email
Email address.

```json
{
  "Contact": {
    "id": "email",
    "type": "email",
    "email": "student@university.edu"
  }
}
```

#### Phone Number
Phone number string.

```json
{
  "Phone": {
    "id": "phone",
    "type": "phone_number",
    "phone_number": "+1-555-0100"
  }
}
```

#### Formula
Computed value based on other properties.

```json
{
  "Days Until Due": {
    "id": "formula",
    "type": "formula",
    "formula": {
      "type": "number",
      "number": 5
    }
  }
}
```

**Formula Types:**
- `string` - Text result
- `number` - Numeric result
- `boolean` - True/false result
- `date` - Date result

**Note:** Formula definitions cannot be set via API, only read.

#### Relation
Link to pages in another database.

```json
{
  "Prerequisites": {
    "id": "relation",
    "type": "relation",
    "relation": [
      { "id": "page_id_1" },
      { "id": "page_id_2" }
    ]
  }
}
```

**In 2025-09-03:** Relations now specify `data_source_id` instead of `database_id`.

#### Rollup
Aggregate values from related pages.

```json
{
  "Total Points": {
    "id": "rollup",
    "type": "rollup",
    "rollup": {
      "type": "number",
      "number": 250,
      "function": "sum"
    }
  }
}
```

**Rollup Functions:** count, count_values, empty, not_empty, unique, show_unique, percent_empty, percent_not_empty, sum, average, median, min, max, range, earliest_date, latest_date, date_range, checked, unchecked, percent_checked, percent_unchecked, count_per_group, percent_per_group, show_original

#### Created Time
Automatically set when page is created.

```json
{
  "Created": {
    "id": "created",
    "type": "created_time",
    "created_time": "2026-02-01T10:00:00.000Z"
  }
}
```

**Read-only:** Cannot be set or modified via API.

#### Created By
User who created the page.

```json
{
  "Creator": {
    "id": "created_by",
    "type": "created_by",
    "created_by": {
      "object": "user",
      "id": "..."
    }
  }
}
```

**Read-only:** Cannot be set or modified via API.

#### Last Edited Time
Automatically updated when page is modified.

```json
{
  "Last Edited": {
    "id": "edited",
    "type": "last_edited_time",
    "last_edited_time": "2026-02-01T15:30:00.000Z"
  }
}
```

**Read-only:** Cannot be set or modified via API.

#### Last Edited By
User who last modified the page.

```json
{
  "Last Editor": {
    "id": "editor",
    "type": "last_edited_by",
    "last_edited_by": {
      "object": "user",
      "id": "..."
    }
  }
}
```

**Read-only:** Cannot be set or modified via API.

#### Status
Workflow status with groups (similar to select but with grouping).

```json
{
  "Status": {
    "id": "status",
    "type": "status",
    "status": {
      "id": "...",
      "name": "In Progress",
      "color": "yellow"
    }
  }
}
```

#### Unique ID
Auto-incrementing unique identifier.

```json
{
  "ID": {
    "id": "unique_id",
    "type": "unique_id",
    "unique_id": {
      "number": 42,
      "prefix": "TASK-"
    }
  }
}
```

**Format:** Displays as "TASK-42" in Notion UI.

**Read-only:** Auto-generated, cannot be set via API.

**Documentation:** https://developers.notion.com/reference/property-object

---

## Filtering & Sorting

### Filtering

Filters allow you to query specific pages from a database based on property values.

#### Simple Filter

```json
{
  "filter": {
    "property": "Status",
    "select": {
      "equals": "In Progress"
    }
  }
}
```

#### Compound Filters (AND)

```json
{
  "filter": {
    "and": [
      {
        "property": "Status",
        "select": {
          "equals": "Not Started"
        }
      },
      {
        "property": "Due Date",
        "date": {
          "on_or_before": "2026-02-15"
        }
      }
    ]
  }
}
```

#### Compound Filters (OR)

```json
{
  "filter": {
    "or": [
      {
        "property": "Status",
        "select": {
          "equals": "In Progress"
        }
      },
      {
        "property": "Status",
        "select": {
          "equals": "Not Started"
        }
      }
    ]
  }
}
```

#### Nested Compound Filters

```json
{
  "filter": {
    "and": [
      {
        "property": "Completed",
        "checkbox": {
          "equals": false
        }
      },
      {
        "or": [
          {
            "property": "Priority",
            "select": {
              "equals": "High"
            }
          },
          {
            "property": "Priority",
            "select": {
              "equals": "Urgent"
            }
          }
        ]
      }
    ]
  }
}
```

**Nesting Limit:** Maximum 2 levels of nesting.

### Filter Operators by Property Type

#### Text (title, rich_text, url, email, phone_number)
- `equals`
- `does_not_equal`
- `contains`
- `does_not_contain`
- `starts_with`
- `ends_with`
- `is_empty`
- `is_not_empty`

#### Number
- `equals`
- `does_not_equal`
- `greater_than`
- `less_than`
- `greater_than_or_equal_to`
- `less_than_or_equal_to`
- `is_empty`
- `is_not_empty`

#### Checkbox
- `equals` (true/false)
- `does_not_equal` (true/false)

#### Select / Status
- `equals`
- `does_not_equal`
- `is_empty`
- `is_not_empty`

#### Multi-Select
- `contains`
- `does_not_contain`
- `is_empty`
- `is_not_empty`

#### Date
- `equals`
- `before`
- `after`
- `on_or_before`
- `on_or_after`
- `is_empty`
- `is_not_empty`
- `past_week`
- `past_month`
- `past_year`
- `next_week`
- `next_month`
- `next_year`

#### People
- `contains`
- `does_not_contain`
- `is_empty`
- `is_not_empty`

#### Files
- `is_empty`
- `is_not_empty`

#### Relation
- `contains`
- `does_not_contain`
- `is_empty`
- `is_not_empty`

#### Formula
Operators depend on formula result type (string, number, boolean, date)

### Sorting

Sort results by one or more properties.

#### Single Sort

```json
{
  "sorts": [
    {
      "property": "Due Date",
      "direction": "ascending"
    }
  ]
}
```

#### Multiple Sorts

```json
{
  "sorts": [
    {
      "property": "Status",
      "direction": "ascending"
    },
    {
      "property": "Due Date",
      "direction": "ascending"
    },
    {
      "timestamp": "created_time",
      "direction": "descending"
    }
  ]
}
```

**Sort Direction:**
- `ascending` - A→Z, 0→9, oldest→newest
- `descending` - Z→A, 9→0, newest→oldest

**Special Timestamp Sorts:**
- `created_time` - Page creation time
- `last_edited_time` - Page last edit time

**Documentation:** https://developers.notion.com/reference/post-database-query-filter

---

## Error Handling

### Error Response Format

```json
{
  "object": "error",
  "status": 400,
  "code": "validation_error",
  "message": "body failed validation: body.properties.Status.select.name should be defined, instead was `undefined`."
}
```

### Common Error Codes

| Code | Status | Description | Solution |
|------|--------|-------------|----------|
| `unauthorized` | 401 | Invalid or missing authentication token | Check token, ensure Authorization header is set |
| `restricted_resource` | 403 | Integration doesn't have access to resource | Share database/page with integration |
| `object_not_found` | 404 | Page, database, or block doesn't exist | Verify ID, check if resource was deleted |
| `conflict_error` | 409 | Transaction could not be completed | Retry the request |
| `rate_limited` | 429 | Too many requests | Wait for Retry-After seconds, implement backoff |
| `internal_server_error` | 500 | Internal server error | Retry with exponential backoff |
| `service_unavailable` | 503 | Notion is temporarily unavailable | Retry with exponential backoff |
| `validation_error` | 400 | Request body validation failed | Check request structure, property types |
| `invalid_json` | 400 | Invalid JSON in request body | Validate JSON syntax |
| `invalid_request_url` | 400 | Invalid URL in request | Check endpoint URL, API version |
| `invalid_request` | 400 | Generic request error | Review request parameters |

### Error Handling Best Practices

#### 1. Retry with Exponential Backoff

```javascript
async function makeRequestWithRetry(requestFn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await requestFn()
    } catch (error) {
      if (error.code === 'rate_limited') {
        const retryAfter = parseInt(error.headers['retry-after'] || '5')
        await wait(retryAfter * 1000)
        continue
      }

      if (error.status >= 500 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 // Exponential backoff
        await wait(delay)
        continue
      }

      throw error
    }
  }
}
```

#### 2. Handle Rate Limiting

```javascript
const rateLimiter = {
  tokens: 3,
  lastRefill: Date.now(),

  async acquire() {
    const now = Date.now()
    const timePassed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(3, this.tokens + timePassed)
    this.lastRefill = now

    if (this.tokens < 1) {
      await wait((1 - this.tokens) * 1000)
      this.tokens = 0
    } else {
      this.tokens -= 1
    }
  }
}
```

#### 3. Validate Before Sending

```javascript
function validateProperties(properties) {
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === 'date' && prop.date) {
      if (!isValidISO8601(prop.date.start)) {
        throw new Error(`Invalid date format for ${name}`)
      }
    }

    if (prop.type === 'select' && prop.select) {
      if (!prop.select.name) {
        throw new Error(`Select property ${name} requires a name`)
      }
    }
  }
}
```

#### 4. Handle Permission Errors

```javascript
try {
  await notion.pages.create(...)
} catch (error) {
  if (error.code === 'restricted_resource') {
    console.error('Integration does not have access. Please share the database with the integration.')
    // Show user-friendly message
  } else if (error.code === 'object_not_found') {
    console.error('Database not found. Check if it was deleted.')
  }
}
```

#### 5. Log Errors Securely

```javascript
function logError(error) {
  // Never log full token
  const sanitizedError = {
    code: error.code,
    status: error.status,
    message: error.message,
    // Do NOT include: token, Authorization header, sensitive data
  }

  console.error('Notion API Error:', sanitizedError)
}
```

---

## Best Practices

### 1. Authentication & Security

- **Never commit tokens** to version control
- **Use environment variables** or encrypted storage
- Store tokens with AES-GCM or similar encryption
- Rotate tokens periodically
- Use separate tokens for development and production
- Audit token permissions regularly

### 2. Rate Limiting

- **Respect the 3 req/sec average** rate limit
- Implement exponential backoff for retries
- Monitor `Retry-After` headers
- Use batch operations when possible
- Cache frequently accessed data
- Queue requests during high load

### 3. Data Integrity

- **Validate data before sending** to Notion
- Check required fields (title property)
- Validate date formats (ISO 8601)
- Verify property types match schema
- Handle null/undefined values gracefully
- Use transactions when possible (page + blocks together)

### 4. Performance

- **Request only what you need:**
  - Use filters to reduce result sets
  - Paginate with appropriate page_size (50-100)
  - Don't retrieve all pages if you only need a few

- **Batch operations:**
  - Create pages with children in one request (max 100 blocks)
  - Update multiple properties in one PATCH request

- **Caching:**
  - Cache database schemas (properties don't change often)
  - Cache user information
  - Cache page IDs for deduplication

- **Parallel requests:**
  - Make independent requests in parallel
  - Respect rate limits when doing so

### 5. Error Handling

- **Always handle errors:**
  - Implement try-catch blocks
  - Provide user-friendly error messages
  - Log errors for debugging (without sensitive data)

- **Retry transient errors:**
  - Network errors
  - 500-level server errors
  - Rate limit errors (429)

- **Don't retry permanent errors:**
  - 400-level client errors (except 429)
  - Validation errors
  - Permission errors

### 6. Pagination

- Always check `has_more` before requesting next page
- Use `next_cursor` exactly as returned
- Handle empty result sets
- Set reasonable page_size (100 max)
- Implement timeout for large result sets

### 7. Property Updates

- **Only update changed properties** to reduce API calls
- Read existing property values before updating
- Use correct property types and formats
- Handle read-only properties (created_time, etc.)
- Validate property values before sending

### 8. Content Management

- **Respect character limits:**
  - Rich text: 2,000 characters per object
  - Split long content into multiple rich text objects

- **Block limits:**
  - Maximum 100 blocks per request
  - Maximum 1,000 blocks total per payload

- **Schema limits:**
  - Keep database schemas under 50 KB
  - Limit number of properties (20-30 recommended)

### 9. Version Management

- **Always specify Notion-Version header**
- Stay up-to-date with latest API version
- Test thoroughly when upgrading versions
- Read migration guides for breaking changes
- Upgrade incrementally (request by request if needed)

### 10. Monitoring & Logging

- Monitor API usage and rate limit consumption
- Log errors with context (without tokens)
- Track sync success/failure rates
- Set up alerts for repeated failures
- Monitor response times

---

## Migration Guide

### Upgrading from Legacy to 2025-09-03

The 2025-09-03 API version introduces **multi-source databases**, requiring significant changes.

#### Breaking Changes Summary

1. **Database queries moved** to `/v1/data_sources/{data_source_id}/query`
2. **Page creation requires** `data_source_id` instead of `database_id`
3. **Relations specify** `data_source_id` in schema
4. **New discovery step** required to find `data_source_id`

#### Migration Steps

##### Step 1: Update Notion-Version Header

```javascript
// Before
headers: {
  'Notion-Version': '2022-06-28'
}

// After
headers: {
  'Notion-Version': '2025-09-03'
}
```

##### Step 2: Add Data Source Discovery

```javascript
// Get database to find data source
async function getDataSourceId(databaseId) {
  const database = await notion.databases.retrieve({
    database_id: databaseId
  })

  // For databases with single data source (most common)
  if (database.data_sources && database.data_sources.length > 0) {
    return database.data_sources[0].id
  }

  // For multi-source databases, you may need to identify the correct one
  throw new Error('Could not determine data source ID')
}

// Store this for future use
const dataSourceId = await getDataSourceId(databaseId)
```

##### Step 3: Update Database Queries

```javascript
// Before (Legacy)
POST /v1/databases/{database_id}/query

// After (2025-09-03)
POST /v1/data_sources/{data_source_id}/query
```

```javascript
// Before
const results = await notion.databases.query({
  database_id: databaseId,
  filter: {...}
})

// After
const results = await notion.databases.query({
  database_id: dataSourceId,  // Actually data_source_id
  filter: {...}
})
```

##### Step 4: Update Page Creation

```javascript
// Before
await notion.pages.create({
  parent: {
    database_id: databaseId
  },
  properties: {...}
})

// After
await notion.pages.create({
  parent: {
    database_id: dataSourceId  // Use data_source_id here
  },
  properties: {...}
})
```

##### Step 5: Update Relations (If Used)

```javascript
// Before
{
  "Prerequisites": {
    "relation": {
      "database_id": "related_db_id"
    }
  }
}

// After
{
  "Prerequisites": {
    "relation": {
      "data_source_id": "related_data_source_id"
    }
  }
}
```

#### For This Extension

**Current Implementation:**
The extension currently uses the older query method. To upgrade:

1. Update `NotionAPI` class to include data source discovery:

```javascript
class NotionAPI {
  async getDataSourceId(databaseId) {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Notion-Version': '2025-09-03'
      }
    })

    const database = await response.json()

    if (database.data_sources && database.data_sources.length > 0) {
      return database.data_sources[0].id
    }

    throw new Error('No data source found in database')
  }

  async queryDatabase(dataSourceId, filter = {}) {
    return this.makeRequest(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      'POST',
      { filter }
    )
  }
}
```

2. Update credential manager to store both `database_id` and `data_source_id`

3. Update sync logic to use `data_source_id` for queries and page creation

**Backward Compatibility:**
If you want to support both old and new API versions:

```javascript
async function queryDatabase(notionAPI, databaseOrDataSourceId, filter) {
  const apiVersion = notionAPI.version

  if (apiVersion === '2025-09-03') {
    // Use data source query
    return notionAPI.queryDataSource(databaseOrDataSourceId, filter)
  } else {
    // Use legacy database query
    return notionAPI.queryDatabaseLegacy(databaseOrDataSourceId, filter)
  }
}
```

**Documentation:** https://developers.notion.com/docs/upgrade-guide-2025-09-03

---

## Future Feature Ideas

Based on Notion API capabilities, here are potential features to enhance the extension:

### High Priority

1. **Rich Content Sync**
   - Sync assignment descriptions as Notion blocks (headings, lists, formatting)
   - Preserve HTML formatting from Canvas
   - Include embedded images and links

2. **Bidirectional Sync**
   - Update Canvas when Notion properties change
   - Sync status changes back to Canvas
   - Create planner notes from Notion tasks

3. **Advanced Properties**
   - Use formula properties for grade calculations
   - Create rollup properties for course totals
   - Add relation properties for prerequisite tracking

4. **Comments Integration**
   - Sync Canvas assignment comments to Notion
   - Add instructor feedback as Notion comments
   - Notify users of new comments

5. **Multi-Database Support**
   - Sync different assignment types to different databases
   - Create separate databases per course
   - Link related databases (courses → assignments)

### Medium Priority

6. **Attachment Handling**
   - Sync Canvas files to Notion
   - Link submission files
   - Store rubrics as Notion files

7. **Status Tracking**
   - Use Status property for workflow stages
   - Track submission status (not started, in progress, submitted, graded)
   - Color-code by status

8. **People Integration**
   - Assign Notion users to assignments
   - Map Canvas users to Notion users
   - Track group assignments with People property

9. **Search & Discovery**
   - Search Notion for assignments by keywords
   - Filter view by course, due date, status
   - Create saved views for different contexts

10. **Template Support**
    - Create assignment templates in Notion
    - Auto-populate common properties
    - Standardize assignment structure

### Lower Priority

11. **Advanced Filtering**
    - Create compound filters for complex queries
    - Filter by multiple properties
    - Save filter presets

12. **Sorting Options**
    - Sort by multiple properties
    - Custom sort order
    - Save sort preferences

13. **Page Icons & Covers**
    - Set page icons based on assignment type
    - Add cover images from course
    - Use emoji indicators for status

14. **Child Pages**
    - Create child pages for assignment details
    - Store notes as child pages
    - Organize related materials

15. **Database Views**
    - Create calendar view for due dates
    - Board view for status tracking
    - Timeline view for semester planning

### Technical Improvements

16. **Error Recovery**
    - Better error messages for common issues
    - Automatic retry with exponential backoff
    - Sync conflict resolution

17. **Performance Optimization**
    - Batch page creation/updates
    - Cache database schemas
    - Parallel request processing

18. **Webhook Support**
    - Real-time updates from Notion
    - Instant sync when properties change
    - Push notifications for updates

19. **Migration Tools**
    - Upgrade to API version 2025-09-03
    - Migrate to data sources model
    - Preserve existing sync mappings

20. **Testing & Monitoring**
    - Unit tests for API integration
    - Mock Notion API for testing
    - Usage analytics and monitoring

---

## Additional Resources

### Official Documentation
- **Notion Developers**: https://developers.notion.com
- **API Reference**: https://developers.notion.com/reference/intro
- **Changelog**: https://developers.notion.com/page/changelog
- **Upgrade Guide (2025-09-03)**: https://developers.notion.com/docs/upgrade-guide-2025-09-03
- **Working with Databases**: https://developers.notion.com/docs/working-with-databases
- **Working with Page Content**: https://developers.notion.com/docs/working-with-page-content

### Community Resources
- **Notion Community**: https://www.notion.so/help/guides/community
- **Developer Forum**: Various third-party forums and Discord servers
- **GitHub**: Examples and SDKs in various languages

### SDKs & Libraries
- **Official JavaScript SDK**: https://github.com/makenotion/notion-sdk-js
- **Python SDK (Unofficial)**: https://github.com/ramnes/notion-sdk-py
- **Go SDK (Unofficial)**: Various community projects

### Guides & Tutorials
- **Thomas Frank**: https://thomasjfrank.com (Notion formulas, databases, API)
- **NotionApps**: https://www.notionapps.com/blog (Notion features, updates)
- **DEV Community**: Articles on Notion API integration

### API Testing Tools
- **Postman Collection**: https://www.postman.com/notionhq/notion-s-api-workspace
- **Notion API Explorer**: Test endpoints directly in Postman
- **Browser DevTools**: Inspect API calls in Network tab

---

## Changelog

### Version 1.0 (2026-02-01)
- Initial comprehensive documentation
- Complete API endpoint coverage
- Property types reference
- Migration guide for 2025-09-03
- Feature ideas for future development
- Best practices and guidelines

---

*This documentation is maintained as part of the Canvas-Notion Assignment Sync extension project. For questions or contributions, please refer to the project README.*
