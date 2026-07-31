/**
 * Cookie auth unit tests (no DB) + optional Mongo integration.
 *
 * Integration runs when MONGO_URI or TEST_MONGO_URI is reachable.
 * Skip otherwise so CI without Mongo stays green.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  attachCookies,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  extractAuthToken,
  extractRefreshToken,
} from '../utils/auth-cookie.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-at-least-16-chars';
process.env.WEEKLY_IMPACT_CRON = process.env.WEEKLY_IMPACT_CRON || 'off';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOGIN_MAX_ATTEMPTS = process.env.LOGIN_MAX_ATTEMPTS || '1000';

describe('auth-cookie helpers', () => {
  it('parses Cookie header into req.cookies', () => {
    const req = {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=abc%20def; ${REFRESH_COOKIE_NAME}=refresh1`,
      },
    };
    attachCookies(req, null, () => {});
    assert.equal(req.cookies[AUTH_COOKIE_NAME], 'abc def');
    assert.equal(req.cookies[REFRESH_COOKIE_NAME], 'refresh1');
  });

  it('prefers Bearer over cookie for access token', () => {
    const req = {
      headers: { authorization: 'Bearer from-header' },
      header(name) {
        return this.headers[String(name).toLowerCase()];
      },
      cookies: { [AUTH_COOKIE_NAME]: 'from-cookie' },
    };
    assert.equal(extractAuthToken(req), 'from-header');
  });

  it('falls back to access cookie', () => {
    const req = {
      headers: {},
      header() {
        return undefined;
      },
      cookies: { [AUTH_COOKIE_NAME]: 'cookie-jwt' },
    };
    assert.equal(extractAuthToken(req), 'cookie-jwt');
  });

  it('ignores Bearer null and uses cookie', () => {
    const req = {
      headers: { authorization: 'Bearer null' },
      header(name) {
        return this.headers[String(name).toLowerCase()];
      },
      cookies: { [AUTH_COOKIE_NAME]: 'cookie-jwt' },
    };
    assert.equal(extractAuthToken(req), 'cookie-jwt');
  });

  it('extracts refresh from body then cookie', () => {
    assert.equal(
      extractRefreshToken({ body: { refreshToken: 'body-r' }, cookies: {} }),
      'body-r',
    );
    assert.equal(
      extractRefreshToken({
        body: {},
        cookies: { [REFRESH_COOKIE_NAME]: 'cookie-r' },
      }),
      'cookie-r',
    );
  });

  it('setAuthCookie / setRefreshCookie / clearAuthCookie use httpOnly', () => {
    const cookies = [];
    const cleared = [];
    const res = {
      cookie(name, value, opts) {
        cookies.push({ name, value, opts });
      },
      clearCookie(name, opts) {
        cleared.push({ name, opts });
      },
    };
    setAuthCookie(res, 'access-xyz');
    setRefreshCookie(res, 'refresh-xyz');
    assert.equal(cookies.length, 2);
    assert.equal(cookies[0].name, AUTH_COOKIE_NAME);
    assert.equal(cookies[0].opts.httpOnly, true);
    assert.equal(cookies[1].name, REFRESH_COOKIE_NAME);
    assert.equal(cookies[1].opts.httpOnly, true);
    clearAuthCookie(res);
    assert.equal(cleared.length, 2);
    assert.deepEqual(
      cleared.map((c) => c.name).sort(),
      [AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME].sort(),
    );
  });
});

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  const map = {};
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    map[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return map;
}

function cookieHeader(map) {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const mongoUri = process.env.TEST_MONGO_URI || '';

describe('auth cookie HTTP integration', () => {
  let server;
  let baseUrl;
  let User;
  let enabled = false;
  const email = `auth-cookie-it-${Date.now()}@example.com`;
  const password = 'password123';

  before(async () => {
    if (!mongoUri) {
      console.log('auth cookie IT skipped: set TEST_MONGO_URI to a dedicated test database');
      return;
    }
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    } catch (err) {
      console.log('auth cookie IT skipped: cannot connect to TEST_MONGO_URI —', err.message);
      return;
    }
    enabled = true;
    User = (await import('../models/User.js')).default;
    await User.deleteMany({ email });
    await User.create({
      email,
      password: await bcrypt.hash(password, 10),
      fullName: 'Auth Cookie IT',
      role: 'student',
      isActive: true,
    });

    const { createApp } = await import('../app.js');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    try {
      if (enabled && User) await User.deleteMany({ email });
    } catch {
      /* ignore */
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });

  async function req(path, { method = 'GET', headers = {}, body } = {}) {
    const res = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* */
    }
    return { status: res.status, headers: res.headers, json, cookies: parseSetCookie(res) };
  }

  it('login → me (cookie) → refresh rotation → logout revokes refresh', async (t) => {
    if (!enabled) {
      t.skip('TEST_MONGO_URI not set or unreachable');
      return;
    }

    const login = await req('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json?.success, true);
    assert.ok(login.json.token || login.json.accessToken);
    assert.ok(login.json.refreshToken);

    const access =
      login.cookies[AUTH_COOKIE_NAME] || login.json.accessToken || login.json.token;
    const refresh = login.cookies[REFRESH_COOKIE_NAME] || login.json.refreshToken;
    assert.ok(access);
    assert.ok(refresh);

    const me = await req('/api/auth/me', {
      headers: { Cookie: cookieHeader({ [AUTH_COOKIE_NAME]: access }) },
    });
    assert.equal(me.status, 200);
    assert.equal(String(me.json?.user?.email || '').toLowerCase(), email.toLowerCase());

    const refreshed = await req('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refresh },
    });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.json.refreshToken);
    assert.notEqual(refreshed.json.refreshToken, refresh);

    const reuse = await req('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refresh },
    });
    assert.equal(reuse.status, 401);

    const newRefresh = refreshed.json.refreshToken;
    const logout = await req('/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader({
          [AUTH_COOKIE_NAME]: refreshed.json.accessToken || refreshed.json.token,
          [REFRESH_COOKIE_NAME]: newRefresh,
        }),
      },
      body: { refreshToken: newRefresh },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.json?.success, true);

    const afterLogout = await req('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: newRefresh },
    });
    assert.equal(afterLogout.status, 401);
  });
});
