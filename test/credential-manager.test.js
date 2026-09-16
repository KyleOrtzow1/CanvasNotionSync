import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// In-memory chrome.storage.local so encrypt -> store -> decrypt round trips and
// the legacy migration path can be exercised end to end.
let store = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const requested = Array.isArray(keys) ? keys : [keys];
        const result = {};
        for (const key of requested) {
          if (key in store) result[key] = store[key];
        }
        return result;
      }),
      set: jest.fn(async (items) => {
        Object.assign(store, items);
      }),
      remove: jest.fn(async (keys) => {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key];
      })
    }
  }
};

const clearData = jest.fn(async () => {});
jest.unstable_mockModule('../src/utils/analytics.js', () => ({
  analytics: { clearData }
}));

const { CredentialManager } = await import('../src/credentials/credential-manager.js');

beforeEach(() => {
  store = {};
  jest.clearAllMocks();
});

describe('generateEncryptionKey', () => {
  test('generates and persists a 256-bit AES-GCM key when none exists', async () => {
    const key = await CredentialManager.generateEncryptionKey();

    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.algorithm.length).toBe(256);
    expect(Array.isArray(store.encryptionKey)).toBe(true);
    expect(store.encryptionKey).toHaveLength(32);
  });

  test('reuses the stored key instead of generating a new one', async () => {
    await CredentialManager.generateEncryptionKey();
    const storedKey = [...store.encryptionKey];

    const reimported = await CredentialManager.generateEncryptionKey();

    expect(store.encryptionKey).toEqual(storedKey);
    // A reimported key decrypts data encrypted with the original.
    const encrypted = await CredentialManager.encryptData({ value: 'same key' }, reimported);
    const third = await CredentialManager.generateEncryptionKey();
    await expect(CredentialManager.decryptData(encrypted, third)).resolves.toEqual({ value: 'same key' });
  });

  test('the imported key is not extractable', async () => {
    await CredentialManager.generateEncryptionKey();
    const imported = await CredentialManager.generateEncryptionKey();

    expect(imported.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', imported)).rejects.toThrow();
  });
});

describe('encryptData / decryptData', () => {
  test('round trips a credential object', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const credentials = {
      canvasToken: '1234~abcdefgh',
      notionToken: 'ntn_secretvalue',
      notionDatabaseId: '0123456789abcdef0123456789abcdef'
    };

    const encrypted = await CredentialManager.encryptData(credentials, key);
    await expect(CredentialManager.decryptData(encrypted, key)).resolves.toEqual(credentials);
  });

  test('round trips values with unicode and nulls', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const data = { canvasToken: null, note: 'café — ünïcode ✓', nested: { list: [1, 2, 3] } };

    const encrypted = await CredentialManager.encryptData(data, key);
    await expect(CredentialManager.decryptData(encrypted, key)).resolves.toEqual(data);
  });

  test('returns a plain number array that survives chrome.storage serialization', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const encrypted = await CredentialManager.encryptData({ a: 1 }, key);

    expect(Array.isArray(encrypted)).toBe(true);
    expect(encrypted.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)).toBe(true);

    const roundTripped = JSON.parse(JSON.stringify(encrypted));
    await expect(CredentialManager.decryptData(roundTripped, key)).resolves.toEqual({ a: 1 });
  });

  test('uses a unique 96-bit IV per encryption', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const plaintext = { canvasToken: 'identical' };

    const first = await CredentialManager.encryptData(plaintext, key);
    const second = await CredentialManager.encryptData(plaintext, key);

    const firstIv = first.slice(0, 12);
    const secondIv = second.slice(0, 12);
    expect(firstIv).toHaveLength(12);
    expect(secondIv).toHaveLength(12);
    expect(firstIv).not.toEqual(secondIv);
    // The ciphertext body differs too, so the same value never stores identically.
    expect(first.slice(12)).not.toEqual(second.slice(12));
  });

  test('prefixes the ciphertext with the IV and a 16-byte auth tag', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const plaintextBytes = new TextEncoder().encode(JSON.stringify({ a: 'b' })).length;

    const encrypted = await CredentialManager.encryptData({ a: 'b' }, key);

    expect(encrypted).toHaveLength(12 + plaintextBytes + 16);
  });

  test('rejects tampered ciphertext instead of returning garbage', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const encrypted = await CredentialManager.encryptData({ canvasToken: 'real' }, key);

    const tampered = [...encrypted];
    tampered[tampered.length - 1] ^= 0xff;

    await expect(CredentialManager.decryptData(tampered, key)).rejects.toThrow();
  });

  test('rejects a tampered IV', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const encrypted = await CredentialManager.encryptData({ canvasToken: 'real' }, key);

    const tampered = [...encrypted];
    tampered[0] ^= 0xff;

    await expect(CredentialManager.decryptData(tampered, key)).rejects.toThrow();
  });

  test('rejects truncated ciphertext', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const encrypted = await CredentialManager.encryptData({ canvasToken: 'real' }, key);

    await expect(CredentialManager.decryptData(encrypted.slice(0, 20), key)).rejects.toThrow();
  });

  test('rejects data encrypted under a different key', async () => {
    const key = await CredentialManager.generateEncryptionKey();
    const encrypted = await CredentialManager.encryptData({ canvasToken: 'real' }, key);

    store = {};
    const otherKey = await CredentialManager.generateEncryptionKey();

    await expect(CredentialManager.decryptData(encrypted, otherKey)).rejects.toThrow();
  });
});

describe('storeCredentials', () => {
  test('stores encrypted credentials and a version marker', async () => {
    const result = await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');

    expect(result).toEqual({ success: true });
    expect(store.credentialsVersion).toBe('1.0');
    expect(Array.isArray(store.encryptedCredentials)).toBe(true);
  });

  test('does not persist credentials in plaintext', async () => {
    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');

    const serialized = JSON.stringify(store);
    expect(serialized).not.toContain('1234~canvas');
    expect(serialized).not.toContain('ntn_notion');
    expect(serialized).not.toContain('db-id');
  });

  test('leaves lastSync untouched', async () => {
    store.lastSync = '2026-01-01T00:00:00.000Z';

    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');

    expect(store.lastSync).toBe('2026-01-01T00:00:00.000Z');
  });

  test('normalizes missing values to null', async () => {
    await CredentialManager.storeCredentials(undefined, '', 'db-id');

    const credentials = await CredentialManager.getCredentials();
    expect(credentials.canvasToken).toBeNull();
    expect(credentials.notionToken).toBeNull();
    expect(credentials.notionDatabaseId).toBe('db-id');
  });

  test('stores an all-null record when called with no credentials', async () => {
    const result = await CredentialManager.storeCredentials();

    expect(result).toEqual({ success: true });
    await expect(CredentialManager.getCredentials()).resolves.toEqual({
      canvasToken: null,
      notionToken: null,
      notionDatabaseId: null,
      lastSync: undefined
    });
  });

  test('reports failure instead of throwing when storage rejects', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));

    const result = await CredentialManager.storeCredentials('a', 'b', 'c');

    expect(result).toEqual({ success: false, error: 'QUOTA_BYTES exceeded' });
  });
});

describe('getCredentials', () => {
  test('decrypts credentials stored by storeCredentials', async () => {
    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');

    await expect(CredentialManager.getCredentials()).resolves.toEqual({
      canvasToken: '1234~canvas',
      notionToken: 'ntn_notion',
      notionDatabaseId: 'db-id',
      lastSync: undefined
    });
  });

  test('includes lastSync from storage', async () => {
    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');
    store.lastSync = '2026-02-03T04:05:06.000Z';

    const credentials = await CredentialManager.getCredentials();

    expect(credentials.lastSync).toBe('2026-02-03T04:05:06.000Z');
  });

  test('returns an empty object when nothing is stored', async () => {
    await expect(CredentialManager.getCredentials()).resolves.toEqual({});
  });

  test('migrates legacy unencrypted credentials and removes the plaintext keys', async () => {
    store = {
      canvasToken: 'legacy~canvas',
      notionToken: 'legacy-notion',
      notionDatabaseId: 'legacy-db',
      lastSync: '2026-02-03T04:05:06.000Z'
    };

    const migrated = await CredentialManager.getCredentials();

    expect(migrated).toEqual({
      canvasToken: 'legacy~canvas',
      notionToken: 'legacy-notion',
      notionDatabaseId: 'legacy-db',
      lastSync: '2026-02-03T04:05:06.000Z'
    });
    expect(store.canvasToken).toBeUndefined();
    expect(store.notionToken).toBeUndefined();
    expect(store.notionDatabaseId).toBeUndefined();
    expect(Array.isArray(store.encryptedCredentials)).toBe(true);
    expect(store.credentialsVersion).toBe('1.0');
    expect(store.lastSync).toBe('2026-02-03T04:05:06.000Z');
  });

  test('a migrated record reads back from the encrypted store on the next call', async () => {
    store = { canvasToken: 'legacy~canvas', notionToken: 'legacy-notion', notionDatabaseId: 'legacy-db' };
    await CredentialManager.getCredentials();

    await expect(CredentialManager.getCredentials()).resolves.toEqual({
      canvasToken: 'legacy~canvas',
      notionToken: 'legacy-notion',
      notionDatabaseId: 'legacy-db',
      lastSync: undefined
    });
  });

  test('migrates a partially populated legacy record', async () => {
    store = { notionDatabaseId: 'legacy-db' };

    const migrated = await CredentialManager.getCredentials();

    expect(migrated).toEqual({ notionDatabaseId: 'legacy-db' });
    await expect(CredentialManager.getCredentials()).resolves.toEqual({
      canvasToken: null,
      notionToken: null,
      notionDatabaseId: 'legacy-db',
      lastSync: undefined
    });
  });

  test('falls back to legacy storage when decryption fails', async () => {
    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');
    // Simulate a stored blob that the current key can no longer open — e.g. the
    // encryption key was regenerated after the credentials were written.
    store.encryptionKey = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    store.canvasToken = 'fallback~canvas';

    await expect(CredentialManager.getCredentials()).resolves.toEqual({ canvasToken: 'fallback~canvas' });
  });

  test('returns an empty object when decryption and the legacy fallback both fail', async () => {
    await CredentialManager.storeCredentials('1234~canvas', 'ntn_notion', 'db-id');
    const encrypted = store.encryptedCredentials;

    chrome.storage.local.get
      .mockResolvedValueOnce({ encryptedCredentials: encrypted })
      .mockRejectedValueOnce(new Error('decrypt key read failed'))
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(CredentialManager.getCredentials()).resolves.toEqual({});
  });
});

describe('clearAllData', () => {
  test('clears analytics data', async () => {
    await expect(CredentialManager.clearAllData()).resolves.toEqual({ success: true });
    expect(clearData).toHaveBeenCalledTimes(1);
  });

  test('reports failure instead of throwing', async () => {
    clearData.mockRejectedValueOnce(new Error('clear failed'));

    await expect(CredentialManager.clearAllData()).resolves.toEqual({ success: false, error: 'clear failed' });
  });
});
