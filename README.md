# Canvas-Notion Assignment Sync

A Chrome extension that automatically synchronizes Canvas LMS assignments with Notion databases, keeping your assignment tracker up-to-date effortlessly.

## Features

- 🔄 **Automatic Sync**: Syncs assignments every 30 minutes when browsing Canvas
- 📚 **Complete Assignment Data**: Includes course, due dates, points, grades, and submission status
- 🎯 **Smart Deduplication**: Uses Canvas IDs to prevent duplicate entries
- ⚡ **Rate-Limited API Calls**: Respectful API usage with built-in rate limiting
- 🔧 **Easy Setup**: Simple configuration through extension popup
- 🔔 **Notifications**: Get notified when sync completes or fails

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the project folder
5. The extension icon will appear in your toolbar

## Setup

### 1. Prepare Your Notion Database

1. Create or open your assignments database in Notion
2. Ensure it has these columns (create if missing):
   - **Assignment Name** (Title)
   - **Course** (Text)
   - **Due Date** (Date)
   - **Status** (Text)
   - **Points** (Number)
   - **Link to Resources** (URL)
   - **Canvas ID** (Text)
   - **Grade** (Text)

### 2. Create Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Canvas Sync")
4. Copy the **Internal Integration Token**
5. Go to Access tab
6. Add your database



### 3. Get Canvas API Token

1. Go to Canvas → **Account** → **Settings**
2. Scroll to **Approved Integrations**
3. Click **+ New Access Token**
4. Enter a purpose (e.g., "Notion Sync")
5. Copy the generated token

### 4. Configure Extension

1. Click the extension icon in your toolbar
2. Enter your tokens and database ID
3. Click **Save Configuration**
4. Test connections using the **Test** buttons
5. Try **Sync Now** to verify everything works

## Usage

### Automatic Sync
- The extension automatically syncs every 30 minutes when you have Canvas tabs open
- No manual intervention required once configured

### Manual Sync
- Click the extension icon and press **Sync Now**
- Or use the **🔄 Sync to Notion** button that appears in Canvas

### Sync Status
- Green notifications: Successful sync
- Red notifications: Errors occurred
- Check the popup for last sync time

## Troubleshooting

### "Canvas API token required"
- Make sure you've entered a valid Canvas API token in the extension settings
- Verify the token works by clicking **Test Canvas API**

### "Notion connection failed"
- Check that your integration token is correct
- Ensure the database is shared with your integration
- Verify the database ID is the 32-character string from the URL

### "No Canvas tabs found"
- Make sure you have a Canvas page open (*.instructure.com)
- Try refreshing the Canvas page and sync again

### Rate Limiting
- The extension automatically handles API rate limits
- If you see delays, this is normal behavior to respect service limits

## Technical Details

- **Canvas API**: Uses Canvas REST API v1 for assignment extraction
- **Notion API**: Uses Notion API v2025-09-03 with data source queries
- **Rate Limiting**: 3 requests/second average, 5 requests/second burst
- **Storage**: Credentials encrypted and stored securely in Chrome's local storage
- **Permissions**: Only accesses Canvas sites and Notion API

## Privacy & Security

### Data Protection
- All data stays between Canvas, Notion, and your browser
- API tokens are encrypted using AES-GCM before local storage
- No telemetry or analytics collected
- Source code is available for review

### Security Considerations
⚠️ **Important Security Notes:**

- **API Token Security**: While tokens are encrypted locally, they are still powerful credentials that grant access to your Canvas and Notion data
- **Device Security**: If your device is compromised, encrypted tokens could potentially be accessed
- **Token Scope**: Canvas API tokens have broad access - consider creating tokens with minimal required permissions
- **Regular Rotation**: Periodically regenerate your API tokens for enhanced security
- **Shared Devices**: Avoid using this extension on shared or public computers

### Security Features
- **Automatic Cleanup**: Credentials are automatically cleared when the extension is uninstalled
- **Manual Data Clear**: Use the "Clear All Data" button in the extension popup to immediately remove all stored credentials
- **Legacy Migration**: Existing unencrypted credentials are automatically migrated to encrypted storage
- **Error Handling**: Failed decryption attempts are logged and handled gracefully

### Best Practices
1. Only install the extension from trusted sources
2. Keep your browser updated for the latest security patches
3. Use strong, unique passwords for your Canvas and Notion accounts
4. Enable two-factor authentication on both Canvas and Notion
5. Regularly audit the extension's permissions and data access

## Support

If you encounter issues:

1. Check the browser console for error messages
2. Verify your API tokens and database setup
3. Try the test buttons in the extension popup
4. Ensure Canvas and Notion are accessible

## Contributing

This is an open-source project. Feel free to:
- Report bugs or issues
- Suggest new features
- Submit pull requests
- Improve documentation

## License

MIT License - see LICENSE file for details