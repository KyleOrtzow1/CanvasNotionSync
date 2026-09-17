// Shape checks for API tokens a user pastes into the popup.
//
// Format validation only: this says whether what was pasted could ever be a
// token, not whether Canvas still accepts it. Only Canvas can answer the
// second question, so a well-formed token that Canvas rejects must keep
// producing the auth error it produces today — the two cases are reported
// differently on purpose (a truncated copy-paste and an expired token
// otherwise look identical to the user).
//
// Nothing here ever echoes the token back in a message; the messages describe
// the shape problem only, so a token can't leak into the popup status line,
// the sync log, or the console.

// Canvas issues tokens in two shapes:
//   - current:  "<shard id>~<secret>", e.g. 7~AbC123...  (the shard id is the
//               numeric prefix Canvas added so a token identifies its region)
//   - legacy:   a bare alphanumeric secret with no "~" prefix, still valid on
//               older self-hosted Canvas installs
// Both secrets are alphanumeric and long. The bounds below are deliberately
// generous: rejecting a real token is worse than accepting a fake one, since
// Canvas verifies the token on the very next request either way.
const CANVAS_SECRET_MIN_LENGTH = 32;
const CANVAS_LEGACY_MIN_LENGTH = 40;
const CANVAS_TOKEN_MAX_LENGTH = 255;
const CANVAS_SHARD_PREFIX = /^[0-9]{1,10}$/;
const CANVAS_SECRET_CHARS = /^[A-Za-z0-9]+$/;

/**
 * Validate the shape of a Canvas API token.
 *
 * The Canvas token is optional in this extension — an empty value means "use
 * my Canvas login", which is a valid configuration, so an empty token is
 * reported as invalid with the `empty` reason rather than as malformed. Call
 * sites that treat blank as fine should check for a non-empty value first.
 *
 * @param {*} token - The raw value from the token field.
 * @returns {{ valid: boolean, reason: string|null, message: string|null }}
 *   `reason` is a stable code (`empty`, `not_a_string`, `too_long`,
 *   `contains_whitespace`, `invalid_shard_prefix`, `invalid_characters`,
 *   `too_short`), and `message` is a user-facing explanation. Both are null
 *   when the token is well formed.
 */
function validateCanvasToken(token) {
  if (typeof token !== 'string') {
    if (token === null || token === undefined) {
      return invalid('empty', 'Enter a Canvas access token, or leave the field blank to use your Canvas login.');
    }
    return invalid('not_a_string', 'That Canvas access token isn\'t text — paste the token Canvas showed you.');
  }

  const trimmed = token.trim();

  if (!trimmed) {
    return invalid('empty', 'Enter a Canvas access token, or leave the field blank to use your Canvas login.');
  }

  if (trimmed.length > CANVAS_TOKEN_MAX_LENGTH) {
    return invalid('too_long', `That's longer than a Canvas access token (over ${CANVAS_TOKEN_MAX_LENGTH} characters) — make sure you pasted just the token.`);
  }

  if (/\s/.test(trimmed)) {
    return invalid('contains_whitespace', 'That Canvas access token has a space or line break in it — paste just the token, with nothing around it.');
  }

  const separatorIndex = trimmed.indexOf('~');

  if (separatorIndex === -1) {
    // Legacy shape: a bare secret. Anything short enough to be a truncated
    // paste is reported as truncated rather than as the wrong characters.
    if (!CANVAS_SECRET_CHARS.test(trimmed)) {
      return invalid('invalid_characters', 'That doesn\'t look like a Canvas access token — a token is letters and numbers, usually after a "~".');
    }
    if (trimmed.length < CANVAS_LEGACY_MIN_LENGTH) {
      return invalid('too_short', 'That Canvas access token looks cut off — copy the whole token Canvas showed you.');
    }
    return { valid: true, reason: null, message: null };
  }

  const shard = trimmed.slice(0, separatorIndex);
  const secret = trimmed.slice(separatorIndex + 1);

  if (!CANVAS_SHARD_PREFIX.test(shard)) {
    return invalid('invalid_shard_prefix', 'That doesn\'t look like a Canvas access token — it should start with digits followed by "~".');
  }

  // A second "~" means extra text came along with the token.
  if (!CANVAS_SECRET_CHARS.test(secret)) {
    if (!secret) {
      return invalid('too_short', 'That Canvas access token looks cut off — copy the whole token Canvas showed you.');
    }
    return invalid('invalid_characters', 'That doesn\'t look like a Canvas access token — the part after "~" is letters and numbers only.');
  }

  if (secret.length < CANVAS_SECRET_MIN_LENGTH) {
    return invalid('too_short', 'That Canvas access token looks cut off — copy the whole token Canvas showed you.');
  }

  return { valid: true, reason: null, message: null };
}

function invalid(reason, message) {
  return { valid: false, reason, message };
}

// For popup (non-module) context
if (typeof globalThis !== 'undefined' && typeof globalThis.validateCanvasToken === 'undefined') {
  globalThis.validateCanvasToken = validateCanvasToken;
}
