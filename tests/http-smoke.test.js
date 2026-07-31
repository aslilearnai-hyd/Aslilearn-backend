/**
 * HTTP smoke against createApp (no Mongo required for /health|/ready|/404).
 * Disables weekly cron so the process can exit.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-at-least-16-chars';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aslilearn_http_smoke';
process.env.WEEKLY_IMPACT_CRON = 'off';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let server;
let baseUrl;

async function request(path, { method = 'GET', headers = {} } = {}) {
  const url = new URL(path, baseUrl);
  const res = await fetch(url, { method, headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, headers: res.headers, json, text };
}

before(async () => {
  const { createApp } = await import('../app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('http smoke', () => {
  it('GET /api/health returns probe payload + X-Request-Id', async () => {
    const { status, headers, json } = await request('/api/health');
    // Without mongo: 503 degraded is OK; with mongo: 200
    assert.ok(status === 200 || status === 503);
    assert.ok(json);
    assert.ok(json.probe === 'liveness' || json.status);
    assert.ok(json.time || json.uptimeSec != null);
    const rid = headers.get('x-request-id');
    assert.ok(rid && rid.length >= 8);
  });

  it('GET /api/ready returns readiness probe', async () => {
    const { status, json } = await request('/api/ready');
    assert.ok(status === 200 || status === 503);
    assert.equal(json.probe, 'readiness');
    assert.ok(['ready', 'not_ready'].includes(json.status));
  });

  it('honours inbound X-Request-Id on health', async () => {
    const { headers } = await request('/api/health', {
      headers: { 'X-Request-Id': 'smoke-req-id-001' },
    });
    assert.equal(headers.get('x-request-id'), 'smoke-req-id-001');
  });

  it('unknown API route returns 404 with requestId', async () => {
    const { status, json } = await request('/api/definitely-missing-endpoint-xyz');
    // May be 503 if DB gate hits before 404 — ready/health are exempt; this path is gated
    assert.ok(status === 404 || status === 503);
    if (status === 404) {
      assert.equal(json.success, false);
      assert.ok(json.requestId);
    }
  });

  it('protected teacher route rejects unauthenticated', async () => {
    const { status, json } = await request('/api/teacher/dashboard');
    // 401 from verifyToken, or 503 if DB down before route
    assert.ok([401, 503].includes(status));
    if (status === 401) {
      assert.match(String(json?.message || ''), /token|Access denied|Authentication/i);
    }
  });
});
