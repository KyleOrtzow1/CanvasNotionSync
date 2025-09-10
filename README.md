# Canvas-Notion Assignment Sync Chrome Extension

A Chrome extension that automatically extracts assignment data from Canvas dashboard pages and synchronizes it with your Notion database.

## Features

- 🔄 **Automatic Sync**: Monitors Canvas navigation and syncs assignments every 30 minutes
- 📋 **Manual Sync**: On-demand synchronization via popup or Canvas button
- 🔍 **Smart Extraction**: Multiple strategies for reliable assignment detection
- 🚫 **Duplicate Prevention**: Intelligent deduplication to avoid database clutter
- 📊 **Progress Tracking**: Real-time sync status and error notifications
- 🛡️ **Secure Storage**: Encrypted credential management

## Quick Setup

### 1. Install the Extension

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the project folder
5. The extension icon should appear in your Chrome toolbar

### 2. Create Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Canvas Sync")
4. Select your workspace
5. Copy the "Internal Integration Token" (starts with `secret_`)

### 3. Prepare Your Notion Database

Your Notion database should have these properties (the extension will map Canvas data to these):

**Required Properties:**
- `Assignment Name` (Title)
- `Course` (Text/Rich Text)
- `Due Date` (Date)
- `Status` (Text/Rich Text)
- `Canvas ID` (Text/Rich Text) - Critical for duplicate detection

**Optional Properties:**
- `Points` (Number)
- `Link to Resources` (URL)
- `Type` (Text/Rich Text)
- `Priority` (Select)
- `Notes` (Text/Rich Text)

### 4. Share Database with Integration

1. Open your Notion assignments database
2. Click the "Share" button (top right)
3. Click "Invite" 
4. Select your integration from the dropdown
5. Copy the database ID from the URL (the 32-character string)

### 5. Configure the Extension

1. Click the extension icon in Chrome
2. Enter your Notion Integration Token
3. Enter your Notion Database ID
4. (Optional) Add Canvas API token for more reliable data
5. Click "Save Configuration"
6. Click "Test Connection" to verify setup

## Usage

### Automatic Sync
- Navigate to any Canvas page
- The extension automatically detects assignments and syncs them
- Sync occurs every 30 minutes while browsing Canvas
- Green sync button appears in Canvas header

### Manual Sync
- Click the extension icon
- Click "Sync Now" button
- Or click the "Sync to Notion" button in Canvas

### Canvas API Token (Optional)
For more reliable data extraction:
1. Go to Canvas → Account → Settings
2. Scroll down to "Approved Integrations"
3. Click "+ New Access Token"
4. Give it a purpose name
5. Copy the token and add it to the extension configuration

## Supported Canvas Elements

The extension extracts assignments from various Canvas interfaces:

- **Dashboard Planner**: Main dashboard assignment feed
- **Assignment Lists**: Course assignment pages
- **Course Pages**: Individual course views
- **API Responses**: Intercepted Canvas API calls

### Extracted Data
- Assignment name/title
- Course name
- Due date and time
- Submission status
- Point values
- Assignment links
- Canvas assignment IDs

## Troubleshooting

### No Assignments Found
- Ensure you're on a Canvas page with visible assignments
- Try refreshing the Canvas page and sync again
- Check browser console for error messages

### Notion Connection Failed
- Verify your Notion token starts with `secret_` or `ntn_`
- Ensure database ID is exactly 32 characters (no dashes)
- Check that integration has access to the database
- Confirm database properties match expected schema

### Sync Errors
- Check Notion API rate limits (3 requests/second)
- Verify internet connection
- Look for network blocking or firewall issues

### Canvas Detection Issues
- Some Canvas institutions use custom domains
- Try the Canvas API token for more reliable data
- Check if Canvas page has loaded completely

## Development

### Project Structure
```
canvas-notion-sync/
├── manifest.json          # Extension configuration
├── background.js           # Service worker (API calls, sync logic)
├── content-script.js       # DOM extraction and Canvas integration
├── popup.html             # Extension popup interface
├── popup.js               # Popup functionality
├── icons/                 # Extension icons
└── README.md              # This file
```

### Key Components

**Background Service Worker (`background.js`)**
- Handles Notion API communication
- Manages credential storage
- Implements rate limiting
- Processes sync requests
- Shows notifications

**Content Script (`content-script.js`)**
- Extracts assignment data from Canvas DOM
- Monitors page changes
- Intercepts Canvas API calls
- Provides manual sync button
- Shows sync status notifications

**Popup Interface (`popup.html` + `popup.js`)**
- Configuration management
- Connection testing
- Manual sync controls
- Status monitoring

### Testing

1. Load extension in developer mode
2. Open Canvas dashboard
3. Check browser console for logs
4. Test sync with known assignments
5. Verify Notion database updates

### API Rate Limits

- **Notion API**: 3 requests per second
- **Canvas API**: Varies by institution
- Extension implements automatic rate limiting and retry logic

## Security

- Credentials stored in Chrome's secure storage
- No data transmitted to external servers (except Notion/Canvas APIs)
- API tokens encrypted at rest
- Network requests use HTTPS only

## Compatibility

- **Chrome**: Version 88+ (Manifest V3 support)
- **Canvas**: All modern Canvas LMS instances
- **Notion**: API version 2022-06-28

## Known Limitations

- Canvas DOM structure varies by institution
- Some Canvas customizations may affect extraction
- Rate limits may slow large sync operations
- Extension requires Canvas and Notion tabs to be loaded

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with different Canvas setups
4. Submit pull request with clear description

## License

MIT License - feel free to modify and distribute

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Test with Canvas API token if DOM extraction fails
4. Verify Notion database permissions and structure

## Version History

**v1.0.0**
- Initial release
- Multi-strategy Canvas extraction
- Notion API integration
- Automatic and manual sync
- Duplicate detection
- Rate limiting
- Error handling and notifications