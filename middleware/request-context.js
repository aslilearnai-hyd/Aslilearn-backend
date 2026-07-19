/**
 * Request correlation.
 *
 * Every request gets an id, exposed on `req.id`, echoed back as the
 * `X-Request-Id` response header, and attached to `req.log` so any handler can
 * log with correlation for free.
 *
 * Without this, the global error handler could only print a stack to stdout
 * with no way to tie it to the user, route or timing that produced it — and
 * with 1,719 interleaved console.log calls from concurrent requests, matching
 * a stack to its request was guesswork.
 *
 * An inbound X-Request-Id is honoured so ids issued by Nginx or a frontend
 * survive the hop, rather than being replaced at the edge of this service.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

/** Accept an upstream id only if it looks sane — never echo unbounded input. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function requestContext(req, res, next) {
  const inbound = String(req.headers['x-request-id'] || '').trim();
  req.id = SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);

  req.log = logger.child({ requestId: req.id });

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // 4xx/5xx are worth seeing by default; 2xx traffic stays at debug so
    // production logs are not dominated by routine requests.
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    req.log[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      status: res.statusCode,
      durationMs: Math.round(ms),
      ip: req.ip,
    });
  });

  next();
}

export default requestContext;
