// Circuit breaker for repeated API failures (see #60)
//
// When an endpoint is durably broken — Canvas down, a Notion integration whose
// access was revoked, a network that has gone away — every assignment in the
// sync otherwise retries against it in turn, each one paying the full backoff
// ladder before failing. The breaker turns the sixth identical failure into an
// immediate one.
//
// Three states per endpoint:
//   closed    - requests pass through; consecutive failures are counted
//   open      - requests are rejected immediately until the cooldown elapses
//   half-open - exactly one trial request is allowed; success closes the
//               circuit, failure reopens it for another cooldown
//
// Permanent auth/configuration failures (a 401, an integration that lost access
// to the database) do not wait for the threshold and are not specific to one
// endpoint: they open a service-wide circuit immediately, so a sync stops
// retrying them once per assignment.
//
// Loaded as a plain script (content scripts) and via side-effect import
// (service worker), matching debug.js and canvas-rate-limiter.js. Access via
// globalThis.
/* global Debug */

// Key of the service-wide circuit, checked before every endpoint circuit. Not a
// legal endpoint key, so it can never collide with a real one.
const SERVICE_CIRCUIT_KEY = '*';

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30000;

class CircuitOpenError extends Error {
  constructor(message, { service, endpoint, reason, retryAfterMs }) {
    super(message);
    this.name = 'CircuitOpenError';
    // Marks an error the breaker produced rather than one a request returned.
    // Callers use it to tell "we never asked" from "the service said no".
    this.circuitOpen = true;
    this.service = service;
    this.endpoint = endpoint;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

// The known shapes of a fetch() that never produced a response. Deliberately
// matched by message rather than treating every status-less error as a network
// failure, so a programming bug (a TypeError from our own code) does not count
// against an endpoint's budget. Mirrors CanvasRateLimiter._isNetworkError,
// which needs the same list without depending on this module's load order.
function isNetworkFailure(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;

  const message = (error.message || '').toLowerCase();
  return message.includes('failed to fetch') ||        // Chrome
         message.includes('networkerror') ||           // Firefox
         message.includes('network error') ||
         message.includes('network request failed') ||
         message.includes('load failed') ||            // Safari
         message.includes('network connection') ||
         message.includes('connection refused') ||
         message.includes('connection reset') ||
         message.includes('connection closed') ||
         message.includes('net::err_');                // net::ERR_* surfaced by Chrome
}

function isCanvasRateLimit(error) {
  if (error.status !== 403) return false;
  const message = (error.message || '').toLowerCase();
  return message.includes('rate') || message.includes('throttl') || message.includes('limit');
}

/**
 * How a Canvas failure should affect the circuit.
 *   'permanent' - the same answer is coming for every request; open now
 *   'failure'   - counts towards the consecutive-failure threshold
 *   'ignore'    - Canvas answered; not evidence the endpoint is broken
 * @param {Error} error
 * @returns {'permanent'|'failure'|'ignore'}
 */
function classifyCanvasError(error) {
  if (!error) return 'ignore';

  // The rate limiter owns 403 throttling and its own retry budget. Counting it
  // here would open the circuit on a sync that is merely being slowed down.
  if (isCanvasRateLimit(error)) return 'ignore';

  // No Canvas session, or a token Canvas will not accept: identical for every
  // request until the user signs in again.
  if (error.status === 401) return 'permanent';

  // A 403 that does not say it is a rate limit is a permissions decision — but
  // deliberately not a service-wide one. Canvas answers 403 for a single course
  // the user cannot see, and throttles with a 403 whose body is not always
  // labelled, so pausing every Canvas request on the first one would be wrong
  // far too often. It counts towards this endpoint's threshold instead.
  if (error.status === 403) return 'failure';

  if (typeof error.status === 'number') {
    // 5xx: Canvas (or something in front of it) is unwell.
    if (error.status >= 500) return 'failure';
    // Other 4xx (a 404 for one course, a 400 for one query) is a per-resource
    // answer from a healthy Canvas.
    return 'ignore';
  }

  return isNetworkFailure(error) ? 'failure' : 'ignore';
}

/**
 * How a Notion failure should affect the circuit. Same vocabulary as
 * classifyCanvasError.
 * @param {Error} error
 * @returns {'permanent'|'failure'|'ignore'}
 */
function classifyNotionError(error) {
  if (!error) return 'ignore';

  // 429 belongs to NotionRateLimiter's budget, 409 to executeWithRetry's.
  if (error.status === 429 || error.status === 409) return 'ignore';

  // An invalid token, or an integration whose access to the workspace was
  // revoked: every later request in this sync gets the same answer.
  if (error.status === 401 || error.status === 403) return 'permanent';

  if (error.status === 404) {
    // "Could not find database/data source" means the database was deleted or
    // never shared with the integration — a configuration failure that repeats
    // for every assignment. A 404 on a page is per-item (someone deleted that
    // row in Notion), so it only counts towards the threshold.
    const message = (error.message || '').toLowerCase();
    if (message.includes('data source') || message.includes('database')) return 'permanent';
    return 'failure';
  }

  if (typeof error.status === 'number') {
    if (error.status >= 500) return 'failure';
    // 400: the properties for one assignment were rejected. Notion is fine.
    return 'ignore';
  }

  return isNetworkFailure(error) ? 'failure' : 'ignore';
}

class CircuitBreaker {
  /**
   * @param {object} [options]
   * @param {string} [options.service] - display name used in log lines and errors
   * @param {number} [options.failureThreshold] - consecutive failures before opening
   * @param {number} [options.cooldownMs] - time an open circuit rejects before a trial
   * @param {(error: Error) => 'permanent'|'failure'|'ignore'} [options.classify]
   * @param {() => number} [options.now] - clock, injectable for tests
   */
  constructor(options = {}) {
    this.service = options.service || 'API';
    this.failureThreshold = options.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs === undefined ? DEFAULT_COOLDOWN_MS : options.cooldownMs;
    this.classify = options.classify || (() => 'failure');
    this.now = options.now || (() => Date.now());
    this._circuits = new Map();
  }

  /**
   * Run a request under the breaker. Rejects with a CircuitOpenError — without
   * calling requestFunction — while the circuit for this endpoint, or the
   * service-wide circuit, is open.
   * @param {string} endpoint - normalised endpoint key (path shape, not IDs)
   * @param {() => Promise<*>} requestFunction
   */
  async execute(endpoint, requestFunction) {
    const key = endpoint || 'unknown';
    const gates = [this._gate(SERVICE_CIRCUIT_KEY), this._gate(key)];

    const blocked = gates.find(gate => gate.error);
    if (blocked) throw blocked.error;

    // Only mark trials once both circuits agreed, so a rejection by one does
    // not spend the other's single half-open attempt.
    gates.forEach(gate => {
      if (gate.startTrial) gate.circuit.trialInFlight = true;
    });

    try {
      const result = await requestFunction();
      this._onSuccess(key);
      return result;
    } catch (error) {
      // A breaker further down the stack already rejected this; it is not a
      // fresh failure of ours to count.
      if (error && error.circuitOpen) throw error;
      this._onFailure(key, error);
      throw error;
    }
  }

  /**
   * Whether requests to this endpoint are currently being rejected. Read-only:
   * unlike execute(), asking does not start a half-open trial.
   */
  isOpen(endpoint) {
    return [SERVICE_CIRCUIT_KEY, endpoint || 'unknown'].some(key => {
      const circuit = this._circuits.get(key);
      if (!circuit) return false;
      if (circuit.state === 'open') return this._remainingCooldown(circuit) > 0;
      return circuit.state === 'half-open' && circuit.trialInFlight;
    });
  }

  /**
   * Whether the service-wide circuit is open — the whole service is answering
   * the same way (a revoked integration, an expired session), so no endpoint
   * can succeed. Callers use this to stop a loop early instead of asking once
   * per item only to be rejected.
   */
  isServiceOpen() {
    return this.isOpen(SERVICE_CIRCUIT_KEY);
  }

  /**
   * Open circuits, for surfacing in the popup: the service-wide one appears as
   * endpoint '*'.
   * @returns {Array<{endpoint: string, reason: string, retryAfterMs: number}>}
   */
  getOpenCircuits() {
    const open = [];
    this._circuits.forEach((circuit, key) => {
      if (circuit.state === 'open' && this._remainingCooldown(circuit) > 0) {
        open.push({
          endpoint: key,
          reason: circuit.reason,
          retryAfterMs: this._remainingCooldown(circuit)
        });
      }
    });
    return open;
  }

  /** Forget everything, or just one endpoint's state. */
  reset(endpoint) {
    if (endpoint === undefined) {
      this._circuits.clear();
      return;
    }
    this._circuits.delete(endpoint);
  }

  _circuitFor(key) {
    let circuit = this._circuits.get(key);
    if (!circuit) {
      circuit = { state: 'closed', failures: 0, openedAt: 0, reason: null, trialInFlight: false };
      this._circuits.set(key, circuit);
    }
    return circuit;
  }

  _remainingCooldown(circuit) {
    return Math.max(0, circuit.openedAt + this.cooldownMs - this.now());
  }

  // Decide whether this circuit lets a request through. Claiming the single
  // half-open attempt is left to execute(), which only does so once every
  // circuit involved has agreed — otherwise a rejection by one would spend the
  // other's one trial on a request that was never sent.
  _gate(key) {
    const circuit = this._circuitFor(key);

    if (circuit.state === 'closed') {
      return { circuit, error: null, startTrial: false };
    }

    if (circuit.state === 'open') {
      const remaining = this._remainingCooldown(circuit);
      if (remaining > 0) {
        return { circuit, error: this._openError(key, circuit, remaining), startTrial: false };
      }
      // Cooldown elapsed: let exactly one request through to see if it is back.
      this._transition(key, circuit, 'half-open', circuit.reason);
      return { circuit, error: null, startTrial: true };
    }

    // half-open: one trial at a time.
    if (circuit.trialInFlight) {
      return { circuit, error: this._openError(key, circuit, 0), startTrial: false };
    }
    return { circuit, error: null, startTrial: true };
  }

  _openError(key, circuit, remaining) {
    const seconds = Math.ceil(remaining / 1000);
    const scope = key === SERVICE_CIRCUIT_KEY ? '' : ` to ${key}`;
    const wait = seconds > 0 ? ` Retrying in ${seconds}s.` : ' A trial request is already in flight.';

    const message = circuit.reason === 'authentication'
      ? `${this.service} rejected the last request and will reject the rest the same way ` +
        `until it is fixed, so requests${scope} are paused.${wait}`
      : `${this.service} is not responding, so requests${scope} are paused ` +
        `after ${this.failureThreshold} consecutive failures.${wait}`;

    return new CircuitOpenError(message, {
      service: this.service,
      endpoint: key,
      reason: circuit.reason,
      retryAfterMs: remaining
    });
  }

  _onSuccess(key) {
    [SERVICE_CIRCUIT_KEY, key].forEach(circuitKey => {
      const circuit = this._circuits.get(circuitKey);
      if (!circuit) return;
      if (circuit.state !== 'closed') {
        this._transition(circuitKey, circuit, 'closed', null);
      }
      circuit.failures = 0;
      circuit.trialInFlight = false;
    });
  }

  _onFailure(key, error) {
    const verdict = this.classify(error);

    // The service answered — it is up, whatever it said about this one request.
    if (verdict === 'ignore') {
      this._onSuccess(key);
      return;
    }

    if (verdict === 'permanent') {
      const circuit = this._circuitFor(SERVICE_CIRCUIT_KEY);
      circuit.failures += 1;
      circuit.trialInFlight = false;
      circuit.openedAt = this.now();
      this._transition(SERVICE_CIRCUIT_KEY, circuit, 'open', 'authentication', this._describe(error));
      return;
    }

    const circuit = this._circuitFor(key);
    circuit.failures += 1;

    // A failed trial goes straight back to open rather than getting the rest of
    // the threshold over again.
    if (circuit.state === 'half-open' || circuit.failures >= this.failureThreshold) {
      circuit.trialInFlight = false;
      circuit.openedAt = this.now();
      this._transition(key, circuit, 'open', 'unavailable', this._describe(error));
    }
  }

  _describe(error) {
    if (!error) return 'unknown error';
    return typeof error.status === 'number' ? `HTTP ${error.status}` : (error.message || 'unknown error');
  }

  _transition(key, circuit, state, reason, detail) {
    const previous = circuit.state;
    circuit.state = state;
    circuit.reason = reason;
    if (previous === state) return;

    const scope = key === SERVICE_CIRCUIT_KEY ? 'all requests' : key;
    const because = detail ? ` (${detail})` : '';
    const line = `${this.service} circuit ${previous} -> ${state} for ${scope}${because}`;

    if (state === 'open') {
      Debug.warn(line);
      // Present in the service worker, absent in the content script.
      if (globalThis.SyncLogger) {
        globalThis.SyncLogger.warn(
          `${this.service} requests paused after repeated failures: ${scope}${because}`,
          { service: this.service, endpoint: key, reason }
        );
      }
    } else {
      Debug.log(line);
      if (state === 'closed' && globalThis.SyncLogger) {
        globalThis.SyncLogger.info(`${this.service} requests resumed: ${scope}`, {
          service: this.service, endpoint: key
        });
      }
    }
  }
}

function createCanvasCircuitBreaker(options = {}) {
  return new CircuitBreaker({ service: 'Canvas', classify: classifyCanvasError, ...options });
}

function createNotionCircuitBreaker(options = {}) {
  return new CircuitBreaker({ service: 'Notion', classify: classifyNotionError, ...options });
}

// Make available as globals for both content scripts and the service worker
if (typeof globalThis !== 'undefined' && typeof globalThis.CircuitBreaker === 'undefined') {
  globalThis.CircuitBreaker = CircuitBreaker;
  globalThis.CircuitOpenError = CircuitOpenError;
  globalThis.createCanvasCircuitBreaker = createCanvasCircuitBreaker;
  globalThis.createNotionCircuitBreaker = createNotionCircuitBreaker;
  globalThis.classifyCanvasError = classifyCanvasError;
  globalThis.classifyNotionError = classifyNotionError;
  globalThis.CIRCUIT_SERVICE_KEY = SERVICE_CIRCUIT_KEY;
}
