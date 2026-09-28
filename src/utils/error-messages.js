// User-friendly error message mapping for Canvas and Notion API errors

const canvasErrorMap = {
  401: {
    title: 'Canvas Session Expired',
    message: 'Canvas did not accept the request because your Canvas session is no longer signed in.',
    action: 'Log back in to Canvas in this browser and refresh the page, then try again. If you configured a Canvas API token in the extension settings, it may instead be invalid or expired — clear it to use your Canvas login, or replace it with a new one.'
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

// A request the circuit breaker rejected was never sent, so it has no status to
// map. Say that the extension stopped asking, and why (see #60), rather than
// letting the raw breaker message fall through to the generic handler.
function getCircuitOpenError(error, service) {
  if (error.reason === 'authentication') {
    return {
      title: `${service} Requests Paused`,
      message: `${service} rejected several requests in a row for the same reason, ` +
        `so the extension stopped retrying every remaining assignment against it.`,
      action: service === 'Canvas'
        ? 'Log back in to Canvas in this browser (or check your Canvas API token in settings), then sync again.'
        : 'Check your Notion token, and that the database is still shared with the Canvas Sync connection, then sync again.'
    };
  }

  return {
    title: `${service} Is Not Responding`,
    message: `${service} failed several requests in a row, so the extension paused ` +
      `further requests instead of retrying once per assignment.`,
    action: 'Wait a minute and sync again. If it keeps happening, check your network connection ' +
      `and whether ${service} is having an outage.`
  };
}

function getUserFriendlyCanvasError(error) {
  if (error.circuitOpen) {
    return getCircuitOpenError(error, 'Canvas');
  }

  const status = error.status || error.statusCode || 0;
  const mapped = canvasErrorMap[status]; // eslint-disable-line security/detect-object-injection -- numeric HTTP status code

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
    action: 'Try again. If the problem persists, make sure you\'re signed in to Canvas in this browser and check your network connection.'
  };
}

function getUserFriendlyNotionError(error) {
  if (error.circuitOpen) {
    return getCircuitOpenError(error, 'Notion');
  }

  const status = error.status || error.statusCode || 0;
  const mapped = notionErrorMap[status]; // eslint-disable-line security/detect-object-injection -- numeric HTTP status code

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
