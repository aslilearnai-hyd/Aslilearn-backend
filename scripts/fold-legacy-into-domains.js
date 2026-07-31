/**
 * Fold unique legacy routes into admin.js / superAdmin.js and create stubs.
 * Rewrites adminEvents paths to relative /events for mount under domain routers.
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routes = join(root, 'routes');

let eventsSrc = fs.readFileSync(join(routes, 'adminEvents.js'), 'utf8');

// Split super-admin events handler out
const saMarker = "router.get('/api/super-admin/events/:adminId'";
const saIdx = eventsSrc.indexOf(saMarker);
if (saIdx < 0) throw new Error('super-admin events missing');
const saBlock = eventsSrc.slice(saIdx);
eventsSrc = eventsSrc.slice(0, saIdx);

// Rewrite admin event paths to relative
eventsSrc = eventsSrc
  .replace(/router\.get\('\/api\/admin\/events'/g, "router.get('/events'")
  .replace(/router\.post\('\/api\/admin\/events'/g, "router.post('/events'")
  .replace(/router\.put\('\/api\/admin\/events\/:id'/g, "router.put('/events/:id'")
  .replace(/router\.delete\('\/api\/admin\/events\/:id'/g, "router.delete('/events/:id'");

// Trim bulky unused shared header pieces — keep as-is for safety, write as adminEventRoutes.js
const adminEventsOut = eventsSrc.replace(
  /export default router;\s*$/,
  'export default router;\n',
);
fs.writeFileSync(join(routes, 'adminEventRoutes.js'), adminEventsOut);

// Super-admin events → relative path
const saHandler = saBlock
  .replace(
    "router.get('/api/super-admin/events/:adminId'",
    "router.get('/events/:adminId'",
  )
  .replace(/export default router;\s*$/, '');

const saFile = `import express from 'express';
import Event from '../models/Event.js';
import { verifyToken, verifySuperAdmin } from '../middleware/auth.js';

const router = express.Router();

${saHandler}

export default router;
`;
// The saBlock still has verifyToken on the route - when mounted under superAdmin which already has auth, double-auth is ok.
// Strip verifyToken, verifySuperAdmin from route if present since parent applies them
const saClean = saFile.replace(
  /router\.get\('\/events\/:adminId', verifyToken, verifySuperAdmin,/,
  "router.get('/events/:adminId',",
);
fs.writeFileSync(join(routes, 'superAdminEventRoutes.js'), saClean);

// Learning paths from adminMediaLegacy
let media = fs.readFileSync(join(routes, 'adminMediaLegacy.js'), 'utf8');
const lpStart = media.indexOf("router.post('/api/admin/learning-paths'");
const lpEnd = media.indexOf('// Event photo upload storage');
// after our fix, event storage was removed - find delete learning path end
const lpOnly = (() => {
  const s = media.indexOf("router.post('/api/admin/learning-paths'");
  if (s < 0) throw new Error('learning-paths missing');
  // take through last learning-paths delete
  const d = media.indexOf("router.delete('/api/admin/learning-paths/:id'");
  const end = media.indexOf('\n});', d) + 4;
  return media.slice(s, end);
})();

const lpRoutes = `import express from 'express';
import LearningPath from '../models/LearningPath.js';

const router = express.Router();

${lpOnly
  .replace(/\/api\/admin\/learning-paths/g, '/learning-paths')}

export default router;
`;
fs.writeFileSync(join(routes, 'adminLearningPathRoutes.js'), lpRoutes);

// Users from adminExtrasLegacy
let extras = fs.readFileSync(join(routes, 'adminExtrasLegacy.js'), 'utf8');
const usersStart = extras.indexOf("router.get('/api/admin/users'");
const usersEnd = extras.indexOf("router.get('/api/admin/teachers'");
if (usersStart < 0 || usersEnd < 0) throw new Error('users block missing');
const usersBlock = extras.slice(usersStart, usersEnd);

const usersRoutes = `import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import {
  generateProvisionalPassword,
  resolveTenantAdminId,
  SAFE_USER_UPDATE_FIELDS,
} from '../utils/secure-tenant.js';

const router = express.Router();

${usersBlock.replace(/\/api\/admin\/users/g, '/users')}

export default router;
`;
fs.writeFileSync(join(routes, 'adminUsersRoutes.js'), usersRoutes);

// Lesson plan from superAdminExtrasLegacy
let superEx = fs.readFileSync(join(routes, 'superAdminExtrasLegacy.js'), 'utf8');
const lpGen = (() => {
  const s = superEx.indexOf("router.post('/api/lesson-plan/generate'");
  if (s < 0) throw new Error('lesson-plan missing');
  const end = superEx.indexOf('\n});', s) + 4;
  return superEx.slice(s, end);
})();

fs.writeFileSync(
  join(routes, 'lessonPlan.js'),
  `import express from 'express';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

${lpGen.replace("router.post('/api/lesson-plan/generate', verifyToken,", "router.post('/generate', verifyToken,")}

export default router;
`,
);

// Collect STUB_410 from catalog + extras into legacyStubs.js
const stubPaths = [
  ["post", '/api/quizzes'],
  ["put", '/api/quizzes/:id'],
  ["delete", '/api/quizzes/:id'],
  ["patch", '/api/quizzes/:id/toggle'],
  ["get", '/api/videos/legacy-public'],
  ["post", '/api/videos'],
  ["post", '/api/subjects'],
  ["put", '/api/subjects/:id'],
  ["delete", '/api/subjects/:id'],
  ["post", '/api/subjects/:id/videos'],
  ["post", '/api/subjects/:id/quizzes'],
  ["post", '/api/admin/assessments-legacy-unauth'],
  ["put", '/api/admin/assessments/:id/legacy-unauth'],
  ["delete", '/api/admin/assessments/:id/legacy-unauth'],
  ["get", '/api/admin/exams'],
  ["post", '/api/admin/exams'],
  ["put", '/api/admin/exams/:id'],
  ["delete", '/api/admin/exams/:id'],
  ["post", '/api/test-video'],
  ["post", '/api/test-video-simple'],
  ["post", '/api/super-simple-video'],
  ["post", '/api/create-assessment'],
  ["post", '/api/emergency-video-create'],
  ["post", '/api/teacher-assessments-admin-style'],
];

let stubs = `import express from 'express';
const router = express.Router();
const gone = (msg = 'Removed.') => (_req, res) =>
  res.status(410).json({ success: false, message: msg });

`;
for (const [method, path] of stubPaths) {
  if (path.includes('/admin/exams') && method === 'get') {
    stubs += `router.get('${path}', (_req, res) => res.status(410).json({ success: false, message: 'Use /api/admin/exams/viewable' }));\n`;
  } else if (path.includes('/admin/exams')) {
    stubs += `router.${method}('${path}', (_req, res) => res.status(403).json({ success: false, message: 'Admins cannot create or edit exams' }));\n`;
  } else {
    stubs += `router.${method}('${path}', gone());\n`;
  }
}
stubs += `\nexport default router;\n`;
fs.writeFileSync(join(routes, 'legacyStubs.js'), stubs);

console.log('Wrote adminEventRoutes, superAdminEventRoutes, adminLearningPathRoutes, adminUsersRoutes, lessonPlan, legacyStubs');
