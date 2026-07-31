/**
 * Production API entrypoint.
 * Boot: env → createApp → mongo → listen.
 * Application middleware and routes live in app.js + routes/*.
 */
import { loadEnv } from './bootstrap/env.js';
import { connectMongo } from './bootstrap/mongo.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

const { parsedEnv } = loadEnv();
const app = createApp({ parsedEnv });
const PORT = process.env.PORT || 5000;
const nodeEnvEffective = process.env.NODE_ENV || 'production';

connectMongo().catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${nodeEnvEffective}`);
});
server.timeout = Number(process.env.SERVER_TIMEOUT_MS || 300_000);
server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 310_000);
server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 65_000);
server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_MS || 120_000);

process.on('unhandledRejection', (reason, promise) => {
  console.error(
    '❌ UNHANDLED REJECTION — server continues:',
    reason instanceof Error ? reason.stack : reason,
  );
  console.error('   promise:', promise);
});

let shuttingDown = false;
const shutdown = (signal, code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — closing server...`);
  server.close(() => {
    console.log('Server closed. Exiting.');
    process.exit(code);
  });
  setTimeout(() => {
    console.error('Shutdown timed out after 10s — forcing exit.');
    process.exit(code || 1);
  }, 10_000).unref();
};

process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION — shutting down:', err?.stack || err);
  shutdown('uncaughtException', 1);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server, logger };
