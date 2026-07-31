/**
 * PR3: extract proxy, health, calendar, product-categories, catalog, and
 * remaining inline admin/super-admin/legacy routes from app.js into routers.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = join(root, 'app.js');
let app = fs.readFileSync(appPath, 'utf8');

function cut(startStr, endStr, label) {
  const s = app.indexOf(startStr);
  if (s < 0) throw new Error(`missing start ${label}`);
  const e = app.indexOf(endStr, s);
  if (e < 0) throw new Error(`missing end ${label}: ${endStr.slice(0, 40)}`);
  const block = app.slice(s, e);
  app = app.slice(0, s) + `/*CUT:${label}*/\n` + app.slice(e);
  return block;
}

function stripAppPrefix(block) {
  // Convert app.METHOD('/api/foo', ...) → router.METHOD('/foo', ...) where possible
  // Keep full paths for mixed mounts; we'll mount at '' and use full paths on router.
  return block.replace(/\bapp\.(get|post|put|patch|delete|options|use)\(/g, 'router.$1(');
}

// --- proxy ---
const proxyBlock = cut(
  "app.options('/api/proxy/content'",
  'app.options(/^\\/api\\/.*/',
  'proxy',
);

// --- health (keep one early) — leave in app for now; also write health router and replace ---
const healthBlock = cut(
  '// Simple health check endpoint for Nginx',
  "app.use('/api', (req, res, next) => {",
  'health',
);

// calendar + product categories
const calendarBlock = cut(
  '// Calendar API — exams + holidays + custom (super-admin)',
  '// Auth domain (before role routers',
  'calendarProduct',
);

// catalog + everything until API 404
const restStart = '// Public catalog routes';
const restEnd = '/*\n * 404 for unmatched API routes.';
const restEndAlt = '/*\r\n * 404 for unmatched API routes.';
let restBlock;
try {
  restBlock = cut(restStart, restEnd, 'rest');
} catch {
  restBlock = cut(restStart, restEndAlt, 'rest');
}

// Write health.js
fs.writeFileSync(
  join(root, 'routes', 'health.js'),
  `import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

router.get('/', (req, res) => {
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

export default router;
`,
);

// Write proxy.js — needs allowedOrigins from request; pass via closure by importing getAllowedOrigins
let proxySrc = proxyBlock
  .replace(/\bapp\./g, 'router.')
  .replace(/allowedOrigins/g, 'getAllowedOrigins()');
// Fix double call getAllowedOrigins()() if any - use const in factory

fs.writeFileSync(
  join(root, 'routes', 'proxy.js'),
  `import express from 'express';
import axios from 'axios';
import { basename } from 'path';
import { verifyToken } from '../middleware/auth.js';
import { assertAllowedFetchUrl, getContentProxyAllowlist } from '../utils/url-allowlist.js';
import { getAllowedOrigins } from '../bootstrap/cors-origins.js';

const router = express.Router();
const TRUSTED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://aslilearn.ai https://www.aslilearn.ai https://*.vercel.app";

${proxyBlock.replace(/\bapp\./g, 'router.').replace(
    /allowedOrigins\.includes/g,
    'getAllowedOrigins().includes',
  )}

export default router;
`,
);

// Fix proxy - the OPTIONS uses allowedOrigins.includes - we replaced with getAllowedOrigins().includes - good.
// But TRUSTED_FRAME_ANCESTORS may already be in createApp scope - proxy handler references TRUSTED_FRAME_ANCESTORS - defined in app.js middleware section. Need to include in proxy.js - already added.

// calendar + product
const calRouter = `import express from 'express';
import { verifyToken, verifySuperAdmin } from '../middleware/auth.js';
import { getCalendarEvents, createCalendarEvent } from '../controllers/calendarController.js';

const router = express.Router();

router.get('/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
router.post('/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);

router.get('/product-categories', async (req, res) => {
  try {
    const { listProductCategories, PRODUCT_IIT, formatIitCategoryLabel } = await import(
      '../constants/products.js'
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

export default router;
`;
fs.writeFileSync(join(root, 'routes', 'calendarPublic.js'), calRouter);

// Rest: keep as legacyAppRoutes.js using full paths on a router mounted at /
// Convert app.X to router.X; keep absolute /api/... paths; mount with app.use(legacyRoutes)
let legacy = restBlock.replace(/\bapp\.(get|post|put|patch|delete|options|use)\(/g, 'router.$1(');

// Wrap with imports for models/middleware used
const legacyFile = `/**
 * Remaining inline routes lifted from app.js (catalog, admin extras, legacy stubs).
 * Mounted at application root so paths stay /api/...
 */
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { verifyToken, verifySuperAdmin, verifyAdmin } from '../middleware/auth.js';
import { extractAuthToken } from '../utils/auth-cookie.js';
import {
  generateProvisionalPassword,
  resolveTenantAdminId,
  SAFE_USER_UPDATE_FIELDS,
} from '../utils/secure-tenant.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import LearningPath from '../models/LearningPath.js';
import Assessment from '../models/Assessment.js';
import Teacher from '../models/Teacher.js';
import Subject from '../models/Subject.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import Event from '../models/Event.js';
import { getBackendRoot } from '../bootstrap/env.js';

const router = express.Router();
const __dirname = getBackendRoot();

const requireAuth = (req, res, next) => {
  const token = extractAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    req.userId = decoded.userId || decoded.id || decoded._id;
    req.isAuthenticated = () => true;
    next();
  } catch {
    res.status(401).json({ message: 'Not authenticated' });
  }
};
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admin access required' });
};

const buildSafeAppendQuestionPipeline = (questionId) => [
  { \$set: { questions: { \$cond: [{ \$isArray: '\$questions' }, '\$questions', []] } } },
  { \$set: { questions: { \$concatArrays: ['\$questions', [questionId]] } } },
];
const buildSafeRemoveQuestionPipeline = (questionId) => [
  { \$set: { questions: { \$cond: [{ \$isArray: '\$questions' }, '\$questions', []] } } },
  {
    \$set: {
      questions: {
        \$filter: {
          input: '\$questions',
          as: 'existingQuestionId',
          cond: { \$ne: ['\$\$existingQuestionId', questionId] },
        },
      },
    },
  },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

${legacy}

export default router;
`;

fs.writeFileSync(join(root, 'routes', 'legacyInline.js'), legacyFile);

// Clean app.js cuts and wire mounts
app = app.replace(/\/\*CUT:[^*]+\*\/\n/g, '');

// Remove orphaned requireAuth block if catalog moved it - requireAuth may still be in app for nothing
// Remove JWT auth middleware comment block if only requireAuth left unused - check

if (!app.includes("healthRoutes")) {
  app = app.replace(
    "import authRoutes, { usersRouter } from './routes/auth.js';",
    `import authRoutes, { usersRouter } from './routes/auth.js';
import healthRoutes from './routes/health.js';
import proxyRoutes from './routes/proxy.js';
import calendarPublicRoutes from './routes/calendarPublic.js';
import legacyInlineRoutes from './routes/legacyInline.js';`,
  );
}

// Insert health + proxy early (after uploads CORS middleware, where health was)
const healthInsert = `app.use('/api/health', healthRoutes);
app.use(proxyRoutes);
`;
// Find db reconnect gate or OPTIONS catch-all
const optsIdx = app.indexOf('app.options(/^\\/api\\/.*/');
if (optsIdx < 0) throw new Error('options catch-all missing');
// Insert health/proxy before options catch-all if not present
if (!app.includes("app.use('/api/health'")) {
  app = app.slice(0, optsIdx) + healthInsert + '\n' + app.slice(optsIdx);
}

// calendar public before auth
if (!app.includes('calendarPublicRoutes')) {
  app = app.replace(
    '// Auth domain (before role routers',
    `app.use('/api', calendarPublicRoutes);

// Auth domain (before role routers`,
  );
}

// legacy after timetable mounts
if (!app.includes('legacyInlineRoutes')) {
  app = app.replace(
    "app.use('/api/timetable', timetableRoutes);",
    `app.use('/api/timetable', timetableRoutes);
app.use(legacyInlineRoutes);`,
  );
}

fs.writeFileSync(appPath, app);
console.log('PR3 extract done. app.js lines', app.split(/\n/).length);
