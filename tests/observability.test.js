/**
 * Observability unit tests (no DB required).
 * Run: node --test tests/observability.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../utils/logger.js';
import { requestContext } from '../middleware/request-context.js';

describe('structured logger', () => {
  it('redacts secret keys in meta', () => {
    const lines = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      lines.push(String(chunk));
      return true;
    };
    try {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      // Re-import won't rebuild; emit via logger which reads isProd at module load.
      // So we call sanitize indirectly: logger always sanitizes meta.
      logger.info('probe', { password: 'secret', token: 'abc', ok: true });
      process.env.NODE_ENV = prev;
    } finally {
      process.stdout.write = orig;
    }
    const joined = lines.join('');
    assert.match(joined, /probe|ok/);
    assert.doesNotMatch(joined, /"password":"secret"/);
    assert.match(joined, /\[redacted\]/);
  });

  it('child logger carries bindings', () => {
    const child = logger.child({ requestId: 'req-test-12345678' });
    assert.equal(typeof child.info, 'function');
    assert.equal(typeof child.error, 'function');
  });
});

describe('requestContext', () => {
  it('assigns req.id and X-Request-Id', () => {
    const req = { headers: {}, method: 'GET', originalUrl: '/api/x', ip: '127.0.0.1' };
    const headers = {};
    const res = {
      setHeader(k, v) {
        headers[k] = v;
      },
      statusCode: 200,
      on() {},
    };
    let nextCalled = false;
    requestContext(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.ok(req.id);
    assert.equal(headers['X-Request-Id'], req.id);
    assert.equal(typeof req.log.info, 'function');
  });

  it('honours inbound X-Request-Id when safe', () => {
    const req = {
      headers: { 'x-request-id': 'upstream-id-abcdef' },
      method: 'GET',
      originalUrl: '/api/x',
      ip: '127.0.0.1',
    };
    const headers = {};
    const res = {
      setHeader(k, v) {
        headers[k] = v;
      },
      statusCode: 200,
      on() {},
    };
    requestContext(req, res, () => {});
    assert.equal(req.id, 'upstream-id-abcdef');
  });

  it('rejects unsafe inbound X-Request-Id', () => {
    const req = {
      headers: { 'x-request-id': 'bad id with spaces!!' },
      method: 'GET',
      originalUrl: '/api/x',
      ip: '127.0.0.1',
    };
    const res = {
      setHeader() {},
      statusCode: 200,
      on() {},
    };
    requestContext(req, res, () => {});
    assert.notEqual(req.id, 'bad id with spaces!!');
    assert.match(req.id, /^[0-9a-f-]{36}$/i);
  });
});
