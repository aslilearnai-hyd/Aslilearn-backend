import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

const startedAt = Date.now();

function basePayload() {
  return {
    service: 'asli-stud-backend',
    version: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  };
}

/**
 * Liveness — process is up. Prefer this for k8s/docker liveness probes.
 * Remains mongo-aware for backward compatibility with existing Nginx checks:
 * returns 503 when DB is down so load balancers stop sending traffic.
 */
router.get('/', (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    ...basePayload(),
    status: mongoReady ? 'ok' : 'degraded',
    message: mongoReady
      ? 'AsliLearn backend is healthy'
      : 'Backend is up but database is reconnecting — retry shortly',
    mongo: mongoReady ? 'connected' : 'disconnected',
    probe: 'liveness',
  });
});

/**
 * Readiness — safe to receive traffic only when Mongo is connected.
 * Mounted at /api/ready (see app.js).
 */
export function readyHandler(req, res) {
  const mongoReady = mongoose.connection.readyState === 1;
  if (!mongoReady) {
    res.setHeader('Retry-After', '3');
    return res.status(503).json({
      ...basePayload(),
      status: 'not_ready',
      mongo: 'disconnected',
      probe: 'readiness',
      message: 'Database is not ready',
    });
  }
  return res.status(200).json({
    ...basePayload(),
    status: 'ready',
    mongo: 'connected',
    probe: 'readiness',
  });
}

export default router;
