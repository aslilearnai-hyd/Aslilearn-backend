/**
 * Phase 1b: split routes/legacyInline.js into domain routers.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = join(root, 'routes', 'legacyInline.js');
const src = fs.readFileSync(legacyPath, 'utf8');

function between(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(`missing ${startMarker}`);
  const e = endMarker ? src.indexOf(endMarker, s) : src.length;
  if (e < 0) throw new Error(`missing end ${endMarker}`);
  return src.slice(s, e);
}

const sharedHeader = `import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { join, extname } from 'path';
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

`;

const pipelines = between(
  'const buildSafeAppendQuestionPipeline',
  'const upload = multer',
);

const uploadBlock = between('const upload = multer', "router.get('/api/videos'");

// Catalog: public GETs + quizzes/subjects + video/assessment mutate
const catalogGets = between("router.get('/api/videos'", "router.use('/api/admin', requireAuth, requireAdmin)");
const catalogTail = between("router.get('/api/quizzes'", "router.get('/api/super-admin/admins'");

// Admin media (videos/learning-paths) under requireAuth
const adminMedia = between(
  "router.use('/api/admin', requireAuth, requireAdmin)",
  "const eventPhotoUpload = multer",
);

// Events
const eventPhoto = between('const eventPhotoUpload = multer', "router.get('/api/admin/events'");
const events = between("router.get('/api/admin/events'", "router.post('/api/admin/assessments-legacy-unauth'");

// Admin extras: users/teachers/subjects/exams/test + legacy unauth stubs
const adminExtras = between(
  "router.post('/api/admin/assessments-legacy-unauth'",
  "router.get('/api/quizzes'",
);

// Super-admin extras through lesson-plan
const superExtras = between(
  "router.get('/api/super-admin/admins'",
  "export default router",
);

function write(name, body, extraImports = '') {
  const content = `${sharedHeader}${extraImports}${pipelines}${uploadBlock}${body}\n\nexport default router;\n`;
  fs.writeFileSync(join(root, 'routes', name), content);
  console.log('wrote', name, content.split(/\n/).length, 'lines');
}

write(
  'catalog.js',
  catalogGets + '\n' + catalogTail,
);

write(
  'adminMediaLegacy.js',
  adminMedia,
);

write(
  'adminEvents.js',
  eventPhoto + events,
);

write(
  'adminExtrasLegacy.js',
  adminExtras,
);

write(
  'superAdminExtrasLegacy.js',
  superExtras,
);

// Replace legacyInline with aggregator
const aggregator = `/**
 * Aggregates Phase 1b domain splits (backward-compatible mount point).
 * Prefer mounting the individual routers from app.js.
 */
import catalogRoutes from './catalog.js';
import adminMediaLegacyRoutes from './adminMediaLegacy.js';
import adminEventsRoutes from './adminEvents.js';
import adminExtrasLegacyRoutes from './adminExtrasLegacy.js';
import superAdminExtrasLegacyRoutes from './superAdminExtrasLegacy.js';
import express from 'express';

const router = express.Router();
router.use(catalogRoutes);
router.use(adminMediaLegacyRoutes);
router.use(adminEventsRoutes);
router.use(adminExtrasLegacyRoutes);
router.use(superAdminExtrasLegacyRoutes);

export default router;
export {
  catalogRoutes,
  adminMediaLegacyRoutes,
  adminEventsRoutes,
  adminExtrasLegacyRoutes,
  superAdminExtrasLegacyRoutes,
};
`;

fs.writeFileSync(legacyPath, aggregator);
console.log('legacyInline.js is now an aggregator');
