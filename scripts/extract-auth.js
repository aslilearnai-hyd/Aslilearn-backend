/**
 * Extract auth handlers from app.js into controllers/authController.js + routes/auth.js
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = join(root, 'app.js');
let app = fs.readFileSync(appPath, 'utf8');

const cuts = [];

function cutRange(startStr, endStr, label) {
  const s = app.indexOf(startStr);
  if (s < 0) throw new Error(`missing start ${label}: ${startStr}`);
  const e = app.indexOf(endStr, s);
  if (e < 0) throw new Error(`missing end ${label}: ${endStr}`);
  const block = app.slice(s, e);
  app = app.slice(0, s) + `/*EXTRACTED:${label}*/\n` + app.slice(e);
  cuts.push({ label, block });
  return block;
}

// Bottom-up so markers stay valid
cutRange(
  "app.post('/api/auth/login', loginLimiter",
  '// Public catalog routes',
  'login',
);
cutRange("app.options('/api/auth/login'", "/*EXTRACTED:login*/", 'loginOptions');
cutRange(
  "app.post('/api/auth/register', signupLimiter",
  "/*EXTRACTED:loginOptions*/",
  'register',
);
cutRange(
  "app.patch('/api/users/:userId', requireAuth",
  '// Calendar API',
  'patchUser',
);
cutRange(
  "app.get('/api/auth/trial-login-quizzes', requireAuth",
  "/*EXTRACTED:patchUser*/",
  'trialQuizzes',
);
cutRange(
  "app.get('/api/auth/me', requireAuth",
  '/** Unfinished trial-only',
  'me',
);
cutRange(
  "app.post('/api/auth/reset-password', loginLimiter",
  '// JWT auth middleware',
  'resetPassword',
);
cutRange(
  "app.post('/api/auth/forgot-password', loginLimiter",
  "/*EXTRACTED:resetPassword*/",
  'forgotPassword',
);
cutRange(
  "app.post('/api/auth/refresh', loginLimiter",
  "/*EXTRACTED:forgotPassword*/",
  'refresh',
);
cutRange(
  '// Auth routes (define before other routes to avoid conflicts)',
  "/*EXTRACTED:refresh*/",
  'logoutBlock',
);

const by = Object.fromEntries(cuts.map((c) => [c.label, c.block]));

function toNamedExport(routeBlock, exportName) {
  const arrowRe =
    /app\.(get|post|patch|put|delete|options)\([\s\S]*?,\s*(async\s*)?\((req,\s*res(?:,\s*next)?)\)\s*=>\s*/;
  const m = routeBlock.match(arrowRe);
  if (!m) {
    console.error(routeBlock.slice(0, 300));
    throw new Error(`cannot parse ${exportName}`);
  }
  const isAsync = !!m[2];
  const bodyStart = m.index + m[0].length;
  let body = routeBlock.slice(bodyStart).trim();
  if (body.endsWith(');')) body = body.slice(0, -2).trim();
  const prefix = isAsync ? 'export async function' : 'export function';
  return `${prefix} ${exportName}(req, res) ${body}\n`;
}

const controller = `/**
 * Auth domain handlers (lifted from app.js — behavior preserved).
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  extractRefreshToken,
} from '../utils/auth-cookie.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import {
  isVidyaEnabledForStudents,
  isVidyaEnabledForTeachers,
} from '../utils/vidyaSchoolAccess.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

${toNamedExport(by.logoutBlock, 'logout')}
${toNamedExport(by.refresh, 'refresh')}
${toNamedExport(by.forgotPassword, 'forgotPassword')}
${toNamedExport(by.resetPassword, 'resetPassword')}
${toNamedExport(by.me, 'me')}
${toNamedExport(by.trialQuizzes, 'trialLoginQuizzes')}
${toNamedExport(by.patchUser, 'patchUser')}
${toNamedExport(by.register, 'register')}
${toNamedExport(by.login, 'login')}
`;

fs.writeFileSync(join(root, 'controllers', 'authController.js'), controller);

const routes = `import express from 'express';
import { loginLimiter, signupLimiter } from '../middleware/rate-limit.js';
import { loginSchema, validateRequest } from '../validators/superAdminValidator.js';
import { verifyToken } from '../middleware/auth.js';
import {
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  me,
  trialLoginQuizzes,
  patchUser,
  register,
  login,
} from '../controllers/authController.js';

const router = express.Router();

router.post('/logout', logout);
router.post('/refresh', loginLimiter, refresh);
router.post('/forgot-password', loginLimiter, forgotPassword);
router.post('/reset-password', loginLimiter, resetPassword);
router.get('/me', verifyToken, me);
router.get('/trial-login-quizzes', verifyToken, trialLoginQuizzes);
router.post('/register', signupLimiter, register);
router.options('/login', (req, res) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
router.post('/login', loginLimiter, validateRequest(loginSchema), login);

export default router;

/** Profile patch under /api/users — mount separately. */
export const usersRouter = express.Router();
usersRouter.patch('/:userId', verifyToken, patchUser);
`;

fs.writeFileSync(join(root, 'routes', 'auth.js'), routes);

app = app.replace(/\/\*EXTRACTED:[^*]+\*\/\n/g, '');

if (!app.includes("from './routes/auth.js'")) {
  app = app.replace(
    "import timetableRoutes from './routes/timetable.js';",
    "import timetableRoutes from './routes/timetable.js';\nimport authRoutes, { usersRouter } from './routes/auth.js';",
  );
}

const mountNeedle = "// Mount routes\napp.use('/api/super-admin'";
const mountNeedleCR = "// Mount routes\r\napp.use('/api/super-admin'";
let mi = app.indexOf(mountNeedle);
if (mi < 0) mi = app.indexOf(mountNeedleCR);
if (mi < 0) throw new Error('mount routes not found');
if (!app.includes("app.use('/api/auth', authRoutes)")) {
  app =
    app.slice(0, mi) +
    `// Auth domain (before role routers — /api/auth/me must not be shadowed)
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRouter);

` +
    app.slice(mi);
}

fs.writeFileSync(appPath, app);
console.log('OK. cuts:', cuts.map((c) => c.label).join(', '));
console.log('app.js lines', app.split(/\n/).length);
