/**
 * k6 baseline load script for staging / local.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://api.staging.example.com -e EMAIL=... -e PASSWORD=... backend/load/k6-baseline.js
 *   k6 run -e BASE_URL=http://127.0.0.1:5000 backend/load/k6-baseline.js
 *
 * Without EMAIL/PASSWORD, only public probes run (health/ready/metrics).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const EMAIL = __ENV.EMAIL || '';
const PASSWORD = __ENV.PASSWORD || '';

const errorRate = new Rate('asli_errors');
const readyLatency = new Trend('asli_ready_ms');
const loginLatency = new Trend('asli_login_ms');

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    asli_errors: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const ready = http.get(`${BASE_URL}/api/ready`);
  readyLatency.add(ready.timings.duration);
  const readyOk = check(ready, {
    'ready 200 or 503': (r) => r.status === 200 || r.status === 503,
  });
  errorRate.add(!readyOk);

  const health = http.get(`${BASE_URL}/api/health`);
  check(health, {
    'health 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  const metrics = http.get(`${BASE_URL}/api/metrics`);
  check(metrics, {
    'metrics 200': (r) => r.status === 200,
    'metrics has asli_up': (r) => String(r.body || '').includes('asli_up'),
  });

  if (EMAIL && PASSWORD) {
    const login = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: EMAIL, password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    loginLatency.add(login.timings.duration);
    const loginOk = check(login, {
      'login 200': (r) => r.status === 200,
      'login has token': (r) => {
        try {
          const j = r.json();
          return !!(j.token || j.accessToken);
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!loginOk);

    if (login.status === 200) {
      let token = '';
      try {
        token = login.json().accessToken || login.json().token || '';
      } catch {
        /* */
      }
      if (token) {
        const me = http.get(`${BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        check(me, { 'me 200': (r) => r.status === 200 });
      }
    }
  }

  sleep(1);
}
