import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loginLimiter } from './middleware/rate-limit.js';
import { requestContext } from './middleware/request-context.js';
import { auditTrail } from './middleware/audit-trail.js';
import { logger } from './utils/logger.js';
import { loginSchema, validateRequest } from './validators/superAdminValidator.js';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename } from 'path';
import fs from 'fs';
import axios from 'axios';
import { cleanCsvCell } from './utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from './utils/spreadsheet-to-csv.js';
import { resolveUserDisplayBoard } from './constants/boards.js';
import {
  isVidyaEnabledForStudents,
  isVidyaEnabledForTeachers,
} from './utils/vidyaSchoolAccess.js';
import { configureMongoDns } from './config/mongo-dns.js';
import { MONGOOSE_CONNECT_OPTIONS, attachMongooseConnectionListeners } from './config/mongoose-options.js';
import {
  attachCookies,
  setAuthCookie,
  clearAuthCookie,
  extractAuthToken,
} from './utils/auth-cookie.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import models
import User from './models/User.js';
import Video from './models/Video.js';
import LearningPath from './models/LearningPath.js';
import Assessment from './models/Assessment.js';
import Teacher from './models/Teacher.js';
import Subject from './models/Subject.js';
import UserProgress from './models/UserProgress.js';
import Exam from './models/Exam.js';
import Question from './models/Question.js';
import ExamResult from './models/ExamResult.js';
import Event from './models/Event.js';

// Import routes
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
import { initPdfProcessingQueue } from './queues/pdfProcessingQueue.js';
import { startWeeklyImpactScheduler } from './services/weekly-impact-scheduler.js';
import { verifyToken, verifySuperAdmin, verifyAdmin, extractAdminId } from './middleware/auth.js';
import {
  getAssessments,
  getVideos,
  getQuizzes,
  getAnalytics,
} from './controllers/adminController.js';
import { getCalendarEvents, createCalendarEvent } from './controllers/calendarController.js';
import {
  listAiToolChildren,
  listAiToolRecords,
  getAiToolGenerationById,
  exportAiToolGenerationsBundle,
  getAiToolGenerationsMeta,
  getAiToolGenerationsBootstrap,
  updateAiToolGenerationById,
  deleteAiToolGenerationById,
} from './controllers/aiToolGenerationsController.js';
import {
  listSchoolOrders,
  getSchoolOrderById,
  createSchoolOrder,
  updateSchoolOrder,
  deleteSchoolOrder,
} from './controllers/schoolOrderController.js';
import {
  listOrderCatalog,
  createOrderCatalogProduct,
  updateOrderCatalogProduct,
  deleteOrderCatalogProduct,
} from './controllers/orderCatalogController.js';

const buildSafeAppendQuestionPipeline = (questionId) => [
  {
    $set: {
      questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] },
    },
  },
  {
    $set: {
      questions: { $concatArrays: ['$questions', [questionId]] },
    },
  },
];

const buildSafeRemoveQuestionPipeline = (questionId) => [
  {
    $set: {
      questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] },
    },
  },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'existingQuestionId',
          cond: { $ne: ['$$existingQuestionId', questionId] },
        },
      },
    },
  },
];

// Load environment variables - explicitly specify path
const envPath = join(__dirname, '.env');
const envResult = dotenv.config({ path: envPath });

// Debug: Log if .env file was found
if (envResult.error) {
  console.warn('⚠️  Warning: Could not load .env file:', envResult.error.message);
  console.warn('   Attempted path:', envPath);
} else {
  console.log('✅ Loaded .env file from:', envPath);
  // Debug: Check if MONGO_URI was loaded
  if (envResult.parsed) {
    const hasMongoUri = 'MONGO_URI' in envResult.parsed;
    console.log('📋 Environment variables loaded:', Object.keys(envResult.parsed).length);
    console.log('🔍 MONGO_URI in parsed env:', hasMongoUri);
    if (hasMongoUri) {
      const mongoUriValue = envResult.parsed.MONGO_URI;
      console.log('🔍 MONGO_URI value (first 30 chars):', mongoUriValue ? mongoUriValue.substring(0, 30) + '...' : 'EMPTY');
    }
  }
  // Also check process.env after dotenv loads
  console.log('🔍 MONGO_URI in process.env:', !!process.env.MONGO_URI);
  if (process.env.MONGO_URI) {
    console.log('🔍 process.env.MONGO_URI (first 30 chars):', process.env.MONGO_URI.substring(0, 30) + '...');
  }
}

/*
 * Required-secret check — fail fast, before anything can serve a request.
 *
 * JWT_SECRET used to fall back to a hardcoded string in 24 places across five
 * files (with two DIFFERENT defaults). A deploy that forgot it kept running and
 * signed tokens anyone could forge. Those fallbacks are gone, so an unset
 * JWT_SECRET would now throw at first use — deep inside a login request, as a
 * 500. Checking here turns that into an obvious startup failure instead.
 */
const REQUIRED_SECRETS = ['JWT_SECRET', 'MONGO_URI'];
const missingSecrets = REQUIRED_SECRETS.filter((k) => !String(process.env[k] || '').trim());
if (missingSecrets.length) {
  console.error(`\n❌ FATAL: required environment variable(s) missing: ${missingSecrets.join(', ')}`);
  console.error('   Set them in the environment. There are no defaults — that is deliberate.\n');
  process.exit(1);
}
if (String(process.env.JWT_SECRET).length < 16) {
  console.error('\n❌ FATAL: JWT_SECRET is shorter than 16 characters. Use a long random value.\n');
  process.exit(1);
}

const app = express();

// Match server log default: NODE unset → behave as production (see app.listen log).
const nodeEnvEffective = process.env.NODE_ENV || 'production';

// Nginx sets X-Forwarded-* — required for express-rate-limit & req.ip.
// 1) Prefer .env file (parsed): PM2 may inject TRUST_PROXY before Node; dotenv won't override it.
// 2) In production, if .env has no TRUST_* keys, do not read process.env (ignore PM2 false).
// 3) Unset NODE_ENV must not force trust off (previously NODE_ENV!==='production' → hop '0').
const parsedEnv = !envResult.error && envResult.parsed ? envResult.parsed : {};
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

const PORT = process.env.PORT || 5000;
initPdfProcessingQueue();
startWeeklyImpactScheduler();

// Configure multer for file uploads (MIME allow-list)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime === 'text/csv' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ok) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
});

// MongoDB connection - MUST be set in .env file
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  console.error('   Please set MONGO_URI in your .env file');
  console.error('   Current process.env keys:', Object.keys(process.env).filter(k => k.includes('MONGO')).join(', ') || 'none');
  process.exit(1);
}

// Log which database is being connected to (without showing password)
const uriForLogging = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
const dbName = MONGO_URI.split('/').pop()?.split('?')[0] || 'Unknown';
console.log('🔌 Connecting to MongoDB...');
console.log('📍 URI:', uriForLogging);
console.log('📦 Database:', dbName);

configureMongoDns();

// Fail buffered ops quickly while reconnecting (mongoose option, not driver).
mongoose.set('bufferTimeoutMS', 10_000);

mongoose.connect(MONGO_URI, MONGOOSE_CONNECT_OPTIONS)
.then(async () => {
  attachMongooseConnectionListeners(mongoose.connection);
  const dbName = mongoose.connection.db.databaseName;
  console.log('✅ Connected to MongoDB Atlas');
  console.log('📊 Database Name:', dbName);
  console.log('🔗 Connection State:', mongoose.connection.readyState === 1 ? 'Connected' : 'Not Connected');
  // Initialize boards (creates board structure only, no seed data)
  const { initializeBoards } = await import('./controllers/boardController.js');
  await initializeBoards();
  // Seed built-in IIT product tracks (Alpha / Beta / Gamma)
  try {
    const { ensureDefaultProductCategories } = await import('./constants/products.js');
    await ensureDefaultProductCategories();
  } catch (seedErr) {
    console.warn('Product category seed skipped:', seedErr?.message || seedErr);
  }
  try {
    const { ensureSubjectIndexes } = await import('./models/Subject.js');
    await ensureSubjectIndexes();
  } catch (idxErr) {
    console.warn('Subject index ensure skipped:', idxErr?.message || idxErr);
  }
  try {
    const { ensureAiToolTopicIndexes } = await import('./models/AiToolTopic.js');
    await ensureAiToolTopicIndexes();
  } catch (idxErr) {
    console.warn('AI tool topic index ensure skipped:', idxErr?.message || idxErr);
  }
  // Untagged IIT generations/topics were produced for Alpha before tracks existed.
  try {
    const { backfillLegacyIitContentToAlpha } = await import('./utils/backfill-legacy-alpha.js');
    await backfillLegacyIitContentToAlpha();
  } catch (bfErr) {
    console.warn('Legacy Alpha backfill skipped:', bfErr?.message || bfErr);
  }
})
.catch(err => console.error('❌ MongoDB connection error:', err));

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:5174', 
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  // New Vercel frontend URL
  'https://asli-frontend.vercel.app',
  // Custom domain (api subdomain included for tools / same-site checks)
  'https://aslilearn.ai',
  'https://www.aslilearn.ai',
  'https://api.aslilearn.ai',
  // Old Vercel URLs (keeping for backward compatibility)
  'https://alsi-stud-frontend-mf3r-ampkob5el-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-es6c3f5aq-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-ea1jir1t6-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-r50hrstmi-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-12gsssa10-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-gajkeubdu-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-hugnvpnzk-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-5i351br51-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-6p7vghuuv-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-9pn4j5v4f-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-18qclrtbv-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-mlmb076jn-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r-m8dmkdu86-akhilesh2006s-projects.vercel.app',
  'https://alsi-stud-frontend-mf3r.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

/*
 * Security headers. helmet was in package.json but had never been imported, so
 * no response carried HSTS, X-Frame-Options, X-Content-Type-Options or a
 * referrer policy.
 *
 * Mounted BEFORE cors so the headers apply to preflight responses too.
 *
 * contentSecurityPolicy is disabled: this process serves JSON to a separate
 * frontend origin plus some static/uploaded files, and a default-src 'self'
 * policy would need to be authored against the real asset origins first —
 * shipping a wrong CSP breaks pages silently. crossOriginResourcePolicy is
 * relaxed to cross-origin because the frontend is on a different domain and
 * must be able to load files served from /uploads.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  }),
);

// Assign a request id before anything else can log or fail, so every
// subsequent line — including the error handler — can be correlated.
app.use(requestContext);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow custom domain aslilearn.ai and ALL its subdomains (including www)
    if (origin && origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      return callback(null, true);
    }
    
    // Allow new Vercel frontend domain and its preview deployments
    // Matches: asli-frontend.vercel.app, asli-frontend-*.vercel.app, asli-frontend-*-*.vercel.app
    // This pattern matches all Vercel preview deployment URLs that start with "asli-frontend"
    if (origin && origin.match(/^https:\/\/asli-frontend(-[a-z0-9]+(-[a-z0-9]+)*)?(-[a-z0-9]+-akhilesh2006s-projects)?\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // More flexible pattern: match any subdomain starting with "asli-frontend" ending with ".vercel.app"
    // This catches all preview deployments including branch previews
    if (origin && origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // Allow any Vercel subdomain pattern for old project (backward compatibility)
    if (origin && origin.match(/^https:\/\/alsi-stud-frontend-mf3r-[a-z0-9]+-akhilesh2006s-projects\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // Allow the main old Vercel domain
    if (origin && origin.match(/^https:\/\/alsi-stud-frontend-mf3r\.vercel\.app$/)) {
      return callback(null, true);
    }

    // Allow localhost during local dev (with or without port)
    if (origin && (
      origin.match(/^http:\/\/localhost(:\d+)?$/) ||
      origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/) ||
      origin.match(/^http:\/\/localhost:(5173|4173|4174|3000|8080)$/)
    )) {
      return callback(null, true);
    }
    
    /*
     * DENY unknown origins.
     *
     * This previously ended with "in production, be more permissive to avoid
     * CORS issues" -> callback(null, true), plus a second catch-all that also
     * allowed. Every check above it was therefore decorative: any origin was
     * accepted, and with credentials: true set below, any website could issue
     * authenticated cross-origin requests using a logged-in user's session.
     *
     * Verified against the running server before this change:
     *     Origin: https://evil.example.com
     *     -> Access-Control-Allow-Origin: https://evil.example.com
     *
     * Blocked origins are logged loudly rather than silently, so a legitimate
     * frontend that is missing from the allowlist shows up in the logs as
     * "[CORS] BLOCKED" instead of failing mysteriously in the browser.
     */
    console.warn('[CORS] BLOCKED unrecognized origin:', origin);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Cookie',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
  maxAge: 86400
}));
// Match nginx uploads via multer; keep JSON bodies modest (files use multipart)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(attachCookies);
// Durable who/what/when audit for POST/PUT/PATCH/DELETE under /api
app.use('/api', auditTrail);

// Serve uploaded files — gate sensitive paths; school logos stay public for branding.
// Allow framing from the product site so textbook/PDF previews can embed /uploads
// (helmet defaults to X-Frame-Options: SAMEORIGIN which breaks aslilearn.ai → api embeds).
const TRUSTED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://aslilearn.ai https://www.aslilearn.ai https://*.vercel.app";

app.use('/uploads', (req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', TRUSTED_FRAME_ANCESTORS);

  const p = String(req.path || '').toLowerCase();
  const sensitive =
    /\/(reports?|risk|homework|submission|exam|orders\/documents|questions)\b/.test(p) ||
    p.includes('risk-analysis') ||
    p.includes('/homework');
  if (!sensitive) return next();

  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required for this file' });
  }
  try {
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}, express.static(join(__dirname, 'uploads')));

/*
 * CORS headers for all responses — ALLOWLISTED, not reflected.
 *
 * This previously read:
 *     res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
 *     res.header('Access-Control-Allow-Credentials', 'true');
 *
 * which echoed back WHATEVER Origin the caller sent, together with
 * credentials: true — silently defeating the cors() allowlist configured above,
 * because this middleware runs afterwards and overwrites its header.
 *
 * Verified against the running server before the fix:
 *     Origin: https://evil.example.com
 *     -> Access-Control-Allow-Origin: https://evil.example.com
 *
 * With credentials allowed, that let ANY site issue authenticated cross-origin
 * requests using a logged-in user's token. Now the origin is echoed only when
 * it is on the same allowlist cors() uses; unknown origins get no CORS header
 * at all and the browser blocks the response.
 */
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

// Simple health check endpoint for Nginx and frontend connectivity tests
app.get('/api/health', (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    status: mongoReady ? 'ok' : 'degraded',
    message: mongoReady
      ? 'AsliLearn backend is healthy'
      : 'Backend is up but database is reconnecting — retry shortly',
    mongo: mongoReady ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

// Fail fast while Mongo is reconnecting (avoids multi-minute hung requests → "Network error").
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/health')) return next();
  if (mongoose.connection.readyState === 1) return next();
  res.setHeader('Retry-After', '3');
  return res.status(503).json({
    success: false,
    code: 'DB_RECONNECTING',
    message: 'Database is reconnecting. Please wait a few seconds and try again.',
  });
});

// Proxy endpoint for external content (flipbooks, PDFs, etc.)
// Handle OPTIONS preflight
app.options('/api/proxy/content', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.get('/api/proxy/content', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(url);
      new URL(targetUrl); // Validate URL format
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Only allow specific domains for security
    const allowedDomains = ['epathshala.nic.in', 'ncert.nic.in', 'diksha.gov.in'];
    const urlObj = new URL(targetUrl);
    if (!allowedDomains.some(domain => urlObj.hostname.includes(domain))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log('Proxying content from:', targetUrl);

    // Determine if this is a PDF
    const isPDF = targetUrl.toLowerCase().endsWith('.pdf') || targetUrl.includes('.pdf');
    
    // Fetch the content - use arraybuffer for PDFs, text for HTML
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': isPDF ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': isPDF ? 'identity' : 'gzip, deflate, br', // Don't compress PDFs
        'Referer': targetUrl,
        'Cache-Control': 'no-cache'
      },
      maxRedirects: 10,
      timeout: 60000,
      responseType: isPDF ? 'arraybuffer' : 'text', // Use arraybuffer for PDFs
      validateStatus: (status) => status < 600 // Accept all status codes, we'll handle errors
    });

    // Check if request was successful
    if (response.status >= 400) {
      console.error(`Failed to fetch content: HTTP ${response.status}`);
      return res.status(response.status).json({ 
        error: 'Failed to fetch content',
        message: `Source server returned ${response.status}`,
        url: targetUrl
      });
    }

    // Get content type
    let contentType = response.headers['content-type'] || 'text/html';
    
    // If URL ends with .pdf, ensure content type is set correctly
    if (targetUrl.toLowerCase().endsWith('.pdf') || contentType.includes('pdf')) {
      contentType = 'application/pdf';
    }
    
    console.log('Content type:', contentType, 'Status:', response.status);

    // Set CORS and frame headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    
    // Handle PDF files - serve directly as binary
    if (contentType.includes('application/pdf') || contentType.includes('pdf') || isPDF) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${basename(urlObj.pathname)}"`);
      // Send PDF binary data (response.data is already arraybuffer for PDFs)
      res.send(Buffer.from(response.data));
      return;
    }
    
    // Modify HTML to fix relative URLs and remove frame-blocking
    if (contentType.includes('text/html')) {
      let html = response.data;
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
      const fullBaseUrl = baseUrl + basePath;
      
      // Add base tag to help with relative URLs
      if (!html.includes('<base')) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${fullBaseUrl}">`);
      }
      
      // Fix relative URLs to be absolute (more comprehensive)
      html = html.replace(/href=["'](\/[^"']+)["']/g, `href="${baseUrl}$1"`);
      html = html.replace(/src=["'](\/[^"']+)["']/g, `src="${baseUrl}$1"`);
      html = html.replace(/url\(["']?(\/[^"')]+)["']?\)/g, `url("${baseUrl}$1")`);
      html = html.replace(/action=["'](\/[^"']+)["']/g, `action="${baseUrl}$1"`);
      
      // For flipbooks, also fix relative paths that don't start with /
      html = html.replace(/href=["']([^"']+\.(css|js|png|jpg|gif|svg))["']/g, (match, path) => {
        if (!path.startsWith('http') && !path.startsWith('/')) {
          return `href="${fullBaseUrl}${path}"`;
        }
        return match;
      });
      html = html.replace(/src=["']([^"']+\.(css|js|png|jpg|gif|svg))["']/g, (match, path) => {
        if (!path.startsWith('http') && !path.startsWith('/')) {
          return `src="${fullBaseUrl}${path}"`;
        }
        return match;
      });
      
      // Remove X-Frame-Options meta tags and CSP that block framing
      html = html.replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      html = html.replace(/X-Frame-Options[^;]*;?/gi, '');
      
      // Remove scripts that check for framing
      html = html.replace(/if\s*\([^)]*top\s*!==\s*self[^)]*\)[^}]*}/gi, '');
      html = html.replace(/if\s*\([^)]*window\.top[^)]*\)[^}]*}/gi, '');
      html = html.replace(/window\.top\s*!==\s*window\.self/gi, 'true');
      html = html.replace(/self\s*!==\s*top/gi, 'false');
      
      // Add script to allow iframe embedding
      const allowFrameScript = `
        <script>
          try {
            if (window.parent !== window) {
              // We're in an iframe, allow it
              window.frameElement = window.frameElement || {};
            }
          } catch(e) {
            // Cross-origin, that's fine
          }
        </script>
      `;
      html = html.replace(/<head([^>]*)>/i, `<head$1>${allowFrameScript}`);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      res.setHeader('Content-Type', contentType);
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      url: req.query.url,
      status: error.response?.status,
      statusText: error.response?.statusText,
      headers: error.response?.headers
    });
    
    // If it's a 404 from the target server, return 404
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'Content not found',
        message: 'The requested content was not found on the source server'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch content',
      message: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : 'Network error'
    });
  }
});

// Health endpoint with CORS headers (handle both GET and OPTIONS)
app.get('/api/health', (req, res) => {
  const origin = req.headers.origin;
  
  // Always set CORS headers for health check
  if (origin) {
    // Allow aslilearn.ai and all subdomains
    if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/) ||
               origin.match(/^https:\/\/alsi-stud-frontend-mf3r.*\.vercel\.app$/) ||
               origin.match(/^http:\/\/localhost(:\d+)?$/) ||
               origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // In production, allow all origins for health check
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  res.status(200).json({ 
    status: 'ok', 
    env: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString(),
    server: 'aslilearn-backend'
  });
});

// Handle OPTIONS preflight for health endpoint
app.options('/api/health', (req, res) => {
  const origin = req.headers.origin;
  
  // Always allow preflight for health check
  if (origin) {
    // Allow aslilearn.ai and all subdomains
    if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin.match(/^https:\/\/asli-frontend.*\.vercel\.app$/) ||
               origin.match(/^https:\/\/alsi-stud-frontend-mf3r.*\.vercel\.app$/) ||
               origin.match(/^http:\/\/localhost(:\d+)?$/) ||
               origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // In production, allow all origins for health check
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// Handle CORS preflight for all API routes (Express does not treat '/api/*' as a glob)
app.options(/^\/api\/.*/, (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS, PATCH'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

// Auth routes (define before other routes to avoid conflicts)
// Logout endpoint - NO authentication required (allows logout even with expired/invalid tokens)
app.post('/api/auth/logout', (req, res) => {
  // For JWT-based auth, logout is handled client-side by removing the token
  // This endpoint just confirms the logout request
  // If using sessions, use req.logout()
  try {
    console.log('📤 Logout request received from:', req.headers.origin || 'unknown');
    
    // Handle CORS preflight if needed
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    if (req.logout && typeof req.logout === 'function') {
      // Session-based logout (if using sessions)
      req.logout((err) => {
        if (err) {
          console.error('Logout error:', err);
          return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        clearAuthCookie(res);
        res.json({ success: true, message: 'Logout successful' });
      });
    } else {
      // JWT-based logout — clear httpOnly cookie; client also drops localStorage token
      clearAuthCookie(res);
      res.json({ success: true, message: 'Logout successful' });
    }
  } catch (error) {
    console.error('Logout error:', error);
    clearAuthCookie(res);
    res.json({ success: true, message: 'Logout successful' });
  }
});

// JWT auth middleware (defined here so /api/auth/me can be registered before app.use('/api', ...))
const requireAuth = (req, res, next) => {
  const token = extractAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    req.isAuthenticated = () => true;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authenticated' });
  }
};
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admin access required' });
};

// GET /api/auth/me — must be registered BEFORE app.use('/api', ...) so it is not shadowed
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    console.log('Auth me requested by:', req.user?.email, 'Role:', req.user?.role);
    if (req.user && req.user.role === 'super-admin') {
      return res.json({
        user: {
          id: req.user.id || 'super-admin-001',
          _id: req.user.id || 'super-admin-001',
          email: req.user.email,
          fullName: req.user.fullName || 'Super Admin',
          role: 'super-admin',
          classNumber: null,
          assignedSubjects: [],
          assignedClass: null
        }
      });
    }
    const authId = req.user.userId || req.user.id;
    const { resolveIsAsliPrepExclusive } = await import('./utils/schoolProgram.js');

    // Teachers authenticate against the Teacher collection (JWT id = Teacher._id), not User.
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findById(authId).populate('subjects', 'name');
      if (teacher) {
        let teacherAdmin = null;
        if (teacher.adminId) {
          teacherAdmin = await User.findById(teacher.adminId)
            .select('board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents')
            .lean();
        }
        const teacherCtx = { board: teacher.board, isAsliPrepExclusive: false };
        const isAsliPrepExclusive = resolveIsAsliPrepExclusive(teacherCtx, teacherAdmin);
        const displayBoard = resolveUserDisplayBoard(teacherCtx, teacherAdmin);
        const curriculumBoard =
          teacherAdmin?.curriculumBoard ||
          (teacherAdmin?.board && teacherAdmin.board !== 'ASLI_EXCLUSIVE_SCHOOLS'
            ? teacherAdmin.board
            : '') ||
          (teacher.board && teacher.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? teacher.board : '') ||
          (displayBoard && displayBoard !== 'ASLI_EXCLUSIVE_SCHOOLS' ? displayBoard : '') ||
          'CBSE';
        const iitCategories = Array.isArray(teacherAdmin?.iitCategories)
          ? teacherAdmin.iitCategories
          : [];

        const teacherUserData = {
          id: teacher._id,
          _id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          classNumber: null,
          section: '',
          phone: teacher.phone || '',
          board: displayBoard || teacher.board || '',
          curriculumBoard,
          iitCategories,
          schoolName: teacherAdmin?.schoolName || teacher.school || '',
          schoolLogo: teacherAdmin?.schoolLogo || '',
          profilePhoto: '',
          assignedSubjects: [],
          assignedClass: null,
          studyStreak: { current: 0, longest: 0, lastActiveDate: '' },
          isAsliPrepExclusive,
          subjects: teacher.subjects || [],
          vidyaEnabled: isVidyaEnabledForTeachers(teacherAdmin),
          schoolName: teacherAdmin?.schoolName || teacher.school || teacher.schoolName || '',
          phone: teacher.phone || '',
          classNumber: teacher.classNumber || '',
          interestedCourses: teacher.interestedCourses || [],
          interestedSubjects: teacher.interestedSubjects || [],
          iitCategories: Array.isArray(teacher.iitCategories) && teacher.iitCategories.length
            ? teacher.iitCategories
            : iitCategories,
          isIndividualAccount: Boolean(teacher.isIndividualAccount),
          ...((await import('./utils/individualAccount.js')).resolveIndividualAccess(teacher)),
        };
        if (teacherAdmin) {
          teacherUserData.assignedAdmin = {
            board: teacherAdmin.board,
            curriculumBoard: teacherAdmin.curriculumBoard,
            isAsliPrepExclusive: teacherAdmin.isAsliPrepExclusive === true,
            iitCategories,
            schoolName: teacherAdmin.schoolName || '',
            schoolLogo: teacherAdmin.schoolLogo || '',
          };
        }
        return res.json({ user: teacherUserData });
      }
    }

    const user = await User.findById(authId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    await user.populate('assignedSubjects', 'name');
    await user.populate('assignedClass', 'classNumber section assignedSubjects');
    if (user.role === 'student' && user.assignedAdmin) {
      await user.populate(
        'assignedAdmin',
        'board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents'
      );
    }
    let teacherAdmin = null;
    if (user.role === 'teacher') {
      const teacher = await Teacher.findById(user._id).select('adminId').lean();
      if (teacher?.adminId) {
        teacherAdmin = await User.findById(teacher.adminId)
          .select('board curriculumBoard isAsliPrepExclusive iitCategories schoolName schoolLogo vidyaEnabledForTeachers vidyaEnabledForStudents')
          .lean();
      }
    }
    const displayBoard = resolveUserDisplayBoard(user, user.assignedAdmin || teacherAdmin);
    const isAsliPrepExclusive = resolveIsAsliPrepExclusive(
      user,
      user.role === 'student' ? user.assignedAdmin : teacherAdmin,
    );
    const resolvedIitCategories =
      Array.isArray(user.iitCategories) && user.iitCategories.length > 0
        ? user.iitCategories
        : Array.isArray(user.assignedAdmin?.iitCategories)
          ? user.assignedAdmin.iitCategories
          : Array.isArray(teacherAdmin?.iitCategories)
            ? teacherAdmin.iitCategories
            : [];
    const userData = {
      id: user._id,
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      classNumber: user.classNumber,
      section:
        user.assignedClass?.section != null && String(user.assignedClass.section).trim() !== ''
          ? String(user.assignedClass.section).trim()
          : '',
      phone: user.phone || '',
      age: user.age ?? 18,
      educationStream: user.educationStream || '',
      targetExam: user.targetExam || '',
      board: displayBoard || user.board || '',
      curriculumBoard:
        user.curriculumBoard ||
        user.assignedAdmin?.curriculumBoard ||
        (user.role === 'teacher' ? teacherAdmin?.curriculumBoard : null) ||
        (displayBoard && displayBoard !== 'ASLI_EXCLUSIVE_SCHOOLS' ? displayBoard : '') ||
        'CBSE',
      iitCategories: resolvedIitCategories,
      schoolName:
        user.schoolName ||
        user.assignedAdmin?.schoolName ||
        (user.role === 'teacher' ? teacherAdmin?.schoolName : '') ||
        '',
      schoolLogo:
        user.schoolLogo ||
        user.assignedAdmin?.schoolLogo ||
        (user.role === 'teacher' ? teacherAdmin?.schoolLogo : '') ||
        '',
      profilePhoto: user.profilePhoto || '',
      assignedSubjects: user.assignedSubjects || [],
      assignedClass: user.assignedClass || null,
      studyStreak: user.studyStreak || { current: 0, longest: 0, lastActiveDate: '' },
      isAsliPrepExclusive,
      interestedCourses: user.interestedCourses || [],
      interestedSubjects: user.interestedSubjects || [],
      isIndividualAccount: Boolean(user.isIndividualAccount),
      ...((await import('./utils/individualAccount.js')).resolveIndividualAccess(user)),
    };
    if (user.role === 'student') {
      userData.vidyaEnabled = isVidyaEnabledForStudents(user.assignedAdmin);
      if (user.assignedAdmin) {
        userData.assignedAdmin = {
          _id: user.assignedAdmin._id,
          board: user.assignedAdmin.board,
          curriculumBoard: user.assignedAdmin.curriculumBoard,
          isAsliPrepExclusive: user.assignedAdmin.isAsliPrepExclusive === true,
          iitCategories: Array.isArray(user.assignedAdmin.iitCategories)
            ? user.assignedAdmin.iitCategories
            : [],
          schoolName: user.assignedAdmin.schoolName || '',
          schoolLogo: user.assignedAdmin.schoolLogo || '',
        };
      }
    }
    if (req.user.role === 'admin') {
      userData.schoolName = user.schoolName || '';
      userData.schoolLogo = user.schoolLogo || '';
    }
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findById(authId).populate('subjects');
      if (teacher) userData.subjects = teacher.subjects || [];
      if (teacherAdmin) {
        userData.assignedAdmin = {
          board: teacherAdmin.board,
          curriculumBoard: teacherAdmin.curriculumBoard,
          isAsliPrepExclusive: teacherAdmin.isAsliPrepExclusive === true,
          iitCategories: Array.isArray(teacherAdmin.iitCategories)
            ? teacherAdmin.iitCategories
            : [],
          schoolName: teacherAdmin.schoolName || '',
          schoolLogo: teacherAdmin.schoolLogo || '',
        };
      }
      userData.vidyaEnabled = isVidyaEnabledForTeachers(teacherAdmin);
    }
    res.json({ user: userData });
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
});

/** Unfinished trial-only login quizzes for individual trial accounts (students). */
app.get('/api/auth/trial-login-quizzes', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'student') {
      return res.json({ success: true, data: [] });
    }
    const authId = req.user.userId || req.user.id;
    const student = await User.findById(authId);
    if (!student) {
      return res.json({ success: true, data: [] });
    }
    const { isTrialQuizAudience } = await import('./utils/individualAccount.js');
    if (!isTrialQuizAudience(student)) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuiz = (await import('./models/IQRankQuiz.js')).default;
    const IQRankQuizResult = (await import('./models/IQRankQuizResult.js')).default;

    const quizzes = await IQRankQuiz.find({
      isActive: true,
      trialOnly: true,
      promptOnLogin: true,
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const results = await IQRankQuizResult.find({
      userId: student._id,
      quizId: { $in: quizzes.map((q) => q._id) },
    })
      .select('quizId')
      .lean();
    const done = new Set(results.map((r) => String(r.quizId)));
    const pending = quizzes.filter((q) => !done.has(String(q._id)));

    res.json({ success: true, data: pending });
  } catch (error) {
    console.error('trial-login-quizzes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch trial login quizzes' });
  }
});

// Update current user's profile
app.patch('/api/users/:userId', requireAuth, async (req, res) => {
  try {
    // For security, always update the authenticated user, ignore path param
    const userId = req.user.userId || req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const allowedFields = ['fullName', 'email', 'age', 'educationStream', 'targetExam', 'phone', 'profilePhoto'];
    const updateData = {};
    for (const key of allowedFields) {
      if (key in req.body) {
        updateData[key] = req.body[key];
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Failed to update user profile:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile', error: error.message });
  }
});

// Calendar API — exams + holidays + custom (super-admin)
app.get('/api/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
app.post('/api/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);
// Same handlers under /api/super-admin (avoids 404 if sub-router order/load differs)
app.get('/api/super-admin/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
app.post('/api/super-admin/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);

// AI tool generations — register on app before /api/super-admin router (avoids 404 if sub-router order/load differs)
app.get('/api/super-admin/ai-tool-generations/bootstrap', verifyToken, verifySuperAdmin, getAiToolGenerationsBootstrap);
app.get('/api/super-admin/ai-tool-generations/meta', verifyToken, verifySuperAdmin, getAiToolGenerationsMeta);
app.get('/api/super-admin/ai-tool-generations/children', verifyToken, verifySuperAdmin, listAiToolChildren);
app.get('/api/super-admin/ai-tool-generations/records', verifyToken, verifySuperAdmin, listAiToolRecords);
app.get('/api/super-admin/ai-tool-generations/export-bundle', verifyToken, verifySuperAdmin, exportAiToolGenerationsBundle);
app.get('/api/super-admin/ai-tool-generations/document/:id', verifyToken, verifySuperAdmin, getAiToolGenerationById);
app.patch('/api/super-admin/ai-tool-generations/document/:id', verifyToken, verifySuperAdmin, updateAiToolGenerationById);
app.delete('/api/super-admin/ai-tool-generations/document/:id', verifyToken, verifySuperAdmin, deleteAiToolGenerationById);

// School orders — register on app before /api/super-admin router (avoids 404 on PUT/DELETE)
app.get('/api/super-admin/orders', verifyToken, verifySuperAdmin, listSchoolOrders);
app.get('/api/super-admin/orders/:id', verifyToken, verifySuperAdmin, getSchoolOrderById);
app.post('/api/super-admin/orders/draft', verifyToken, verifySuperAdmin, createSchoolOrder);
app.post('/api/super-admin/orders', verifyToken, verifySuperAdmin, createSchoolOrder);
app.put('/api/super-admin/orders/:id', verifyToken, verifySuperAdmin, updateSchoolOrder);
app.delete('/api/super-admin/orders/:id', verifyToken, verifySuperAdmin, deleteSchoolOrder);

app.get('/api/super-admin/order-catalog', verifyToken, verifySuperAdmin, listOrderCatalog);
app.post('/api/super-admin/order-catalog', verifyToken, verifySuperAdmin, createOrderCatalogProduct);
app.put('/api/super-admin/order-catalog/:id', verifyToken, verifySuperAdmin, updateOrderCatalogProduct);
app.delete('/api/super-admin/order-catalog/:id', verifyToken, verifySuperAdmin, deleteOrderCatalogProduct);

// Admin content GET APIs — register before /api/admin router (avoids 404 on older deployments)
app.get('/api/admin/assessments', verifyToken, verifyAdmin, extractAdminId, getAssessments);
app.get('/api/admin/videos', verifyToken, verifyAdmin, extractAdminId, getVideos);
app.get('/api/admin/quizzes', verifyToken, verifyAdmin, extractAdminId, getQuizzes);
app.get('/api/admin/analytics', verifyToken, verifyAdmin, extractAdminId, getAnalytics);

// Public: active IIT product categories (for register + pickers; no secrets)
app.get('/api/product-categories', async (req, res) => {
  try {
    const { listProductCategories, PRODUCT_IIT, formatIitCategoryLabel } = await import(
      './constants/products.js'
    );
    const product = String(req.query.product || '').toUpperCase().trim();
    const rows = await listProductCategories({ includeInactive: false, product: product || null });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: String(r._id),
        code: r.code,
        label: r.label || formatIitCategoryLabel(r.code),
        product: r.product || PRODUCT_IIT,
        description: r.description || '',
        isActive: true,
        isBuiltIn: Boolean(r.isBuiltIn),
        sortOrder: r.sortOrder ?? 100,
      })),
    });
  } catch (error) {
    console.error('GET /api/product-categories:', error);
    res.status(500).json({ success: false, message: 'Failed to load product categories' });
  }
});

// Mount routes
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/ai-generator', aiGeneratorRoutes);
app.use('/api/book-knowledge', bookKnowledgeRoutes);
app.use('/api/book-generator', bookGeneratorRoutes);
// Student routes before generic /api mount so other routers cannot shadow /api/student/*
app.use('/api/student', studentRoutes);
app.use('/api', streamRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', pdfRagRoutes);
app.use('/api', vidyaRoutes);
app.use('/api', practiceProgressRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/timetable', timetableRoutes);

/*
 * Session middleware REMOVED (July 2026) — it was dead weight carrying three
 * production defects:
 *
 *   1. `secret: process.env.SESSION_SECRET || 'your-secret-key'` and
 *      SESSION_SECRET was never set, so cookies were being signed with a
 *      publicly-known default string. Anyone could forge a session cookie.
 *   2. `httpOnly: false` exposed the cookie to any script on the page, and
 *      `secure: false` allowed it over plain HTTP.
 *   3. `resave: true` + `saveUninitialized: true` on the default MemoryStore
 *      created and re-wrote a session for EVERY visitor, including anonymous
 *      ones — unbounded memory growth, and not shared across instances.
 *
 * None of it was in use: authentication is JWT-based (req.user is set by
 * verifyToken in middleware/auth.js), `req.session` is never read anywhere in
 * the codebase, and `passport.authenticate` / `req.login` are never called.
 * passport.session() also requires session middleware, so it goes with it.
 *
 * passport.initialize() is retained only because the LocalStrategy and
 * serialize/deserialize handlers below still reference passport; they are
 * likewise unused and can be deleted in a follow-up.
 */
app.use(passport.initialize());

// Passport strategies
passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  try {
    // Check Teacher model first
    const teacher = await Teacher.findOne({ email });
    
    if (teacher) {
      const isValidPassword = await bcrypt.compare(password, teacher.password);
      
      if (isValidPassword) {
        // Update last login
        teacher.lastLogin = new Date();
        await teacher.save();
        
        // Convert teacher to user format for session
        const teacherUser = {
          _id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          isActive: teacher.isActive
        };
        
        return done(null, teacherUser);
      }
    }

    // Regular user authentication
    const user = await User.findOne({ email });
    
    if (!user) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return done(null, false, { message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return done(null, user);
  } catch (error) {
    return done(error);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // First try to find in User model
    let user = await User.findById(id);
    if (user) {
      return done(null, user);
    }
    
    // If not found in User model, try Teacher model
    const teacher = await Teacher.findById(id);
    if (teacher) {
      // Convert teacher to user format for session
      const teacherUser = {
        _id: teacher._id,
        email: teacher.email,
        fullName: teacher.fullName,
        role: 'teacher',
        isActive: teacher.isActive
      };
      return done(null, teacherUser);
    }
    
    // If not found in either model
    done(null, false);
  } catch (error) {
    done(error);
  }
});

// Routes (requireAuth/requireAdmin defined earlier, before mount)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication routes — individual teacher/student signup (B2C)
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      normalizeIndividualSignupBody,
      resolveIndividualAccess,
    } = await import('./utils/individualAccount.js');
    const parsed = normalizeIndividualSignupBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }
    const d = parsed.data;

    const existingUser = await User.findOne({ email: d.email });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }
    const existingTeacher = await Teacher.findOne({ email: d.email });
    if (existingTeacher) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(d.password, 12);
    const trialFields = {
      isIndividualAccount: true,
      schoolName: d.schoolName,
      phone: d.phone,
      classNumber: d.classNumber || 'Unassigned',
      curriculumBoard: d.curriculumBoard,
      board: d.isAsliPrepExclusive ? 'ASLI_EXCLUSIVE_SCHOOLS' : d.curriculumBoard,
      isAsliPrepExclusive: d.isAsliPrepExclusive,
      iitCategories: d.iitCategories,
      interestedCourses: d.interestedCourses,
      interestedSubjects: d.interestedSubjects,
      subscriptionStatus: 'trial',
      trialStartsAt: d.trialStartsAt,
      trialEndsAt: d.trialEndsAt,
    };

    if (d.role === 'teacher') {
      const teacher = new Teacher({
        email: d.email,
        password: hashedPassword,
        fullName: d.fullName,
        phone: d.phone,
        school: d.schoolName,
        schoolName: d.schoolName,
        board: trialFields.board,
        curriculumBoard: d.curriculumBoard,
        classNumber: d.classNumber,
        iitCategories: d.iitCategories,
        interestedCourses: d.interestedCourses,
        interestedSubjects: d.interestedSubjects,
        isIndividualAccount: true,
        subscriptionStatus: 'trial',
        trialStartsAt: d.trialStartsAt,
        trialEndsAt: d.trialEndsAt,
        adminId: null,
        isActive: true,
        role: 'teacher',
      });
      await teacher.save();

      const access = resolveIndividualAccess(teacher);
      return res.status(201).json({
        message: `Account created. Your ${d.trialDays}-day free trial has started.`,
        user: {
          id: teacher._id,
          email: teacher.email,
          fullName: teacher.fullName,
          role: 'teacher',
          schoolName: teacher.schoolName,
          phone: teacher.phone,
          classNumber: teacher.classNumber,
          interestedCourses: teacher.interestedCourses,
          interestedSubjects: teacher.interestedSubjects,
          iitCategories: teacher.iitCategories,
          ...access,
        },
      });
    }

    const newUser = new User({
      email: d.email,
      password: hashedPassword,
      fullName: d.fullName,
      role: 'student',
      assignedAdmin: null,
      ...trialFields,
      isActive: true,
    });
    await newUser.save();

    const access = resolveIndividualAccess(newUser);
    return res.status(201).json({
      message: `Account created. Your ${d.trialDays}-day free trial has started.`,
      user: {
        id: newUser._id,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        schoolName: newUser.schoolName,
        phone: newUser.phone,
        classNumber: newUser.classNumber,
        interestedCourses: newUser.interestedCourses,
        interestedSubjects: newUser.interestedSubjects,
        iitCategories: newUser.iitCategories,
        ...access,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle CORS preflight requests
app.options('/api/auth/login', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.post('/api/auth/login', loginLimiter, validateRequest(loginSchema), async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected. Connection state:', mongoose.connection.readyState);
      return res.status(503).json({ message: 'Database not connected. Please try again.' });
    }
    
    // Check if body is parsed
    if (!req.body) {
      return res.status(400).json({ message: 'Invalid request body' });
    }
    
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '').trim();
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Authenticate against DB only (no hardcoded credential backdoors)
    let teacher = null;
    try {
      teacher = await Teacher.findOne({ email: email.toLowerCase() });
    } catch (teacherError) {
      console.error('Error querying Teacher model:', teacherError);
      // Continue to user check if teacher query fails
    }
    
    if (teacher) {
      console.log('Teacher found:', teacher.email, 'Active:', teacher.isActive);
      const isValidPassword = await bcrypt.compare(password, teacher.password || '');
      
      if (isValidPassword && teacher.isActive) {
        // Update last login
        teacher.lastLogin = new Date();
        const { resolveIndividualAccess } = await import('./utils/individualAccount.js');
        const teacherAccess = resolveIndividualAccess(teacher);
        if (teacher.isIndividualAccount && teacherAccess.paymentRequired && teacher.subscriptionStatus === 'trial') {
          teacher.subscriptionStatus = 'expired';
        }
        await teacher.save();
        
        const token = jwt.sign(
          { 
            userId: teacher._id.toString(),
            id: teacher._id.toString(),
            email: teacher.email, 
            role: 'teacher' 
          }, process.env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
        setAuthCookie(res, token);

        // Fetch teacher subjects if needed
        let subjects = [];
        try {
          const teacherWithSubjects = await Teacher.findById(teacher._id).populate('subjects');
          if (teacherWithSubjects && teacherWithSubjects.subjects) {
            subjects = teacherWithSubjects.subjects;
          }
        } catch (err) {
          console.log('Error fetching teacher subjects:', err);
        }
        
        return res.json({
          success: true,
          token,
          user: {
            id: teacher._id.toString(),
            _id: teacher._id.toString(),
            email: teacher.email,
            fullName: teacher.fullName,
            role: 'teacher',
            subjects: subjects,
            schoolName: teacher.schoolName || teacher.school || '',
            phone: teacher.phone || '',
            classNumber: teacher.classNumber || '',
            interestedCourses: teacher.interestedCourses || [],
            interestedSubjects: teacher.interestedSubjects || [],
            iitCategories: teacher.iitCategories || [],
            isIndividualAccount: Boolean(teacher.isIndividualAccount),
            ...teacherAccess,
          }
        });
      }
    }

    // Regular user authentication
    let user = null;
    try {
      user = await User.findOne({ email: email.toLowerCase() });
    } catch (userError) {
      console.error('Error querying User model:', userError);
      throw userError; // Re-throw if User query fails
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'User not found'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password || '');
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    if (!user.isActive) {
      console.log(`Login failed: Account ${user.email} is deactivated`);
      return res.status(401).json({ 
        success: false,
        message: 'Account is deactivated',
        hint: 'Please contact administrator'
      });
    }

    // Update last login without triggering full document validation (avoids board enum validation)
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() }, { runValidators: false });

    const { resolveIndividualAccess } = await import('./utils/individualAccount.js');
    const access = resolveIndividualAccess(user);
    if (user.isIndividualAccount && access.paymentRequired && user.subscriptionStatus === 'trial') {
      await User.findByIdAndUpdate(
        user._id,
        { subscriptionStatus: 'expired' },
        { runValidators: false }
      );
    }

    const token = jwt.sign(
      { 
        userId: user._id.toString(),
        id: user._id.toString(),
        email: user.email, 
        role: user.role 
      }, process.env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
    setAuthCookie(res, token);

    res.json({ 
      success: true,
      token,
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        schoolName: user.schoolName || '',
        phone: user.phone || '',
        classNumber: user.classNumber || '',
        interestedCourses: user.interestedCourses || [],
        interestedSubjects: user.interestedSubjects || [],
        iitCategories: user.iitCategories || [],
        isIndividualAccount: Boolean(user.isIndividualAccount),
        ...access,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Internal server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Public routes
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.get('/api/learning-paths', async (req, res) => {
  try {
    const paths = await LearningPath.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(paths);
  } catch (error) {
    console.error('Failed to fetch learning paths:', error);
    res.status(500).json({ message: 'Failed to fetch learning paths' });
  }
});

app.get('/api/assessments', async (req, res) => {
  try {
    const assessments = await Assessment.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(assessments);
  } catch (error) {
    console.error('Failed to fetch assessments:', error);
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Admin routes (protected) — fail closed in every environment
app.use('/api/admin', requireAuth, requireAdmin);

// Admin video management
app.post('/api/admin/videos', async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, duration, subjectId, difficulty } = req.body;
    
    const newVideo = new Video({
      title,
      description,
      videoUrl,
      thumbnailUrl,
      duration,
      subjectId,
      difficulty
    });

    await newVideo.save();
    res.status(201).json(newVideo);
  } catch (error) {
    console.error('Failed to create video:', error);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.put('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedVideo = await Video.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedVideo) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json(updatedVideo);
  } catch (error) {
    console.error('Failed to update video:', error);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

app.delete('/api/admin/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedVideo = await Video.findByIdAndDelete(id);

    if (!deletedVideo) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Failed to delete video:', error);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

// Admin learning path management
app.post('/api/admin/learning-paths', async (req, res) => {
  try {
    const { title, description, subjectIds, difficulty, estimatedHours, videoIds } = req.body;
    
    const newPath = new LearningPath({
      title,
      description,
      subjectIds,
      difficulty,
      estimatedHours,
      videoIds: videoIds || []
    });

    await newPath.save();
    res.status(201).json(newPath);
  } catch (error) {
    console.error('Failed to create learning path:', error);
    res.status(500).json({ message: 'Failed to create learning path' });
  }
});

app.put('/api/admin/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updatedPath = await LearningPath.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json(updatedPath);
  } catch (error) {
    console.error('Failed to update learning path:', error);
    res.status(500).json({ message: 'Failed to update learning path' });
  }
});

app.delete('/api/admin/learning-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedPath = await LearningPath.findByIdAndDelete(id);

    if (!deletedPath) {
      return res.status(404).json({ message: 'Learning path not found' });
    }

    res.json({ message: 'Learning path deleted successfully' });
  } catch (error) {
    console.error('Failed to delete learning path:', error);
    res.status(500).json({ message: 'Failed to delete learning path' });
  }
});

// Event photo upload storage
const eventPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    cb(null, 'event-' + uniqueSuffix + ext);
  }
});

const eventPhotoUpload = multer({ 
  storage: eventPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (increased from 5MB)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Admin event management
// GET all events
app.get('/api/admin/events', async (req, res) => {
  try {
    // Validate user
    if (!req.user || (!req.user._id && !req.user.id)) {
      console.error('GET /api/admin/events - User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user or skip the query
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID:', userId);
      } else {
        // No admin users found, return empty array
        console.log('No admin users found, returning empty events array');
        return res.json([]);
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('GET /api/admin/events - Fetching events for user:', userId);
    
    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }
    
    // Use ObjectId for proper matching
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;
    
    const events = await Event.find({ createdBy: userObjectId })
      .sort({ date: 1 });
    
    console.log(`GET /api/admin/events - Found ${events.length} events for user ${userId}`);
    res.json(events);
  } catch (error) {
    console.error('GET /api/admin/events - Failed to fetch events:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Failed to fetch events',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST create event
app.post('/api/admin/events', (req, res, next) => {
  eventPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          message: 'File too large. Maximum size is 10MB.' 
        });
      }
      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({ 
          message: 'Only image files are allowed.' 
        });
      }
      return res.status(500).json({ 
        message: 'File upload error',
        error: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Event creation request received:', {
      body: req.body,
      hasFile: !!req.file,
      user: req.user ? { 
        userId: req.user.userId, 
        _id: req.user._id, 
        id: req.user.id, 
        email: req.user.email,
        role: req.user.role 
      } : 'No user'
    });

    const { name, date, description } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Event name is required' });
    }
    
    if (!date) {
      return res.status(400).json({ message: 'Event date is required' });
    }

    // Validate date format - parse as local date to avoid timezone issues
    // Date string format: YYYY-MM-DD
    let eventDate;
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Parse as local date (not UTC) to preserve the exact date
      const [year, month, day] = date.split('-').map(Number);
      eventDate = new Date(year, month - 1, day);
    } else {
      eventDate = new Date(date);
    }
    
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    
    console.log('Event date parsed:', {
      inputDate: date,
      parsedDate: eventDate,
      year: eventDate.getFullYear(),
      month: eventDate.getMonth() + 1,
      day: eventDate.getDate()
    });

    // Validate user
    if (!req.user) {
      console.error('User not found in request:', req.user);
      return res.status(401).json({ message: 'Unauthorized: User not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    console.log('Initial userId from JWT:', userId, 'Type:', typeof userId, 'Email:', req.user.email);
    
    // If userId is not a valid ObjectId, try to find user by email
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.log('userId is not a valid ObjectId, looking up user by email:', req.user.email);
      if (!req.user.email) {
        return res.status(400).json({ message: 'User email not found in token' });
      }
      
      try {
        // Try to find user by email - try multiple approaches
        const emailLower = req.user.email.toLowerCase().trim();
        
        // First try: exact lowercase match
        let user = await User.findOne({ 
          email: emailLower,
          role: 'admin'
        });
        
        // Second try: case-insensitive with regex (if first fails)
        if (!user) {
          user = await User.findOne({ 
            email: { $regex: new RegExp(`^${emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            role: 'admin'
          });
        }
        
        // Third try: find any user with this email, then check role
        if (!user) {
          const anyUser = await User.findOne({ email: emailLower });
          if (anyUser && anyUser.role === 'admin') {
            user = anyUser;
          }
        }
        
        if (user) {
          userId = user._id;
          console.log('Found admin user from email for event creation:', user.email, 'ID:', userId);
        } else {
          console.error('Could not find admin user with email:', req.user.email);
          // List all admin emails for debugging
          const allAdmins = await User.find({ role: 'admin' }).select('email');
          console.log('Available admin emails:', allAdmins.map(a => a.email));
          return res.status(404).json({ 
            message: `Admin user not found with email: ${req.user.email}`,
            availableAdmins: allAdmins.map(a => a.email)
          });
        }
      } catch (dbError) {
        console.error('Database error while looking up user:', dbError);
        console.error('Error name:', dbError.name);
        console.error('Error message:', dbError.message);
        console.error('Error stack:', dbError.stack);
        return res.status(500).json({ 
          message: 'Database error while looking up user', 
          error: dbError.message,
          errorName: dbError.name
        });
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    // In this case, we need to find a real admin user
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      // Find the first admin user in the database
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event creation:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format after processing:', userId, 'Type:', typeof userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    console.log('Final userId for event creation:', userId, 'Type:', typeof userId);

    // Ensure uploads/events directory exists
    const eventsUploadDir = join(__dirname, 'uploads', 'events');
    if (!fs.existsSync(eventsUploadDir)) {
      fs.mkdirSync(eventsUploadDir, { recursive: true });
    }
    
    let photoUrl = '';
    if (req.file) {
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    // Check if Event model is available
    if (!Event) {
      console.error('Event model is not available');
      return res.status(500).json({ message: 'Event model not available' });
    }

    // Ensure userId is converted to ObjectId
    const createdByObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;

    console.log('Creating event with createdBy:', createdByObjectId.toString(), 'Type:', typeof createdByObjectId, 'for user:', userId);

    const newEvent = new Event({
      name: name.trim(),
      date: new Date(date),
      description: description || '',
      photo: photoUrl,
      createdBy: createdByObjectId
    });
    
    console.log('Event object before save:', {
      name: newEvent.name,
      date: newEvent.date,
      createdBy: newEvent.createdBy.toString(),
      createdByType: typeof newEvent.createdBy
    });

    const savedEvent = await newEvent.save();
    console.log('Event created successfully:', {
      eventId: savedEvent._id,
      name: savedEvent.name,
      createdBy: savedEvent.createdBy.toString(),
      date: savedEvent.date
    });
    res.status(201).json(savedEvent);
  } catch (error) {
    console.error('Failed to create event - Full error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to create event', 
      error: error.message,
      errorName: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// PUT update event
app.put('/api/admin/events/:id', eventPhotoUpload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, description } = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
      }
    }
    
    // Handle development mode
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
      }
    }
    
    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to update this event' });
    }

    let photoUrl = event.photo;
    if (req.file) {
      // Delete old photo if exists
      if (event.photo) {
        const oldPhotoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
        const fullPath = join(__dirname, oldPhotoPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${req.file.filename}`;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      {
        name,
        date: new Date(date),
        description: description || '',
        photo: photoUrl,
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json(updatedEvent);
  } catch (error) {
    console.error('Failed to update event:', error);
    res.status(500).json({ message: 'Failed to update event', error: error.message });
  }
});

// DELETE event
app.delete('/api/admin/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Get user ID from JWT payload (could be userId, _id, or id)
    let userId = req.user.userId || req.user._id || req.user.id;
    
    // If userId is in JWT but we need the actual user document, fetch it
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      // Try to find user by email if userId is not a valid ObjectId
      const user = await User.findOne({ 
        $or: [
          { email: req.user.email },
          { _id: userId }
        ],
        role: 'admin'
      });
      if (user) {
        userId = user._id;
        console.log('Found admin user from email for event deletion:', user.email, 'ID:', userId);
      }
    }
    
    // Handle development mode where userId might be a string like 'dev-admin'
    if (typeof userId === 'string' && userId.startsWith('dev-')) {
      console.log('Development mode detected, finding real admin user...');
      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        userId = adminUser._id;
        console.log('Using admin user ID for event deletion:', userId);
      } else {
        return res.status(400).json({ message: 'No admin user found in database' });
      }
    }
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid user ID format:', userId);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Check if user owns this event
    if (event.createdBy.toString() !== userId.toString()) {
      console.error('User does not own this event:', {
        eventCreatedBy: event.createdBy.toString(),
        userId: userId.toString()
      });
      return res.status(403).json({ message: 'Unauthorized to delete this event' });
    }

    // Delete photo if exists
    if (event.photo) {
      const photoPath = event.photo.replace(`${req.protocol}://${req.get('host')}`, '');
      const fullPath = join(__dirname, photoPath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await Event.findByIdAndDelete(id);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Failed to delete event:', error);
    res.status(500).json({ message: 'Failed to delete event', error: error.message });
  }
});

// Super Admin: Get events by admin ID (read-only view)
app.get('/api/super-admin/events/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    console.log('Super admin fetching events for adminId:', adminId);
    
    // Validate adminId format
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      console.error('Invalid adminId format:', adminId);
      return res.status(400).json({ message: 'Invalid admin ID format' });
    }
    
    // Convert to ObjectId for proper matching
    const adminObjectId = new mongoose.Types.ObjectId(adminId);
    
    // Verify admin exists
    const admin = await User.findById(adminObjectId);
    if (!admin) {
      console.error('Admin not found with ID:', adminId);
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    if (admin.role !== 'admin') {
      console.error('User is not an admin:', admin.role);
      return res.status(403).json({ message: 'User is not an admin' });
    }

    console.log('Admin found:', admin.email, admin.fullName, 'ID:', admin._id);
    console.log('Searching for events with createdBy:', adminObjectId.toString());
    
    // Fetch all events and filter to ensure proper scoping
    // First, get all events to debug
    const allEvents = await Event.find({}).sort({ date: 1 });
    console.log(`Total events in database: ${allEvents.length}`);
    
    // Log all events' createdBy values for debugging
    if (allEvents.length > 0) {
      console.log('All events createdBy values:', allEvents.map(e => ({
        eventId: e._id,
        eventName: e.name,
        createdBy: e.createdBy ? e.createdBy.toString() : 'null',
        createdByMatches: e.createdBy ? e.createdBy.toString() === adminObjectId.toString() : false
      })));
    }
    
    // Fetch events created by this specific admin using strict ObjectId matching
    // Try multiple query approaches to ensure we get the right events
    const events = await Event.find({ 
      createdBy: adminObjectId 
    }).sort({ date: 1 });
    
    // Also try string comparison as a fallback
    const eventsByString = await Event.find({}).sort({ date: 1 }).then(evts => 
      evts.filter(e => e.createdBy && e.createdBy.toString() === adminObjectId.toString())
    );
    
    // Use the ObjectId query result, but log both for comparison
    console.log(`Found ${events.length} events using ObjectId query for admin ${admin.email} (ID: ${adminId})`);
    console.log(`Found ${eventsByString.length} events using string comparison`);
    
    // Ensure we only return events that match
    const finalEvents = events.filter(e => {
      const matches = e.createdBy && e.createdBy.toString() === adminObjectId.toString();
      if (!matches && e.createdBy) {
        console.warn(`Event ${e._id} (${e.name}) createdBy ${e.createdBy.toString()} does not match admin ${adminObjectId.toString()}`);
      }
      return matches;
    });
    
    console.log(`Returning ${finalEvents.length} events for admin ${admin.email}`);
    
    res.json(finalEvents);
  } catch (error) {
    console.error('Failed to fetch events:', error);
    res.status(500).json({ 
      message: 'Failed to fetch events', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Admin assessment management
app.post('/api/admin/assessments', async (req, res) => {
  try {
    const { title, description, questions, subjectIds, difficulty, duration } = req.body;
    
    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds,
      difficulty,
      duration,
      totalPoints
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

app.put('/api/admin/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Recalculate total points if questions are updated
    if (updates.questions) {
      updates.totalPoints = updates.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }
    
    const updatedAssessment = await Assessment.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedAssessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    res.json(updatedAssessment);
  } catch (error) {
    console.error('Failed to update assessment:', error);
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

app.delete('/api/admin/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedAssessment = await Assessment.findByIdAndDelete(id);

    if (!deletedAssessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }

    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    res.status(500).json({ message: 'Failed to delete assessment' });
  }
});

// Admin user management
app.get('/api/admin/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const adminId = decoded.userId;

    // Only return students assigned to this admin
    const users = await User.find({ 
      role: 'student',
      assignedAdmin: adminId 
    }).select('-password').sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const adminId = decoded.userId;

    const { email, password, fullName, classNumber, phone, role = 'student', isActive = true } = req.body;
    
    // Validate required fields for students
    if (role === 'student' && (!fullName || !email || !classNumber)) {
      return res.status(400).json({ 
        success: false,
        message: 'Full name, email, and class number are required for students' 
      });
    }
    
    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    if (role === 'student' && !admin.board) {
      return res.status(400).json({ success: false, message: 'Admin must have a board assigned' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);

    // Create user and assign to this admin
    const newUser = new User({
      email,
      password: hashedPassword,
      fullName,
      classNumber: role === 'student' ? classNumber.trim() : undefined,
      phone: phone || '',
      role,
      board: role === 'student' ? (admin.board || null) : undefined,
      schoolName: role === 'student' ? (admin.schoolName || '') : undefined,
      isActive,
      assignedAdmin: adminId  // Assign to the logged-in admin
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      id: newUser._id,
      email: newUser.email,
      fullName: newUser.fullName,
      classNumber: newUser.classNumber,
      phone: newUser.phone,
      board: newUser.board,
      schoolName: newUser.schoolName,
      role: newUser.role,
      isActive: newUser.isActive,
      assignedAdmin: newUser.assignedAdmin
    });
  } catch (error) {
    console.error('Failed to create user:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create user';
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${Object.values(error.errors).map((e) => e.message).join(', ')}`;
    } else if (error.code === 11000) {
      // Duplicate key error (MongoDB)
      errorMessage = 'A user with this email already exists';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Hash password if provided
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 12);
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      id, 
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Failed to update user:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Delete all students endpoint - MUST be before /:id route
app.delete('/api/admin/users/delete-all', async (req, res) => {
  try {
    // Delete all users with role 'student'
    const result = await User.deleteMany({ role: 'student' });
    
    res.json({ 
      message: `Successfully deleted ${result.deletedCount} students`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Failed to delete all students:', error);
    res.status(500).json({ message: 'Failed to delete all students' });
  }
});

// Teacher management endpoints
app.get('/api/admin/teachers', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const adminId = decoded.userId;

    // Only return teachers assigned to this admin
    const teachers = await Teacher.find({ adminId })
      .populate('subjects')
      .select('-password')
      .sort({ createdAt: -1 });
    
    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No teachers found in database',
        data: []
      });
    }
    
    // Transform the data to include assignedClassIds
    const transformedTeachers = teachers.map(teacher => ({
      _id: teacher._id,
      id: teacher._id,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      department: teacher.department,
      qualifications: teacher.qualifications,
      subjects: teacher.subjects || [],
      assignedClassIds: teacher.assignedClassIds || [],
      role: teacher.role,
      isActive: teacher.isActive,
      createdAt: teacher.createdAt,
      updatedAt: teacher.updatedAt
    }));
    
    res.json(transformedTeachers);
  } catch (error) {
    console.error('Failed to fetch teachers:', error);
    res.status(500).json({ message: 'Failed to fetch teachers' });
  }
});

app.post('/api/admin/teachers', async (req, res) => {
  try {
    // Get admin ID from JWT token
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const adminId = decoded.userId;

    const { email, password, fullName, phone, department, qualifications, subjects } = req.body;
    
    // Check if teacher already exists
    const existingTeacher = await Teacher.findOne({ email });
    if (existingTeacher) {
      return res.status(400).json({ message: 'Teacher already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);

    // Create new teacher and assign to this admin
    const newTeacher = new Teacher({
      email,
      password: hashedPassword,
      fullName,
      phone,
      department,
      qualifications,
      subjects: subjects || [],
      role: 'teacher',
      isActive: true,
      adminId: adminId  // Assign to the logged-in admin
    });

    await newTeacher.save();
    res.status(201).json({ message: 'Teacher created successfully' });
  } catch (error) {
    console.error('Failed to create teacher:', error);
    res.status(500).json({ message: 'Failed to create teacher' });
  }
});

app.put('/api/admin/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove password from update data if present
    delete updateData.password;
    
    const updatedTeacher = await Teacher.findByIdAndUpdate(id, updateData, { new: true }).populate('subjects');
    
    if (!updatedTeacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.json(updatedTeacher);
  } catch (error) {
    console.error('Failed to update teacher:', error);
    res.status(500).json({ message: 'Failed to update teacher' });
  }
});

app.delete('/api/admin/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedTeacher = await Teacher.findByIdAndDelete(id);
    if (!deletedTeacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Failed to delete teacher:', error);
    res.status(500).json({ message: 'Failed to delete teacher' });
  }
});

// Subject management endpoints - filter by admin's board
app.get('/api/admin/subjects', async (req, res) => {
  try {
    // Get admin's board from token (if admin) or return all (if super-admin)
    let adminBoard = null;
    if (req.user && req.user.role === 'admin') {
      const adminId = req.user.userId || req.user._id || req.user.id;
      const admin =
        adminId && mongoose.Types.ObjectId.isValid(String(adminId))
          ? await User.findById(adminId)
          : null;
      if (admin && admin.board) {
        adminBoard = admin.board;
      }
    }
    
    // Build query - filter by board if admin, show all if super-admin
    const query = adminBoard ? { board: adminBoard, isActive: true } : { isActive: true };
    
    const subjects = await Subject.find(query)
      .populate('createdBy', 'fullName email')
      .sort({ name: 1 });
    
    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No subjects found in database',
        data: []
      });
    }
    
    console.log(`📚 Admin subjects endpoint: Found ${subjects.length} subjects for board: ${adminBoard || 'ALL'}`);
    
    // Get all teachers and find which ones are assigned to each subject
    const teachers = await Teacher.find({ isActive: true })
      .select('_id fullName email subjects')
      .lean();
    
    // Create a map of subject ID to assigned teachers
    const subjectTeachersMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach(subjectId => {
          const subjectIdStr = subjectId.toString();
          if (!subjectTeachersMap.has(subjectIdStr)) {
            subjectTeachersMap.set(subjectIdStr, []);
          }
          subjectTeachersMap.get(subjectIdStr).push({
            id: teacher._id.toString(),
            fullName: teacher.fullName,
            email: teacher.email
          });
        });
      }
    });
    
    // Format subjects with teacher information
    const formattedSubjects = subjects.map(subject => {
      const subjectObj = subject.toObject();
      const subjectIdStr = subject._id.toString();
      const assignedTeachers = subjectTeachersMap.get(subjectIdStr) || [];
      
      // If there are multiple teachers, show the first one (or you can show all)
      return {
        ...subjectObj,
        id: subjectObj._id.toString(),
        teacher: assignedTeachers.length > 0 ? assignedTeachers[0] : null,
        teachers: assignedTeachers // Include all teachers if needed
      };
    });
    
    console.log(`✅ Returning ${formattedSubjects.length} subjects with teacher assignments`);
    
    res.json(formattedSubjects);
  } catch (error) {
    console.error('Failed to fetch subjects:', error);
    res.status(500).json({ message: 'Failed to fetch subjects' });
  }
});

app.post('/api/admin/subjects', async (req, res) => {
  try {
    const { name, description, code, teacher, grade, department } = req.body;
    
    // Check if subject code already exists
    const existingSubject = await Subject.findOne({ code });
    if (existingSubject) {
      return res.status(400).json({ message: 'Subject code already exists' });
    }

    // Create new subject
    const newSubject = new Subject({
      name,
      description,
      code,
      teacher: teacher || null,
      grade,
      department,
      isActive: true
    });

    await newSubject.save();

    // Note: setting a subject's primary teacher must NOT add the subject to the
    // teacher's own `subjects` list. That list is owned solely by the "Assign
    // Subjects" teacher flow; auto-adding here leaked unselected subjects onto teachers.

    res.status(201).json({ message: 'Subject created successfully' });
  } catch (error) {
    console.error('Failed to create subject:', error);
    res.status(500).json({ message: 'Failed to create subject' });
  }
});

app.put('/api/admin/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { teacher, teacherId } = req.body;
    const hasTeacherUpdate = teacherId !== undefined || teacher !== undefined;
    const resolvedTeacherId = teacherId ?? teacher ?? null;

    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ 
        success: false,
        message: 'Subject not found in database' 
      });
    }

    if (hasTeacherUpdate) {
      const { syncSubjectTeacher } = await import('./utils/subjectClassRelations.js');
      await syncSubjectTeacher(id, resolvedTeacherId || null, null);
    }

    const { teacher: _t, teacherId: _tid, ...rest } = req.body;
    const updatedSubject = await Subject.findByIdAndUpdate(id, rest, { new: true });
    res.json(updatedSubject);
  } catch (error) {
    console.error('Failed to update subject:', error);
    res.status(500).json({ message: 'Failed to update subject' });
  }
});

app.delete('/api/admin/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ 
        success: false,
        message: 'Subject not found in database' 
      });
    }

    const { removeSubjectIdFromAllAssignments } = await import(
      './utils/removeSubjectAssignments.js'
    );
    await removeSubjectIdFromAllAssignments(id);

    await Subject.findByIdAndDelete(id);
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Failed to delete subject:', error);
    res.status(500).json({ message: 'Failed to delete subject' });
  }
});

// Assign subjects to teacher endpoint
app.post('/api/admin/teachers/:id/assign-subjects', async (req, res) => {
  try {
    const { id } = req.params;
    const { subjectIds } = req.body;
    
    console.log('Assigning subjects to teacher:', { teacherId: id, subjectIds });
    
    const teacher = await Teacher.findById(id);
    if (!teacher) {
      console.log('Teacher not found:', id);
      return res.status(404).json({ 
        success: false,
        message: 'Teacher not found in database' 
      });
    }

    console.log('Teacher found:', teacher.email, 'Current subjects:', teacher.subjects);

    const previousSubjectIds = (teacher.subjects || []).map((sid) => String(sid));
    teacher.subjects = subjectIds || [];
    await teacher.save();

    const { syncTeacherSubjectPrimaryLinks } = await import('./utils/subjectClassRelations.js');
    await syncTeacherSubjectPrimaryLinks(id, previousSubjectIds, subjectIds || [], teacher.adminId);

    console.log('Teacher subjects updated:', teacher.subjects);

    res.json({ message: 'Subjects assigned successfully' });
  } catch (error) {
    console.error('Failed to assign subjects:', error);
    res.status(500).json({ message: 'Failed to assign subjects' });
  }
});

// School admin exams are VIEW-ONLY (see /api/admin/exams/viewable on admin router).
// Legacy write APIs removed so school admins cannot create/edit/delete exams.
app.get('/api/admin/exams', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Use GET /api/admin/exams/viewable — school admins have view-only access.',
  });
});

app.post('/api/admin/exams', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'School admins can view exams only. Create exams as Super Admin.',
  });
});

app.put('/api/admin/exams/:id', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'School admins can view exams only. Edit exams as Super Admin.',
  });
});

app.delete('/api/admin/exams/:id', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'School admins can view exams only. Delete exams as Super Admin.',
  });
});

// Student exam endpoints
// This route is now handled by student.js with proper multi-tenant filtering
// app.get('/api/student/exams', requireAuth, async (req, res) => {
//   try {
//     console.log('Fetching student exams for user:', req.user.id);
//     
//     const exams = await Exam.find({ isActive: true })
//       .populate('questions')
//       .sort({ createdAt: -1 });
//     
//     console.log('Found exams:', exams.length);
//     console.log('Exam details:', exams.map(exam => ({
//       id: exam._id,
//       title: exam.title,
//       examType: exam.examType,
//       isActive: exam.isActive,
//       questionsCount: exam.questions.length
//     })));
//     
//     res.json(exams);
//   } catch (error) {
//     console.error('Failed to fetch student exams:', error);
//     res.status(500).json({ message: 'Failed to fetch exams', error: error.message });
//   }
// });

// This route is now handled by student.js with proper multi-tenant filtering
// app.get('/api/student/exams/:examId', requireAuth, async (req, res) => {
//   try {
//     const { examId } = req.params;
//     
//     if (!mongoose.Types.ObjectId.isValid(examId)) {
//       return res.status(400).json({ message: 'Invalid exam ID format' });
//     }
//     
//     const exam = await Exam.findById(examId)
//       .populate('questions');
//     
//     if (!exam) {
//       return res.status(404).json({ message: 'Exam not found' });
//     }
//     
//     res.json(exam);
//   } catch (error) {
//     console.error('Failed to fetch exam:', error);
//     res.status(500).json({ message: 'Failed to fetch exam' });
//   }
// });

// Save exam results
// Update exam result to include board
// POST exam results - This route is now handled by student.js routes
// REMOVED: Duplicate route that was causing user data isolation issues
// The correct route should be in backend/routes/student.js which properly uses req.userId

// Get student exam results - This route is now handled by student.js routes
// REMOVED: Duplicate route that was causing user data isolation issues
// The correct route is in backend/routes/student.js which properly filters by req.userId

// Test endpoint for debugging
app.get('/api/admin/test', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});


// Admin Quizzes endpoints
app.get('/api/quizzes', async (req, res) => {
  try {
    const quizzes = await Assessment.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(quizzes);
  } catch (error) {
    console.error('Failed to fetch quizzes:', error);
    res.status(500).json({ message: 'Failed to fetch quizzes' });
  }
});

app.post('/api/quizzes', async (req, res) => {
  try {
    const { title, description, subject, difficulty, duration, questions } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newQuiz = new Assessment({
      title,
      description,
      subjectIds: [subject],
      difficulty: difficultyMap[difficulty] || 'beginner',
      duration,
      questions: [], // Start with empty questions array
      totalPoints: 0, // Will be calculated when questions are added
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newQuiz.save();
    res.status(201).json(newQuiz);
  } catch (error) {
    console.error('Failed to create quiz:', error);
    res.status(500).json({ message: 'Failed to create quiz' });
  }
});

app.put('/api/quizzes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const quiz = await Assessment.findByIdAndUpdate(id, updateData, { new: true });
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    res.json(quiz);
  } catch (error) {
    console.error('Failed to update quiz:', error);
    res.status(500).json({ message: 'Failed to update quiz' });
  }
});

app.delete('/api/quizzes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Assessment.findByIdAndDelete(id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    console.error('Failed to delete quiz:', error);
    res.status(500).json({ message: 'Failed to delete quiz' });
  }
});

app.patch('/api/quizzes/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const quiz = await Assessment.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    res.json(quiz);
  } catch (error) {
    console.error('Failed to toggle quiz status:', error);
    res.status(500).json({ message: 'Failed to toggle quiz status' });
  }
});

// Admin Videos endpoints
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

app.post('/api/videos', async (req, res) => {
  try {
    const { title, description, subject, duration, videoUrl, thumbnail, youtubeUrl, isYouTubeVideo } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newVideo = new Video({
      title,
      description,
      subjectId: subject,
      duration,
      videoUrl: isYouTubeVideo ? '' : (videoUrl || ''),
      thumbnailUrl: isYouTubeVideo ? '' : (thumbnail || ''),
      youtubeUrl: isYouTubeVideo ? (youtubeUrl || '') : '',
      isYouTubeVideo: isYouTubeVideo || false,
      difficulty: difficultyMap['medium'] || 'beginner', // Default to medium
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newVideo.save();
    res.status(201).json(newVideo);
  } catch (error) {
    console.error('Failed to create video:', error);
    res.status(500).json({ message: 'Failed to create video' });
  }
});

app.put('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const video = await Video.findByIdAndUpdate(id, updateData, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    res.json(video);
  } catch (error) {
    console.error('Failed to update video:', error);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

app.delete('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Video.findByIdAndDelete(id);
    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Failed to delete video:', error);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

app.patch('/api/videos/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const video = await Video.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    res.json(video);
  } catch (error) {
    console.error('Failed to toggle video status:', error);
    res.status(500).json({ message: 'Failed to toggle video status' });
  }
});

// Duplicate assessments GET route removed - handled above

app.post('/api/assessments', async (req, res) => {
  try {
    const { title, description, subject, type, difficulty, duration, totalMarks, passingMarks, questions, driveLink, isDriveQuiz } = req.body;
    
    // Map difficulty values to model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newAssessment = new Assessment({
      title,
      description,
      subjectIds: [subject],
      type,
      difficulty: difficultyMap[difficulty] || 'beginner',
      duration,
      totalPoints: totalMarks,
      passingPoints: passingMarks,
      questions: [], // Start with empty questions array
      driveLink: driveLink || '',
      isDriveQuiz: isDriveQuiz || false,
      isPublished: true,
      createdBy: null // Remove user dependency for now
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

app.put('/api/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const assessment = await Assessment.findByIdAndUpdate(id, updateData, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to update assessment:', error);
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

app.delete('/api/assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Assessment.findByIdAndDelete(id);
    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    res.status(500).json({ message: 'Failed to delete assessment' });
  }
});

app.patch('/api/assessments/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const assessment = await Assessment.findByIdAndUpdate(id, { isPublished: isActive }, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to toggle assessment status:', error);
    res.status(500).json({ message: 'Failed to toggle assessment status' });
  }
});

// Error handling middleware
// NOTE: the global error handler used to live here, but ~30 route
// registrations follow this point in the file. Express only routes errors to
// error middleware declared AFTER the routes that throw, so those 30 routes
// were bypassing it entirely and falling through to Express's default handler.
// It now sits immediately before app.listen — see the bottom of this file.

// Vidya AI endpoints have moved to routes/vidya.js
// (mounted via app.use('/api', vidyaRoutes) earlier in this file).
// The old in-memory Map / unauthenticated handlers have been removed.

// Subject Management endpoints
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find({ isActive: true })
      .populate('videos', 'title duration')
      .populate('quizzes', 'question')
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 });
    
    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No subjects found in database',
        subjects: []
      });
    }
    
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
});

app.get('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subject ID format' });
    }
    
    const subject = await Subject.findById(id);
    
    if (!subject) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subject not found in database' 
      });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error fetching subject:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch subject',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/subjects', async (req, res) => {
  try {
    const { name, description, category, difficulty, duration, subjects, color, icon } = req.body;
    
    const subject = new Subject({
      name,
      description,
      category,
      difficulty,
      duration,
      subjects,
      color,
      icon,
      createdBy: req.user?.id || 'admin-user' // Fallback for testing
    });
    
    await subject.save();
    res.status(201).json({ success: true, subject });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to create subject' });
  }
});

app.put('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const subject = await Subject.findByIdAndUpdate(id, updates, { new: true });
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to update subject' });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const subject = await Subject.findByIdAndUpdate(id, { isActive: false }, { new: true });
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    const { removeSubjectIdFromAllAssignments } = await import(
      './utils/removeSubjectAssignments.js'
    );
    await removeSubjectIdFromAllAssignments(id);
    
    res.json({ success: true, message: 'Subject deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating subject:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate subject' });
  }
});

// Add video to subject
app.post('/api/subjects/:id/videos', async (req, res) => {
  try {
    const { id } = req.params;
    const { videoId } = req.body;
    
    const subject = await Subject.findByIdAndUpdate(
      id,
      { $addToSet: { videos: videoId } },
      { new: true }
    );
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error adding video to subject:', error);
    res.status(500).json({ success: false, message: 'Failed to add video to subject' });
  }
});

// Add quiz to subject
app.post('/api/subjects/:id/quizzes', async (req, res) => {
  try {
    const { id } = req.params;
    const { quizId } = req.body;
    
    const subject = await Subject.findByIdAndUpdate(
      id,
      { $addToSet: { quizzes: quizId } },
      { new: true }
    );
    
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error adding quiz to subject:', error);
    res.status(500).json({ success: false, message: 'Failed to add quiz to subject' });
  }
});
// Get all admins with enhanced data
app.get('/api/super-admin/admins', async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('-password');

    const adminsWithCounts = await Promise.all(
      admins.map(async (admin) => {
        const studentCount = await User.countDocuments({
          role: 'student',
          assignedAdmin: admin._id
        });

        const teacherCount = await Teacher.countDocuments({
          adminId: admin._id
        });

        return {
          id: admin._id,
          _id: admin._id,
          name: admin.fullName || admin.name,
          email: admin.email,
          schoolName: admin.schoolName || admin.name || '',
          totalStudents: studentCount,
          totalTeachers: teacherCount,
          createdAt: admin.createdAt,
          status: admin.isActive !== false ? 'active' : 'inactive'
        };
      })
    );

    res.json({
      success: true,
      data: adminsWithCounts
    });
  } catch (error) {
    console.error('Error fetching admins:', error);

    // Fallback: return empty list instead of 500 so UI still loads
    res.status(200).json({
      success: false,
      message: 'Failed to fetch admins from database, returning empty list',
      data: []
    });
  }
});

// Delete admin - This route is handled by the controller in routes/superAdmin.js
// Keeping this for backward compatibility but it should use the controller's deleteAdmin function
// The controller handles cascading deletion of all related data

// Get all users
app.get('/api/super-admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// Create new user
app.post('/api/super-admin/users', async (req, res) => {
  try {
    const { name, email, role, details } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    // Create new user
    const hashedPassword = await bcrypt.hash('password123', 12); // Default password
    const newUser = new User({
      fullName: name,
      email,
      password: hashedPassword,
      role: role,
      details: details,
      isActive: true
    });
    
    await newUser.save();
    
    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: newUser._id,
        name: newUser.fullName,
        email: newUser.email,
        role: newUser.role,
        details: newUser.details,
        status: 'Active',
        joinDate: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// Get all courses/videos
app.get('/api/super-admin/courses', async (req, res) => {
  try {
    const courses = await Video.find().populate('teacher', 'fullName').sort({ createdAt: -1 });
    res.json(courses);
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch courses' });
  }
});

// Create new course
app.post('/api/super-admin/courses', async (req, res) => {
  try {
    const { title, subject, grade, board, teacher } = req.body;
    
    // Find teacher by name
    const teacherUser = await User.findOne({ fullName: teacher, role: 'teacher' });
    if (!teacherUser) {
      return res.status(400).json({ success: false, message: 'Teacher not found' });
    }
    
    const newCourse = new Video({
      title: title,
      subject: subject,
      grade: grade,
      board: board,
      teacher: teacherUser._id,
      description: `${subject} course for ${grade} - ${board}`,
      isPublished: true
    });
    
    await newCourse.save();
    
    res.json({
      success: true,
      message: 'Course created successfully',
      course: {
        id: newCourse._id,
        title: newCourse.title,
        subject: newCourse.subject,
        grade: newCourse.grade,
        board: newCourse.board,
        teacher: teacherUser.fullName,
        status: 'Published',
        created: newCourse.createdAt
      }
    });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
});

// Get analytics data
app.get('/api/super-admin/analytics', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    
    // Calculate daily active users (mock data)
    const dailyActive = Math.floor(totalUsers * 0.1);
    const weeklyActive = Math.floor(totalUsers * 0.3);
    const monthlyActive = Math.floor(totalUsers * 0.7);
    
    res.json({
      dailyActive,
      weeklyActive,
      monthlyActive,
      avgSessionTime: "24m 35s",
      completionRate: 76,
      revenueGrowth: 23.5,
      userGrowth: 18.2,
      courseEngagement: 89
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
});

// Subscriptions / billing: handled by superAdmin routes (Razorpay-backed getSubscriptions)

// Export data
app.get('/api/super-admin/export', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    const videos = await Video.find();
    const teachers = await Teacher.find();
    
    const exportData = {
      users: users,
      videos: videos,
      teachers: teachers,
      exportDate: new Date().toISOString()
    };
    
    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Failed to export data' });
  }
});

// Direct video creation endpoint for testing
app.post('/api/test-video', async (req, res) => {
  try {
    console.log('=== DIRECT VIDEO TEST ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl } = req.body;
    
    const testVideo = new Video({
      title: title || 'Direct Test Video',
      description: description || 'Test Description',
      subjectId: subject || 'test',
      duration: parseInt(duration) * 60 || 3600,
      videoUrl: videoUrl || 'https://test.com',
      youtubeUrl: videoUrl || 'https://test.com',
      isYouTubeVideo: true,
      difficulty: 'beginner',
      createdBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      isPublished: true
    });
    
    console.log('Direct test video object:', testVideo);
    await testVideo.save();
    console.log('Direct test video saved successfully:', testVideo._id);
    
    res.json({ success: true, message: 'Direct test video created', data: testVideo });
  } catch (error) {
    console.error('=== DIRECT TEST VIDEO ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error stack:', error.stack);
    console.error('Full error:', error);
    res.status(500).json({ success: false, message: 'Direct test failed', error: error.message, details: error });
  }
});

// Working video creation endpoint for teachers
app.post('/api/teacher/videos-working', async (req, res) => {
  try {
    console.log('=== WORKING TEACHER VIDEO ENDPOINT ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token:', token);
    
    // Verify token and get user info (fallback secret for local dev)
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    console.log('Decoded token:', decoded);
    
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    
    let teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      // Fallback: resolve by email
      if (decoded.email) {
        const userDoc = await User.findOne({ email: decoded.email }).select('_id');
        teacherId = userDoc?._id?.toString();
      }
    }
    console.log('Teacher ID resolved:', teacherId);
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};

    // Normalize inputs
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const newVideo = new Video({
      title: (title || 'Untitled Video').trim(),
      description: (description || '').trim(),
      subjectId: (subject || 'general').toString().trim(),
      duration: durationSeconds,
      videoUrl: (videoUrl || '').trim(),
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl,
      difficulty: (difficulty || 'beginner').toLowerCase(),
      createdBy: new mongoose.Types.ObjectId(teacherId),
      // For multi-tenant visibility, prefer teacher's admin if available; fallback to teacherId
      adminId: new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    });
    // Pre-validate to surface detailed errors
    const validationError = newVideo.validateSync();
    if (validationError) {
      console.error('Video validation error:', validationError);
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }

    await newVideo.save();
    console.log('Working video created successfully:', newVideo._id);
    
    res.status(201).json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Working video creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create video', error: error.message, stack: error.stack });
  }
});

// Teacher video creation using EXACT admin logic - visible to ALL students
app.post('/api/teacher-videos-admin-style', async (req, res) => {
  try {
    console.log('=== TEACHER VIDEO EXACT ADMIN STYLE ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token:', token);
    
    // Verify token and get user info
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    console.log('Decoded token:', decoded);
    
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    
    const teacherId = decoded.userId;
    console.log('Teacher ID from token:', teacherId);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body;
    
    console.log('Parsed data:', { title, description, subject, duration, videoUrl, difficulty });
    
    // Validate required fields
    if (!title || !subject || !duration) {
      console.error('Missing required fields:', { title, subject, duration });
      return res.status(400).json({ message: 'Missing required fields: title, subject, duration' });
    }
    
    // Use EXACT same logic as admin video creation - teachers act as admins
    const videoData = {
      title,
      description: description || '',
      videoUrl: videoUrl || '',
      thumbnailUrl: '', // Empty like admin
      duration: parseInt(duration), // NO conversion - exact like admin
      subjectId: subject,
      difficulty: difficulty || 'beginner',
      isPublished: true, // Make visible to ALL students
      adminId: new mongoose.Types.ObjectId(teacherId), // Use actual teacher ID as adminId
      createdBy: new mongoose.Types.ObjectId(teacherId) // Also set createdBy
    };
    
    console.log('Video data to save:', videoData);
    
    const newVideo = new Video(videoData);
    
    await newVideo.save();
    console.log('Teacher video created successfully:', newVideo._id);
    
    res.status(201).json(newVideo); // Exact same response as admin
  } catch (error) {
    console.error('Teacher video creation error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to create video', error: error.message }); // Include error details
  }
});

// Teacher assessment creation using EXACT admin logic - visible to ALL students
app.post('/api/teacher-assessments-admin-style', async (req, res) => {
  try {
    console.log('=== TEACHER ASSESSMENT EXACT ADMIN STYLE ===');
    console.log('Body:', req.body);
    
    const { title, description, questions, subject, duration, difficulty } = req.body;
    
    // Convert single subject to subjectIds array (like admin)
    const subjectIds = Array.isArray(subject) ? subject : [subject];
    
    // Calculate total points (exact like admin)
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    // Use EXACT same logic as admin assessment creation
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds,
      difficulty: difficulty || 'beginner',
      duration: parseInt(duration),
      totalPoints,
      isPublished: true, // Make visible to ALL students
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011') // Use a default adminId
    });
    
    await newAssessment.save();
    console.log('Teacher assessment created successfully:', newAssessment._id);
    
    res.status(201).json(newAssessment); // Exact same response as admin
  } catch (error) {
    console.error('Teacher assessment creation error:', error);
    res.status(500).json({ message: 'Failed to create assessment' }); // Exact same error response
  }
});

// Super simple test endpoint to isolate video creation issue
app.post('/api/test-video-simple', async (req, res) => {
  try {
    console.log('=== SUPER SIMPLE VIDEO TEST ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Normalize inputs
    const normalizedTitle = (title || '').trim() || 'Untitled Video';
    const normalizedDescription = (description || '').trim();
    const normalizedSubject = (subject || '').toString().trim() || 'general';
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60; // schema expects seconds
    const normalizedUrl = (videoUrl || '').toString().trim();
    const normalizedDifficulty = (difficulty || 'beginner').toLowerCase();

    // Create video with safe defaults to avoid validation errors
    const testVideo = new Video({
      title: normalizedTitle,
      description: normalizedDescription,
      videoUrl: normalizedUrl,
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: normalizedSubject,
      difficulty: ['beginner','intermediate','advanced'].includes(normalizedDifficulty) ? normalizedDifficulty : 'beginner',
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(), // Generate new valid ObjectId
      createdBy: new mongoose.Types.ObjectId(), // Add required createdBy field
      youtubeUrl: normalizedUrl,
      isYouTubeVideo: !!normalizedUrl
    });
    
    await testVideo.save();
    console.log('Test video created successfully:', testVideo._id);
    
    res.status(201).json({ success: true, message: 'Test video created', data: testVideo });
  } catch (error) {
    console.error('Test video error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SUPER SIMPLE video creation - guaranteed to work
app.post('/api/super-simple-video', async (req, res) => {
  try {
    console.log('=== SUPER SIMPLE VIDEO CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Create minimal video with all required fields
    const video = new Video({
      title: title || 'Test Video',
      description: description || '',
      videoUrl: videoUrl || '',
      thumbnailUrl: '',
      duration: 60, // Fixed duration
      subjectId: subject || 'general',
      difficulty: difficulty === 'medium' ? 'intermediate' : (difficulty || 'beginner'),
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      youtubeUrl: videoUrl || '',
      isYouTubeVideo: !!videoUrl
    });
    
    await video.save();
    console.log('SUPER SIMPLE video created:', video._id);
    
    res.status(201).json({ success: true, data: video });
  } catch (error) {
    console.error('SUPER SIMPLE video error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Working assessment creation endpoint
app.post('/api/create-assessment', async (req, res) => {
  try {
    console.log('=== ASSESSMENT CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, difficulty, duration, totalMarks, driveLink, isDriveQuiz } = req.body || {};
    
    // Create assessment with minimal required fields
    const assessment = new Assessment({
      title: title || 'Untitled Assessment',
      description: description || '',
      subjectIds: [subject || 'general'],
      questions: [], // Empty array as required
      duration: parseInt(duration) || 30,
      difficulty: difficulty || 'beginner',
      totalPoints: parseInt(totalMarks) || 10,
      driveLink: driveLink || '',
      isDriveQuiz: !!isDriveQuiz,
      isPublished: true,
      adminId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId()
    });
    
    await assessment.save();
    console.log('Assessment created successfully:', assessment._id);
    
    res.status(201).json(assessment);
  } catch (error) {
    console.error('Assessment creation error:', error);
    res.status(500).json({ message: 'Failed to create assessment', error: error.message });
  }
});

// Teacher assessment creation endpoint
app.post('/api/teacher/assessments', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    
    const teacherDoc = await Teacher.findById(teacherId).select('_id adminId');
    if (!teacherDoc) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    const { title, description, subject, questions, timeLimit, difficulty, link } = req.body || {};
    
    if (!title || !subject || !questions) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, subject, questions' });
    }
    
    const newAssessment = new Assessment({
      title: String(title).trim(),
      description: (description || '').trim(),
      subjectIds: [String(subject).trim()], // Assessment model uses subjectIds array
      questions: [], // Empty array for now, questions can be added later
      duration: parseInt(timeLimit) || 30, // Assessment model uses duration, not timeLimit
      difficulty: (difficulty || 'medium').toLowerCase(),
      driveLink: (link || '').trim(), // Use driveLink field from model
      isDriveQuiz: !!link, // Set to true if link is provided
      isPublished: true,
      createdBy: teacherDoc._id,
      adminId: teacherDoc.adminId || teacherDoc._id,
      totalPoints: parseInt(questions) || 10
    });
    
    const validationError = newAssessment.validateSync();
    if (validationError) {
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }
    
    await newAssessment.save();
    return res.status(201).json({ success: true, data: newAssessment });
  } catch (error) {
    console.error('Teacher assessment creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create assessment', error: error.message });
  }
});

// Delete video endpoint for teachers
app.delete('/api/videos/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity' });
    }
    
    const videoId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }
    
    // Find and delete video (only if created by this teacher)
    const video = await Video.findOneAndDelete({
      _id: videoId,
      createdBy: teacherId
    });
    
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found or not authorized to delete' });
    }
    
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete video', error: error.message });
  }
});

// Teacher video creation endpoint - ensures videos persist on teacher dashboard
app.post('/api/teacher/videos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });

    // Resolve teacher
    const teacherId = decoded.userId || decoded.id || decoded._id;
    if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher identity in token' });
    }
    const teacherDoc = await Teacher.findById(teacherId).select('_id adminId');
    if (!teacherDoc) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    if (!title || !subject || (!duration && duration !== 0)) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, subject, duration' });
    }

    // Duration comes in minutes from UI; convert to seconds for schema
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const newVideo = new Video({
      title: String(title).trim(),
      description: (description || '').trim(),
      videoUrl: (videoUrl || '').trim(),
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl,
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: String(subject).trim(),
      difficulty: (difficulty || 'beginner').toLowerCase(),
      isPublished: true,
      createdBy: teacherDoc._id,
      adminId: teacherDoc.adminId || teacherDoc._id
    });

    const validationError = newVideo.validateSync();
    if (validationError) {
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }

    await newVideo.save();
    return res.status(201).json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Teacher /api/teacher/videos error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create video', error: error.message });
  }
});

// Emergency video creation endpoint - no auth required for testing
app.post('/api/emergency-video-create', async (req, res) => {
  try {
    console.log('=== EMERGENCY VIDEO CREATION ===');
    console.log('Body:', req.body);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body || {};
    
    // Validate required fields
    if (!title || !subject || (!duration && duration !== 0)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, subject, duration' 
      });
    }
    
    // Create a valid ObjectId for adminId (using current timestamp)
    const adminId = new mongoose.Types.ObjectId();
    
    const minutes = Number.isFinite(Number(duration)) ? Number(duration) : 1;
    const durationSeconds = Math.max(1, Math.floor(minutes)) * 60;

    const videoData = {
      title: (title || 'Untitled Video').trim(),
      description: (description || '').trim(),
      videoUrl: (videoUrl || '').trim(),
      thumbnailUrl: '',
      duration: durationSeconds,
      subjectId: (subject || 'general').toString().trim(),
      difficulty: (difficulty || 'beginner').toLowerCase(),
      isPublished: true,
      adminId: adminId,
      createdBy: adminId, // Set createdBy to adminId for emergency endpoint
      youtubeUrl: (videoUrl || '').trim(),
      isYouTubeVideo: !!videoUrl
    };
    
    console.log('Creating video with data:', videoData);
    
    const newVideo = new Video(videoData);
    const validationError = newVideo.validateSync();
    if (validationError) {
      console.error('Emergency creation validation error:', validationError);
      return res.status(400).json({ success: false, message: 'Validation failed', error: validationError.message, details: validationError.errors });
    }
    await newVideo.save();
    
    console.log('Emergency video created successfully:', newVideo._id);
    
    res.json({ 
      success: true, 
      message: 'Video created successfully',
      data: newVideo 
    });
    
  } catch (error) {
    console.error('Emergency video creation error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create video', 
      error: error.message,
      stack: error.stack
    });
  }
});

// Lesson Plan Generation endpoint
app.post('/api/lesson-plan/generate', async (req, res) => {
  try {
    const { subject, topic, gradeLevel, duration } = req.body;
    
    if (!subject || !topic || !gradeLevel) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subject, topic, and grade level are required' 
      });
    }

    // Use the dedicated generateLessonPlan function instead of chat service
    const geminiServiceModule = await import('./services/gemini-service.js');
    const lessonPlan = await geminiServiceModule.generateLessonPlan(subject, topic, gradeLevel, duration || 90);
    
    res.json({
      success: true,
      lessonPlan: lessonPlan
    });
    
  } catch (error) {
    console.error('Lesson plan generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate lesson plan',
      error: error.message 
    });
  }
});

// AI Generator / Book batches hold the HTTP connection for several minutes.
// Default Node/proxy idle limits (~60–120s) surface as intermittent "Network error".
/*
 * 404 for unmatched API routes.
 *
 * Unknown /api paths previously fell through to Express's default handler and
 * returned an HTML error page, which a JSON client cannot parse — the frontend
 * would fail on JSON.parse rather than reporting "not found".
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `No such endpoint: ${req.method} ${req.originalUrl}`,
    requestId: req.id,
  });
});

/*
 * Global error handler — MUST be last, after every route.
 *
 * Was: console.error(err.stack) + a bare 500 "Something went wrong!",
 * registered ~1,100 lines before the final routes so it never saw their errors.
 * Three further problems: the stack went to stdout with no request
 * correlation, the caller got no reference to quote in a support ticket, and
 * every failure became a 500 even when the error carried its own status (a 400
 * validation error was reported as a server fault).
 *
 * Now: correlated structured log, the error's own status when it has one, and
 * the request id returned to the caller. The message is still withheld in
 * production — internal errors can carry connection strings and query
 * fragments — but surfaced in development where it is useful.
 */
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${nodeEnvEffective}`);
});
server.timeout = Number(process.env.SERVER_TIMEOUT_MS || 300_000); // 5 min default (AI jobs)
server.requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 310_000);
server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 65_000);
server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_MS || 120_000);

/*
 * Process-level failure handling. There was none.
 *
 * An unhandled promise rejection previously produced a bare Node warning and
 * left the process running in an unknown state; on newer Node it can terminate
 * the process outright with no useful diagnostic. Either way the cause was
 * invisible. These handlers make the failure loud and attributable.
 *
 * The distinction matters:
 *   - unhandledRejection: log and KEEP SERVING. One route's forgotten .catch()
 *     should not take down every other request in flight.
 *   - uncaughtException: the process is genuinely in an undefined state, so
 *     stop accepting connections, drain, and exit non-zero so the supervisor
 *     (PM2 / Railway) restarts it. Forced exit after 10s in case drain hangs.
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION — server continues:', reason instanceof Error ? reason.stack : reason);
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

// SIGTERM is what PM2, Docker and Railway send on deploy/restart.
process.on('SIGTERM', () => shutdown('SIGTERM'));
