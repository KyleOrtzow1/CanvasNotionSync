import { describe, test, expect } from '@jest/globals';
import { getUserFriendlyCanvasError, getUserFriendlyNotionError } from '../src/utils/error-messages.js';

describe('getUserFriendlyCanvasError', () => {

  test('maps 401 to invalid token message', () => {
    const error = { status: 401, message: 'Unauthorized' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Invalid Canvas Token');
    expect(result.message).toContain('invalid or has expired');
    expect(result.action).toContain('Generate a new token');
  });

  test('maps 403 to access denied', () => {
    const error = { status: 403, message: 'Forbidden' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Access Denied');
  });

  test('maps 403 with rate limit message to rate limit', () => {
    const error = { status: 403, message: 'Rate limit exceeded' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Rate Limit');
    expect(result.message).toContain('rate limit');
  });

  test('maps 403 with throttle message to rate limit', () => {
    const error = { status: 403, message: 'Request throttled' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Rate Limit');
  });

  test('maps 404 to not found', () => {
    const error = { status: 404, message: 'Not Found' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Not Found');
    expect(result.action).toContain('Verify');
  });

  test('maps 500 to server error', () => {
    const error = { status: 500, message: 'Internal Server Error' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Server Error');
  });

  test('maps 503 to service unavailable', () => {
    const error = { status: 503, message: 'Service Unavailable' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Unavailable');
    expect(result.action).toContain('status page');
  });

  test('handles unknown status code with fallback', () => {
    const error = { status: 418, message: "I'm a teapot" };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Sync Error');
    expect(result.message).toBe("I'm a teapot");
  });

  test('handles error with no status', () => {
    const error = { message: 'Network error' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Canvas Sync Error');
    expect(result.message).toBe('Network error');
  });

  test('handles error with no message', () => {
    const error = { status: 999 };
    const result = getUserFriendlyCanvasError(error);
    expect(result.message).toContain('unexpected error');
  });

  test('uses statusCode as fallback for status', () => {
    const error = { statusCode: 401, message: 'Unauthorized' };
    const result = getUserFriendlyCanvasError(error);
    expect(result.title).toBe('Invalid Canvas Token');
  });
});

describe('getUserFriendlyNotionError', () => {

  test('maps 400 to invalid request', () => {
    const error = { status: 400, message: 'Bad Request' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Invalid Request');
  });

  test('maps 401 to invalid token', () => {
    const error = { status: 401, message: 'Unauthorized' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Invalid Notion Token');
    expect(result.action).toContain('notion.so/my-integrations');
  });

  test('maps 403 to permission denied', () => {
    const error = { status: 403, message: 'Forbidden' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Permission Denied');
    expect(result.action).toContain('Connections');
  });

  test('maps 404 to database not found', () => {
    const error = { status: 404, message: 'Not Found' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Database Not Found');
  });

  test('maps 409 to sync conflict', () => {
    const error = { status: 409, message: 'Conflict' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Sync Conflict');
    expect(result.action).toContain('No action needed');
  });

  test('maps 429 to rate limited', () => {
    const error = { status: 429, message: 'Rate limited' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Rate Limited');
  });

  test('maps 500 to server error', () => {
    const error = { status: 500, message: 'Internal Server Error' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Server Error');
  });

  test('maps 502 to gateway error', () => {
    const error = { status: 502, message: 'Bad Gateway' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Gateway Error');
  });

  test('maps 503 to unavailable', () => {
    const error = { status: 503, message: 'Service Unavailable' };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Unavailable');
    expect(result.action).toContain('status.notion.so');
  });

  test('handles unknown status with fallback', () => {
    const error = { status: 418, message: "I'm a teapot" };
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Sync Error');
    expect(result.message).toBe("I'm a teapot");
  });

  test('handles error with no status or message', () => {
    const error = {};
    const result = getUserFriendlyNotionError(error);
    expect(result.title).toBe('Notion Sync Error');
    expect(result.message).toContain('unexpected error');
  });
});
