import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Set up chrome mock before importing SyncLogger
const mockStorage = {
  _data: {},
  get: jest.fn(async (keys) => {
    if (typeof keys === 'string') return { [keys]: mockStorage._data[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, mockStorage._data[k]]));
    return { ...mockStorage._data };
  }),
  set: jest.fn(async (obj) => { Object.assign(mockStorage._data, obj); }),
  remove: jest.fn(async (key) => {
    if (typeof key === 'string') delete mockStorage._data[key];
    if (Array.isArray(key)) key.forEach(k => delete mockStorage._data[k]);
  })
};

globalThis.chrome = {
  storage: { local: mockStorage }
};

import '../src/utils/sync-logger.js';
const { SyncLogger } = globalThis;

function resetLogger() {
  SyncLogger._logs = [];
  SyncLogger._buffer = [];
  SyncLogger._initialized = false;
  mockStorage._data = {};
  jest.clearAllMocks();
}

describe('SyncLogger', () => {
  beforeEach(resetLogger);

  describe('init()', () => {
    test('loads existing logs from storage', async () => {
      const stored = [
        { id: 'a', timestamp: 1000, level: 'info', message: 'test', details: null }
      ];
      mockStorage.get.mockResolvedValueOnce({ sync_logs: stored });

      await SyncLogger.init();

      expect(SyncLogger._logs).toEqual(stored);
    });

    test('defaults to empty array when storage is empty', async () => {
      mockStorage.get.mockResolvedValueOnce({});

      await SyncLogger.init();

      expect(SyncLogger._logs).toEqual([]);
    });

    test('defaults to empty array when storage value is not an array', async () => {
      mockStorage.get.mockResolvedValueOnce({ sync_logs: 'bad data' });

      await SyncLogger.init();

      expect(SyncLogger._logs).toEqual([]);
    });

    test('handles storage errors gracefully', async () => {
      mockStorage.get.mockRejectedValueOnce(new Error('storage unavailable'));

      await SyncLogger.init();

      expect(SyncLogger._logs).toEqual([]);
    });

    test('is idempotent — second call is a no-op', async () => {
      mockStorage.get.mockResolvedValue({ sync_logs: [] });

      await SyncLogger.init();
      await SyncLogger.init();

      expect(mockStorage.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('log()', () => {
    test('buffers an entry with correct shape', () => {
      SyncLogger.log('info', 'hello');

      expect(SyncLogger._buffer).toHaveLength(1);
      const entry = SyncLogger._buffer[0];
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello');
      expect(entry.details).toBeNull();
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.timestamp).toBe('number');
    });

    test('stores details when provided', () => {
      SyncLogger.log('error', 'fail', { canvasId: '42' });
      expect(SyncLogger._buffer[0].details).toEqual({ canvasId: '42' });
    });

    test('does not write to storage immediately', () => {
      SyncLogger.log('info', 'no flush yet');
      expect(mockStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('info() / warn() / error()', () => {
    test('info() logs at info level', () => {
      SyncLogger.info('msg');
      expect(SyncLogger._buffer[0].level).toBe('info');
    });

    test('warn() logs at warning level', () => {
      SyncLogger.warn('msg');
      expect(SyncLogger._buffer[0].level).toBe('warning');
    });

    test('error() logs at error level', () => {
      SyncLogger.error('msg');
      expect(SyncLogger._buffer[0].level).toBe('error');
    });
  });

  describe('flush()', () => {
    test('moves buffer entries into _logs and persists', async () => {
      SyncLogger.info('entry 1');
      SyncLogger.info('entry 2');
      await SyncLogger.flush();

      expect(SyncLogger._logs).toHaveLength(2);
      expect(SyncLogger._buffer).toHaveLength(0);
      expect(mockStorage.set).toHaveBeenCalledWith({
        sync_logs: expect.arrayContaining([
          expect.objectContaining({ message: 'entry 1' }),
          expect.objectContaining({ message: 'entry 2' })
        ])
      });
    });

    test('is a no-op when buffer is empty', async () => {
      await SyncLogger.flush();
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    test('trims to max 100 entries (FIFO — keeps newest)', async () => {
      // Fill _logs with 95 existing entries
      SyncLogger._logs = Array.from({ length: 95 }, (_, i) => ({
        id: String(i),
        timestamp: i,
        level: 'info',
        message: `old ${i}`,
        details: null
      }));

      // Buffer 10 more
      for (let i = 0; i < 10; i++) {
        SyncLogger.info(`new ${i}`);
      }

      await SyncLogger.flush();

      expect(SyncLogger._logs).toHaveLength(100);
      // Oldest entries were dropped; newest survive
      expect(SyncLogger._logs[99].message).toBe('new 9');
    });

    test('handles storage write errors gracefully', async () => {
      mockStorage.set.mockRejectedValueOnce(new Error('quota exceeded'));
      SyncLogger.info('test');

      // Should not throw
      await expect(SyncLogger.flush()).resolves.toBeUndefined();
      // Entries still committed to _logs
      expect(SyncLogger._logs).toHaveLength(1);
    });
  });

  describe('getLogs()', () => {
    test('returns most recent entries first', async () => {
      SyncLogger._logs = [
        { id: '1', timestamp: 1000, level: 'info', message: 'first', details: null },
        { id: '2', timestamp: 2000, level: 'info', message: 'second', details: null }
      ];

      const logs = SyncLogger.getLogs(10);

      expect(logs[0].message).toBe('second');
      expect(logs[1].message).toBe('first');
    });

    test('respects the limit', () => {
      SyncLogger._logs = Array.from({ length: 50 }, (_, i) => ({
        id: String(i), timestamp: i, level: 'info', message: `msg ${i}`, details: null
      }));

      const logs = SyncLogger.getLogs(5);
      expect(logs).toHaveLength(5);
    });

    test('defaults to 20 entries', () => {
      SyncLogger._logs = Array.from({ length: 50 }, (_, i) => ({
        id: String(i), timestamp: i, level: 'info', message: `msg ${i}`, details: null
      }));

      expect(SyncLogger.getLogs()).toHaveLength(20);
    });

    test('includes buffered (unflushed) entries', () => {
      SyncLogger._logs = [
        { id: '1', timestamp: 1000, level: 'info', message: 'flushed', details: null }
      ];
      SyncLogger.info('buffered');

      const logs = SyncLogger.getLogs(10);
      expect(logs.some(e => e.message === 'buffered')).toBe(true);
    });

    test('returns empty array when no logs', () => {
      expect(SyncLogger.getLogs()).toEqual([]);
    });
  });

  describe('clear()', () => {
    test('wipes _logs and _buffer', async () => {
      SyncLogger._logs = [{ id: '1', timestamp: 1, level: 'info', message: 'x', details: null }];
      SyncLogger.info('buffered');

      await SyncLogger.clear();

      expect(SyncLogger._logs).toEqual([]);
      expect(SyncLogger._buffer).toEqual([]);
    });

    test('removes entry from storage', async () => {
      await SyncLogger.clear();
      expect(mockStorage.remove).toHaveBeenCalledWith('sync_logs');
    });

    test('handles storage errors gracefully', async () => {
      mockStorage.remove.mockRejectedValueOnce(new Error('storage error'));
      await expect(SyncLogger.clear()).resolves.toBeUndefined();
    });
  });

  describe('globalThis export', () => {
    test('SyncLogger is available on globalThis', () => {
      expect(globalThis.SyncLogger).toBeDefined();
      expect(globalThis.SyncLogger.info).toBeInstanceOf(Function);
      expect(globalThis.SyncLogger.warn).toBeInstanceOf(Function);
      expect(globalThis.SyncLogger.error).toBeInstanceOf(Function);
      expect(globalThis.SyncLogger.getLogs).toBeInstanceOf(Function);
      expect(globalThis.SyncLogger.clear).toBeInstanceOf(Function);
      expect(globalThis.SyncLogger.flush).toBeInstanceOf(Function);
    });
  });
});
