// User-friendly error message mapping for Canvas and Notion API errors

const canvasErrorMap = {
  401: {
    title: 'Invalid Canvas Token',
    message: 'Your Canvas API token is invalid or has expired.',
    action: 'Generate a new token in Canvas: Settings > Approved Integrations > New Access Token. Then update it in the extension settings.'
  },
  403: {
    title: 'Access Denied',
    message: 'Canvas denied the request. This may be a rate limit or a permissions issue.',
    action: 'Wait a moment and try again. If the problem persists, check that your token has the correct permissions.'
  },
  404: {
    title: 'Not Found',
    message: 'The requested Canvas resource was not found.',
    action: 'Verify your Canvas URL is correct and that you are enrolled in the courses you expect.'
  },
  500: {
    title: 'Canvas Server Error',
    message: 'Canvas is experiencing internal server issues.',
    action: 'Wait a few minutes and try again.'
  },
  503: {
    title: 'Canvas Unavailable',
    message: 'Canvas is temporarily unavailable, possibly for maintenance.',
    action: 'Check your institution\'s Canvas status page and try again later.'
  }
};

const notionErrorMap = {
  400: {
    title: 'Invalid Request',
    message: 'The sync data could not be sent to Notion due to a formatting issue.',
    action: 'Try syncing again. If the problem persists, check that your Notion database has the expected properties.'
  },
  401: {
    title: 'Invalid Notion Token',
    message: 'Your Notion integration token is invalid or has expired.',
    action: 'Go to notion.so/my-integrations, copy your integration token, and update it in the extension settings.'
  },
  403: {
    title: 'Notion Permission Denied',
    message: 'The Notion integration does not have access to your database.',
    action: 'Open your Notion database, click "..." > "Connections", and add your integration.'
  },
  404: {
    title: 'Database Not Found',
    message: 'The Notion database could not be found.',
    action: 'Verify the database ID in extension settings. Make sure the integration is connected to the database.'
  },
  409: {
    title: 'Sync Conflict',
    message: 'A conflict occurred while updating Notion. The extension will retry automatically.',
    action: 'No action needed. If the error persists, try syncing again.'
  },
  429: {
    title: 'Rate Limited',
    message: 'Too many requests sent to Notion. The extension will retry automatically.',
    action: 'No action needed. The sync will resume shortly.'
  },
  500: {
    title: 'Notion Server Error',
    message: 'Notion is experiencing internal server issues.',
    action: 'Wait a few minutes and try again.'
  },
  502: {
    title: 'Notion Gateway Error',
    message: 'Notion\'s servers are temporarily unreachable.',
    action: 'Wait a few minutes and try again.'
  },
  503: {
    title: 'Notion Unavailable',
    message: 'Notion is temporarily unavailable.',
    action: 'Check status.notion.so and try again later.'
  }
};

function getUserFriendlyCanvasError(error) {
  const status = error.status || error.statusCode || 0;
  const mapped = canvasErrorMap[status];

  if (mapped) {
    // Special case: 403 with rate limit indication
    const msg = (error.message || '').toLowerCase();
    if (status === 403 && (msg.includes('rate') || msg.includes('throttle'))) {
      return {
        title: 'Canvas Rate Limit',
        message: 'Canvas rate limit reached. The extension will retry automatically.',
        action: 'No action needed. The sync will resume shortly.'
      };
    }
    return { ...mapped };
  }

  return {
    title: 'Canvas Sync Error',
    message: error.message || 'An unexpected error occurred while communicating with Canvas.',
    action: 'Try again. If the problem persists, check your Canvas token and network connection.'
  };
}

function getUserFriendlyNotionError(error) {
  const status = error.status || error.statusCode || 0;
  const mapped = notionErrorMap[status];

  if (mapped) {
    return { ...mapped };
  }

  return {
    title: 'Notion Sync Error',
    message: error.message || 'An unexpected error occurred while communicating with Notion.',
    action: 'Try again. If the problem persists, check your Notion token and database settings.'
  };
}

// For content-script (non-module) context
if (typeof globalThis !== 'undefined' && typeof globalThis.getUserFriendlyCanvasError === 'undefined') {
  globalThis.getUserFriendlyCanvasError = getUserFriendlyCanvasError;
  globalThis.getUserFriendlyNotionError = getUserFriendlyNotionError;
}
