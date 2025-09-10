# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension (Manifest V3) that automatically syncs Canvas LMS assignments with Notion databases. The extension extracts assignment data from Canvas pages and creates/updates corresponding entries in a user's Notion database.

## Architecture

### Core Components

- **`manifest.json`**: Extension configuration with permissions for Canvas domains (`*.instructure.com`, `*.canvaslms.com`) and Notion API
- **`background.js`**: Service worker handling Notion API calls, credential storage, rate limiting, and sync orchestration
- **`content-script.js`**: DOM extraction and Canvas API interception running on Canvas pages
- **`popup.html` + `popup.js`**: Configuration interface for tokens and manual sync controls

### Key Classes and Systems

- **`CredentialManager`** (background.js): Secure storage/retrieval of API tokens using Chrome storage
- **`NotionRateLimiter`** (background.js): Queue-based rate limiting for Notion API (3 req/sec limit)
- **`CanvasAPIExtractor`** (content-script.js): Multiple strategies for assignment extraction from Canvas DOM and API responses
- **Assignment Processing Pipeline**: DOM selectors → data extraction → deduplication → Notion API sync

## Development Commands

### Loading/Testing the Extension
```bash
# Load in Chrome
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select project directory

# Test Canvas extraction in browser console (on Canvas pages)
testCanvasExtraction()           # Extract assignments from current page
analyzeCanvasDOM()              # Debug DOM structure
runFullTest(notionToken, dbId)  # End-to-end sync test
```

### Icon Generation
```bash
# Generate extension icons from SVG
node generate-icons.js
# Or run batch file on Windows
generate-icons.bat
```

### Dependencies
```bash
npm install  # Installs canvas package for icon generation
```

## Critical Integration Points

### Notion Database Schema
The extension expects specific property names in the target Notion database:
- `Assignment Name` (Title) - **Required**
- `Course` (Rich Text)
- `Due Date` (Date)
- `Status` (Rich Text)
- `Canvas ID` (Rich Text) - **Critical for duplicate detection**
- `Points` (Number)
- `Link to Resources` (URL)
- `Type` (Rich Text)

### Canvas Detection Strategy
The extension uses multiple extraction methods in fallback order:
1. DOM selectors for assignment cards/lists
2. Intercepted Canvas API responses
3. Dashboard planner widget parsing
4. Course-specific assignment pages

### Rate Limiting and Error Handling
- Notion API: 3 requests/second with queue-based throttling
- Canvas API: Institution-dependent limits
- Automatic retry logic with exponential backoff
- User notifications for sync status and errors

## Security Considerations

- API tokens stored in Chrome's secure local storage
- No external servers involved (only Canvas/Notion APIs)
- Content script runs only on Canvas domains
- HTTPS-only network requests

## Testing Strategy

When modifying extraction logic, test against multiple Canvas page types:
- Dashboard with assignment planner
- Course assignment lists
- Individual assignment pages
- Different Canvas institution domains

For Notion integration changes, verify against rate limits and test with various database property configurations.