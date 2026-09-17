import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import '../src/utils/circuit-breaker.js';

const {
  CircuitBreaker,
  CircuitOpenError,
  classifyCanvasError,
  classifyNotionError,
  createCanvasCircuitBreaker,
  createNotionCircuitBreaker
} = globalThis;

// Issue #60: a durably broken endpoint should fail fast instead of making every
// assignment in the sync pay the full retry ladder against it.

const httpError = (status, message = `HTTP ${status}`) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

// A clock the tests move by hand, so cooldowns are exercised without waiting.
const fakeClock = (start = 1_000_000) => {
  const clock = { t: start };
  clock.now = () => clock.t;
  clock.advance = (ms) => { clock.t += ms; };
  return clock;
};

describe('CircuitBreaker state transitions', () => {
  let clock;
  let breaker;
  const boom = () => Promise.reject(httpError(500));

  beforeEach(() => {
    clock = fakeClock();
    breaker = new CircuitBreaker({
      service: 'Canvas',
      failureThreshold: 3,
      cooldownMs: 10000,
      classify: classifyCanvasError,
      now: clock.now
    });
  });

  test('passes requests through and returns their result while closed', async () => {
    const request = jest.fn(async () => 'ok');
    await expect(breaker.execute('/courses', request)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(1);
    expect(breaker.isOpen('/courses')).toBe(false);
  });

  test('stays closed below the failure threshold', async () => {
    await expect(breaker.execute('/courses', boom)).rejects.toMatchObject({ status: 500 });
    await expect(breaker.execute('/courses', boom)).rejects.toMatchObject({ status: 500 });
    expect(breaker.isOpen('/courses')).toBe(false);
  });

  test('opens on the threshold failure and rejects without sending the next request', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute('/courses', boom)).rejects.toMatchObject({ status: 500 });
    }
    expect(breaker.isOpen('/courses')).toBe(true);

    const request = jest.fn(async () => 'ok');
    await expect(breaker.execute('/courses', request)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(request).not.toHaveBeenCalled();
  });

  test('the rejection names the service and carries the remaining cooldown', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    clock.advance(4000);

    const error = await breaker.execute('/courses', async () => 'ok').catch(e => e);
    expect(error.circuitOpen).toBe(true);
    expect(error.service).toBe('Canvas');
    expect(error.endpoint).toBe('/courses');
    expect(error.retryAfterMs).toBe(6000);
    expect(error.message).toContain('Canvas is not responding');
  });

  test('an open circuit only blocks its own endpoint', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }

    await expect(breaker.execute('/courses/:id/assignments', async () => 'ok')).resolves.toBe('ok');
  });

  test('allows a single trial request once the cooldown elapses', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    clock.advance(10000);

    // Hold the trial open so a second caller meets a half-open circuit.
    let release;
    const trial = breaker.execute('/courses', () => new Promise(resolve => { release = resolve; }));

    const blocked = jest.fn(async () => 'ok');
    await expect(breaker.execute('/courses', blocked)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(blocked).not.toHaveBeenCalled();

    release('recovered');
    await expect(trial).resolves.toBe('recovered');
  });

  test('a successful trial closes the circuit and resets the failure count', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    clock.advance(10000);
    await expect(breaker.execute('/courses', async () => 'ok')).resolves.toBe('ok');

    expect(breaker.isOpen('/courses')).toBe(false);
    // Back to a full budget: two more failures must not reopen it.
    await breaker.execute('/courses', boom).catch(() => {});
    await breaker.execute('/courses', boom).catch(() => {});
    expect(breaker.isOpen('/courses')).toBe(false);
  });

  test('a failed trial reopens immediately for another full cooldown', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    clock.advance(10000);
    await expect(breaker.execute('/courses', boom)).rejects.toMatchObject({ status: 500 });

    expect(breaker.isOpen('/courses')).toBe(true);
    clock.advance(9999);
    await expect(breaker.execute('/courses', async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError);
    clock.advance(1);
    await expect(breaker.execute('/courses', async () => 'ok')).resolves.toBe('ok');
  });

  test('a success between failures resets the count', async () => {
    await breaker.execute('/courses', boom).catch(() => {});
    await breaker.execute('/courses', boom).catch(() => {});
    await breaker.execute('/courses', async () => 'ok');
    await breaker.execute('/courses', boom).catch(() => {});

    expect(breaker.isOpen('/courses')).toBe(false);
  });

  test('errors classified as ignore never count towards the threshold', async () => {
    const notFound = () => Promise.reject(httpError(404));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute('/courses/:id', notFound)).rejects.toMatchObject({ status: 404 });
    }
    expect(breaker.isOpen('/courses/:id')).toBe(false);
  });

  test('reset clears one endpoint, and reset() clears everything', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    expect(breaker.isOpen('/courses')).toBe(true);

    breaker.reset('/courses');
    expect(breaker.isOpen('/courses')).toBe(false);

    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    breaker.reset();
    expect(breaker.isOpen('/courses')).toBe(false);
    expect(breaker.getOpenCircuits()).toEqual([]);
  });

  test('getOpenCircuits reports what is open and for how long', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute('/courses', boom).catch(() => {});
    }
    clock.advance(2500);

    expect(breaker.getOpenCircuits()).toEqual([
      { endpoint: '/courses', reason: 'unavailable', retryAfterMs: 7500 }
    ]);

    clock.advance(7500);
    expect(breaker.getOpenCircuits()).toEqual([]);
  });

  test('a network failure with no HTTP status counts towards the threshold', async () => {
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute('/courses', offline)).rejects.toThrow('Failed to fetch');
    }
    expect(breaker.isOpen('/courses')).toBe(true);
  });

  test('a programming error is not mistaken for an outage', async () => {
    const bug = () => Promise.reject(new TypeError('x.map is not a function'));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute('/courses', bug)).rejects.toThrow('is not a function');
    }
    expect(breaker.isOpen('/courses')).toBe(false);
  });

  test('a rejection from an inner breaker is not counted again by an outer one', async () => {
    const inner = new CircuitOpenError('inner said no', {
      service: 'Canvas', endpoint: '/courses', reason: 'unavailable', retryAfterMs: 5000
    });
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute('/courses', () => Promise.reject(inner))).rejects.toBe(inner);
    }
    expect(breaker.isOpen('/courses')).toBe(false);
  });
});

describe('CircuitBreaker permanent failures', () => {
  let clock;
  let breaker;

  beforeEach(() => {
    clock = fakeClock();
    breaker = createNotionCircuitBreaker({ failureThreshold: 5, cooldownMs: 30000, now: clock.now });
  });

  test('a 401 opens the whole service on the first failure', async () => {
    await expect(breaker.execute('updatePage', () => Promise.reject(httpError(401))))
      .rejects.toMatchObject({ status: 401 });

    expect(breaker.isServiceOpen()).toBe(true);
    // Every other endpoint is blocked too — the token is bad for all of them.
    const request = jest.fn(async () => 'ok');
    const error = await breaker.execute('createPage', request).catch(e => e);
    expect(request).not.toHaveBeenCalled();
    expect(error.reason).toBe('authentication');
    expect(error.endpoint).toBe('*');
  });

  test('an integration that lost access to the database opens the service', async () => {
    const revoked = httpError(404, 'Notion API error: 404 - Could not find data source with ID abc');
    await expect(breaker.execute('queryDataSource', () => Promise.reject(revoked)))
      .rejects.toMatchObject({ status: 404 });

    expect(breaker.isServiceOpen()).toBe(true);
  });

  test('a 404 for one page does not open the service', async () => {
    const missingPage = httpError(404, 'Notion API error: 404 - Could not find page with ID abc');
    await expect(breaker.execute('updatePage', () => Promise.reject(missingPage)))
      .rejects.toMatchObject({ status: 404 });

    expect(breaker.isServiceOpen()).toBe(false);
    expect(breaker.isOpen('updatePage')).toBe(false);
  });

  test('a service-wide circuit reopens when the trial fails again', async () => {
    await breaker.execute('updatePage', () => Promise.reject(httpError(401))).catch(() => {});
    clock.advance(30000);

    await expect(breaker.execute('updatePage', () => Promise.reject(httpError(401))))
      .rejects.toMatchObject({ status: 401 });
    expect(breaker.isServiceOpen()).toBe(true);
  });

  test('a fixed token closes the service circuit on the next trial', async () => {
    await breaker.execute('updatePage', () => Promise.reject(httpError(401))).catch(() => {});
    clock.advance(30000);

    await expect(breaker.execute('updatePage', async () => 'ok')).resolves.toBe('ok');
    expect(breaker.isServiceOpen()).toBe(false);
  });
});

describe('classifyCanvasError', () => {
  test('a throttling 403 belongs to the rate limiter, not the breaker', () => {
    expect(classifyCanvasError(httpError(403, '403 Forbidden - rate limit exceeded'))).toBe('ignore');
  });

  test('an expired session is permanent, but a permissions 403 only counts', () => {
    expect(classifyCanvasError(httpError(401))).toBe('permanent');
    // Canvas 403s for one inaccessible course, and throttles with a 403 whose
    // body is not always labelled — neither should pause all of Canvas at once.
    expect(classifyCanvasError(httpError(403, '403 Forbidden - user not authorized'))).toBe('failure');
  });

  test('5xx and network failures count towards the threshold', () => {
    expect(classifyCanvasError(httpError(500))).toBe('failure');
    expect(classifyCanvasError(httpError(503))).toBe('failure');
    expect(classifyCanvasError(new Error('net::ERR_CONNECTION_RESET'))).toBe('failure');
  });

  test('a per-resource 404 and an aborted request are ignored', () => {
    expect(classifyCanvasError(httpError(404))).toBe('ignore');
    const aborted = new Error('The user aborted a request.');
    aborted.name = 'AbortError';
    expect(classifyCanvasError(aborted)).toBe('ignore');
  });
});

describe('classifyNotionError', () => {
  test('429 and 409 are left to the layers that own them', () => {
    expect(classifyNotionError(httpError(429))).toBe('ignore');
    expect(classifyNotionError(httpError(409))).toBe('ignore');
  });

  test('401 and 403 are permanent', () => {
    expect(classifyNotionError(httpError(401))).toBe('permanent');
    expect(classifyNotionError(httpError(403))).toBe('permanent');
  });

  test('a 400 for one assignment does not implicate Notion', () => {
    expect(classifyNotionError(httpError(400, 'body failed validation'))).toBe('ignore');
  });

  test('5xx and network failures count towards the threshold', () => {
    expect(classifyNotionError(httpError(502))).toBe('failure');
    expect(classifyNotionError(new Error('Failed to fetch'))).toBe('failure');
  });
});

describe('createCanvasCircuitBreaker', () => {
  test('uses the documented defaults from #60', () => {
    const breaker = createCanvasCircuitBreaker();
    expect(breaker.service).toBe('Canvas');
    expect(breaker.failureThreshold).toBe(5);
    expect(breaker.cooldownMs).toBe(30000);
  });

  test('opens after five consecutive Canvas outages', async () => {
    const breaker = createCanvasCircuitBreaker();
    const down = () => Promise.reject(httpError(503));

    for (let i = 0; i < 5; i++) {
      await breaker.execute('/courses', down).catch(() => {});
    }
    expect(breaker.isOpen('/courses')).toBe(true);
  });
});

describe('transition logging', () => {
  test('logs an opened circuit through Debug and SyncLogger', async () => {
    const previousSyncLogger = globalThis.SyncLogger;
    const previousDebug = globalThis.Debug;
    globalThis.SyncLogger = { warn: jest.fn(), info: jest.fn() };
    globalThis.Debug = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    try {
      const clock = fakeClock();
      const breaker = createNotionCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: clock.now });

      await breaker.execute('createPage', () => Promise.reject(httpError(500))).catch(() => {});
      await breaker.execute('createPage', () => Promise.reject(httpError(500))).catch(() => {});

      expect(globalThis.Debug.warn).toHaveBeenCalledWith(
        expect.stringContaining('Notion circuit closed -> open for createPage')
      );
      expect(globalThis.SyncLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Notion requests paused after repeated failures'),
        expect.objectContaining({ service: 'Notion', endpoint: 'createPage', reason: 'unavailable' })
      );

      clock.advance(1000);
      await breaker.execute('createPage', async () => 'ok');
      expect(globalThis.SyncLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Notion requests resumed'),
        expect.objectContaining({ endpoint: 'createPage' })
      );
    } finally {
      globalThis.SyncLogger = previousSyncLogger;
      globalThis.Debug = previousDebug;
    }
  });

  test('works in a context without SyncLogger (the content script)', async () => {
    const previousSyncLogger = globalThis.SyncLogger;
    delete globalThis.SyncLogger;

    try {
      const breaker = createCanvasCircuitBreaker({ failureThreshold: 1 });
      await expect(breaker.execute('/courses', () => Promise.reject(httpError(500))))
        .rejects.toMatchObject({ status: 500 });
      expect(breaker.isOpen('/courses')).toBe(true);
    } finally {
      if (previousSyncLogger === undefined) {
        delete globalThis.SyncLogger;
      } else {
        globalThis.SyncLogger = previousSyncLogger;
      }
    }
  });
});
