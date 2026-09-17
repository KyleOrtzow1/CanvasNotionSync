import { describe, test, expect } from '@jest/globals';
import '../src/validators/token-validator.js';
const { validateCanvasToken } = globalThis;

// Fixtures use repeated characters on purpose: they have the shape of a Canvas
// token without the entropy of one, so the no-secrets lint rule stays quiet.
const SECRET_64 = 'a'.repeat(64);
const SECRET_32 = 'b'.repeat(32);
const CURRENT_TOKEN = `7~${SECRET_64}`;
const LEGACY_TOKEN = 'c'.repeat(64);

describe('validateCanvasToken', () => {

  describe('accepted shapes', () => {
    test('accepts the current "<shard>~<secret>" form', () => {
      expect(validateCanvasToken(CURRENT_TOKEN)).toEqual({ valid: true, reason: null, message: null });
    });

    test('accepts a multi-digit shard prefix', () => {
      expect(validateCanvasToken(`120420~${SECRET_64}`).valid).toBe(true);
    });

    test('accepts a mixed-case alphanumeric secret', () => {
      expect(validateCanvasToken(`7~${'aB9'.repeat(16)}`).valid).toBe(true);
    });

    test('accepts a secret at the minimum plausible length', () => {
      expect(validateCanvasToken(`7~${SECRET_32}`).valid).toBe(true);
    });

    test('accepts a legacy bare token with no shard prefix', () => {
      expect(validateCanvasToken(LEGACY_TOKEN).valid).toBe(true);
    });

    test('ignores surrounding whitespace from a copy-paste', () => {
      expect(validateCanvasToken(`  ${CURRENT_TOKEN}\n`).valid).toBe(true);
    });
  });

  describe('rejected shapes', () => {
    test('rejects an empty string as empty, not malformed', () => {
      const result = validateCanvasToken('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('empty');
    });

    test('rejects a whitespace-only value as empty', () => {
      expect(validateCanvasToken('   ').reason).toBe('empty');
    });

    test.each([[null], [undefined]])('rejects %p as empty', (value) => {
      expect(validateCanvasToken(value).reason).toBe('empty');
    });

    test.each([[12345], [{}], [['token']]])('rejects the non-string %p', (value) => {
      const result = validateCanvasToken(value);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_a_string');
    });

    test('rejects a truncated current-form token as too short', () => {
      const result = validateCanvasToken('7~abcdef');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('too_short');
      expect(result.message).toMatch(/cut off/);
    });

    test('rejects a truncated legacy token as too short', () => {
      const result = validateCanvasToken('d'.repeat(20));
      expect(result.reason).toBe('too_short');
    });

    test('rejects a shard prefix with nothing after the "~"', () => {
      expect(validateCanvasToken('7~').reason).toBe('too_short');
    });

    test('rejects a non-numeric prefix before the "~"', () => {
      const result = validateCanvasToken(`abc~${SECRET_64}`);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_shard_prefix');
    });

    test('rejects punctuation in the secret', () => {
      expect(validateCanvasToken(`7~${'a'.repeat(60)}!!!!`).reason).toBe('invalid_characters');
    });

    test('rejects a second "~" picked up with the token', () => {
      expect(validateCanvasToken(`7~${SECRET_64}~${SECRET_32}`).reason).toBe('invalid_characters');
    });

    test('rejects a pasted URL rather than a token', () => {
      const result = validateCanvasToken('https://school.instructure.com/profile/settings');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_characters');
    });

    test('rejects internal whitespace before judging the characters', () => {
      const result = validateCanvasToken(`7~${'a'.repeat(32)} ${'a'.repeat(32)}`);
      expect(result.reason).toBe('contains_whitespace');
    });

    test('rejects a value longer than any Canvas token', () => {
      const result = validateCanvasToken(`7~${'a'.repeat(300)}`);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('too_long');
    });
  });

  describe('messages', () => {
    test('never echoes the token back', () => {
      const pasted = `7~${'z'.repeat(8)}`;
      const result = validateCanvasToken(pasted);
      expect(result.message).not.toContain(pasted);
      expect(result.message).not.toContain('z'.repeat(8));
    });

    test('carries a user-facing message for every rejection', () => {
      const rejected = ['', '   ', 12345, '7~abc', `abc~${SECRET_64}`, `7~${'a'.repeat(300)}`];
      for (const value of rejected) {
        const result = validateCanvasToken(value);
        expect(result.valid).toBe(false);
        expect(typeof result.message).toBe('string');
        expect(result.message.length).toBeGreaterThan(0);
      }
    });

    test('reports no reason or message when the token is well formed', () => {
      const result = validateCanvasToken(CURRENT_TOKEN);
      expect(result.reason).toBeNull();
      expect(result.message).toBeNull();
    });
  });
});
