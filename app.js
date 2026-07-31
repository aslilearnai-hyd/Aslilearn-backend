import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { join } from 'path';
import { requestContext } from './middleware/request-context.js';
import { auditTrail } from './middleware/audit-trail.js';
import { logger } from './utils/logger.js';
import {
  metricsMiddleware,
  renderPrometheusMetrics,
} from './utils/metrics.js';
import {
  attachCookies,
  extractAuthToken,
} from './utils/auth-cookie.js';
import { createCsrfOriginGuard } from './middleware/csrf-origin.js';
import {
  isPublicUploadPath,
  roleMayAccessUpload,
  verifyUploadSignature,
} from './utils/upload-access.js';
import { getAllowedOrigins } from './bootstrap/cors-origins.js';
import { getBackendRoot } from './bootstrap/env.js';
import { initPdfProcessingQueue } from './queues/pdfProcessingQueue.js';
import { startWeeklyImpactScheduler } from './services/weekly-impact-scheduler.js';

// Domain routers
import superAdminRoutes from './routes/superAdmin.js';
import adminRoutes from './routes/admin.js';
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import aiRoutes from './routes/ai.js';
import streamRoutes from './routes/streams.js';
import curriculumRoutes from './routes/curriculum.js';
import pdfRagRoutes from './routes/pdf-rag.js';
import aiGeneratorRoutes from './routes/aiGeneratorRoutes.js';
import bookKnowledgeRoutes from './routes/bookKnowledgeRoutes.js';
import bookGeneratorRoutes from './routes/bookGeneratorRoutes.js';
import vidyaRoutes from './routes/vidya.js';
import practiceProgressRoutes from './routes/practice-progress.js';
import dashboardRoutes from './routes/dashboards.js';
import timetableRoutes from './routes/timetable.js';
import authRoutes, { usersRouter } from './routes/auth.js';
import healthRoutes, { readyHandler } from './routes/health.js';
import proxyRoutes from './routes/proxy.js';
import calendarPublicRoutes from './routes/calendarPublic.js';
import catalogRoutes from './routes/catalog.js';
import legacyStubsRoutes from './routes/legacyStubs.js';
import lessonPlanRoutes from './routes/lessonPlan.js';

/**
 * Build the Express application (middleware + routes). Does not listen or connect Mongo.
 * @param {{ parsedEnv?: Record<string, string> }} [options]
 */
export function createApp(options = {}) {
  const parsedEnv = options.parsedEnv || {};
  const __dirname = getBackendRoot();

  const app = express();

  // Match server log default: NODE unset → behave as production (see app.listen log).
  const nodeEnvEffective = process.env.NODE_ENV || 'production';

  // Nginx sets X-Forwarded-* — required for express-rate-limit & req.ip.
  let rawTrust = '';
  if (Object.hasOwn(parsedEnv, 'TRUST_PROXY_HOPS')) {
    rawTrust = String(parsedEnv.TRUST_PROXY_HOPS ?? '').trim();
  } else if (Object.hasOwn(parsedEnv, 'TRUST_PROXY')) {
    rawTrust = String(parsedEnv.TRUST_PROXY ?? '').trim();
  } else if (nodeEnvEffective !== 'production') {
    rawTrust =
      process.env.TRUST_PROXY_HOPS?.trim() ||
      process.env.TRUST_PROXY?.trim() ||
      '';
  }
  let proxyHops = rawTrust;
  if (proxyHops === '') {
    proxyHops = nodeEnvEffective === 'production' ? '1' : '0';
  }
  if (proxyHops === 'false' || proxyHops === '0') {
    app.set('trust proxy', false);
  } else {
    const n = Number(proxyHops);
    app.set('trust proxy', Number.isFinite(n) && n >= 1 ? Math.min(n, 5) : 1);
  }
  if (nodeEnvEffective === 'production') {
    console.log('🔒 trust proxy:', app.get('trust proxy'));
  }

  initPdfProcessingQueue();
  startWeeklyImpactScheduler();

  const allowedOrigins = getAllowedOrigins();

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(requestContext);
  app.use(metricsMiddleware);

  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/)) {
          return callback(null, true);
        }
        if (origin.match(/^https:\/\/alsi-stud-frontend-mf3r.*\.vercel\.app$/)) {
          return callback(null, true);
        }
        if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
          return callback(null, true);
        }
        if (
          process.env.NODE_ENV !== 'production' &&
          (origin.match(/^http:\/\/localhost(:\d+)?$/) ||
            origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/))
        ) {
          return callback(null, true);
        }
        console.warn('[CORS] BLOCKED unrecognized origin:', origin);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Cookie',
        'X-Requested-With',
        'Accept',
        'Origin',
      ],
      exposedHeaders: ['Set-Cookie', 'X-Request-Id'],
      optionsSuccessStatus: 200,
      preflightContinue: false,
    }),
  );

  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '2mb' }));
  app.use(attachCookies);
  app.use(createCsrfOriginGuard(allowedOrigins.filter(Boolean)));
  app.use('/api', auditTrail);

  const TRUSTED_FRAME_ANCESTORS =
    "frame-ancestors 'self' https://aslilearn.ai https://www.aslilearn.ai https://*.vercel.app";

  app.use(
    '/uploads',
    (req, res, next) => {
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', TRUSTED_FRAME_ANCESTORS);

      if (isPublicUploadPath(req.path)) return next();

      const absolutePath = `/uploads${req.path}`.split('?')[0];
      if (verifyUploadSignature(absolutePath, req.query?.exp, req.query?.sig)) {
        return next();
      }

      const token = extractAuthToken(req);
      if (!token) {
        return res
          .status(401)
          .json({ success: false, message: 'Authentication required for this file' });
      }
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (!roleMayAccessUpload(req.path, decoded)) {
          return res.status(403).json({ success: false, message: 'Not allowed to access this file' });
        }
        return next();
      } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
      }
    },
    express.static(join(__dirname, 'uploads')),
  );

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Expose-Headers', 'Set-Cookie');
      res.header('Vary', 'Origin');
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/health')) return next();
    if (req.path === '/ready' || req.path.startsWith('/ready')) return next();
    if (req.path === '/metrics' || req.path.startsWith('/metrics')) return next();
    if (mongoose.connection.readyState === 1) return next();
    res.setHeader('Retry-After', '3');
    return res.status(503).json({
      success: false,
      code: 'DB_RECONNECTING',
      message: 'Database is reconnecting. Please wait a few seconds and try again.',
      requestId: req.id,
    });
  });

  app.use('/api/health', healthRoutes);
  app.get('/api/ready', readyHandler);
  app.get('/api/metrics', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(
      renderPrometheusMetrics({
        mongoReady: mongoose.connection.readyState === 1,
      }),
    );
  });
  app.use(proxyRoutes);

  app.options(/^\/api\/.*/, (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.sendStatus(204);
  });

  app.use('/api', calendarPublicRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRouter);

  app.use('/api/super-admin', superAdminRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/teacher', teacherRoutes);
  app.use('/api/curriculum', curriculumRoutes);
  app.use('/api/ai-generator', aiGeneratorRoutes);
  app.use('/api/book-knowledge', bookKnowledgeRoutes);
  app.use('/api/book-generator', bookGeneratorRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api', streamRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api', pdfRagRoutes);
  app.use('/api', vidyaRoutes);
  app.use('/api', practiceProgressRoutes);
  app.use('/api', dashboardRoutes);
  app.use('/api/timetable', timetableRoutes);
  app.use(catalogRoutes);
  app.use('/api/lesson-plan', lessonPlanRoutes);
  app.use(legacyStubsRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      message: `No such endpoint: ${req.method} ${req.originalUrl}`,
      requestId: req.id,
    });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const status = Number(err?.status || err?.statusCode) || 500;
    const log = req.log || logger;

    log[status >= 500 ? 'error' : 'warn']('Request failed', {
      status,
      method: req.method,
      url: req.originalUrl,
      name: err?.name,
      message: err?.message,
      ...(status >= 500 ? { stack: err?.stack } : {}),
    });

    res.status(status).json({
      success: false,
      message:
        status >= 500 && nodeEnvEffective === 'production'
          ? 'Something went wrong. Please try again.'
          : err?.message || 'Request failed',
      requestId: req.id,
    });
  });

  return app;
}
