/**
 * Metrics module + /api/metrics smoke.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  recordHttpResponse,
  getMetricsSnapshot,
  renderPrometheusMetrics,
  resetMetricsForTests,
} from '../utils/metrics.js';

describe('metrics helpers', () => {
  it('counts status classes', () => {
    resetMetricsForTests();
    recordHttpResponse(200);
    recordHttpResponse(404);
    recordHttpResponse(500);
    recordHttpResponse(503);
    const s = getMetricsSnapshot();
    assert.equal(s.http_requests_total, 4);
    assert.equal(s.http_responses_2xx, 1);
    assert.equal(s.http_responses_4xx, 1);
    assert.equal(s.http_responses_5xx, 2);
  });

  it('renders prometheus text with mongo gauge', () => {
    resetMetricsForTests();
    recordHttpResponse(200);
    const text = renderPrometheusMetrics({ mongoReady: true });
    assert.match(text, /asli_up 1/);
    assert.match(text, /asli_mongo_ready 1/);
    assert.match(text, /asli_http_requests_total 1/);
    assert.match(text, /asli_http_responses_5xx_total 0/);
  });
});

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-at-least-16-chars';
process.env.WEEKLY_IMPACT_CRON = 'off';
process.env.NODE_ENV = 'test';

describe('GET /api/metrics', () => {
  let server;
  let baseUrl;

  before(async () => {
    resetMetricsForTests();
    const { createApp } = await import('../app.js');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('exposes prometheus metrics and increments on traffic', async () => {
    await fetch(`${baseUrl}/api/health`);
    await fetch(`${baseUrl}/api/ready`);
    const res = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') || '';
    assert.match(ct, /text\/plain/);
    const body = await res.text();
    assert.match(body, /asli_up 1/);
    assert.match(body, /asli_http_requests_total [1-9]/);
    assert.match(body, /asli_mongo_ready [01]/);
  });
});
