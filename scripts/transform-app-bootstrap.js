/**
 * One-shot transform: index-copy app.js → export createApp().
 * Run from backend/: node scripts/transform-app-bootstrap.js
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dirname, '..', 'app.js');
let src = fs.readFileSync(appPath, 'utf8');

const helperEnd = src.indexOf('// Load environment variables');
if (helperEnd < 0) throw new Error('env block not found');
let head = src.slice(0, helperEnd);

head = head
  .replace(/import passport from 'passport';\r?\n/, '')
  .replace(/import \{ Strategy as LocalStrategy \} from 'passport-local';\r?\n/, '')
  .replace(/import dotenv from 'dotenv';\r?\n/, '')
  .replace(/import \{ configureMongoDns \} from '\.\/config\/mongo-dns\.js';\r?\n/, '')
  .replace(
    /import \{ MONGOOSE_CONNECT_OPTIONS, attachMongooseConnectionListeners \} from '\.\/config\/mongoose-options\.js';\r?\n/,
    '',
  )
  .replace(
    /import \{\s*getAssessments,\s*getVideos,\s*getQuizzes,\s*getAnalytics,\s*\} from '\.\/controllers\/adminController\.js';\r?\n/,
    '',
  )
  .replace(
    /import \{\s*listAiToolChildren[\s\S]*?\} from '\.\/controllers\/aiToolGenerationsController\.js';\r?\n/,
    '',
  )
  .replace(
    /import \{\s*listSchoolOrders[\s\S]*?\} from '\.\/controllers\/schoolOrderController\.js';\r?\n/,
    '',
  )
  .replace(
    /import \{\s*listOrderCatalog[\s\S]*?\} from '\.\/controllers\/orderCatalogController\.js';\r?\n/,
    '',
  );

const preamble = `import { getAllowedOrigins } from './bootstrap/cors-origins.js';
import { getBackendRoot } from './bootstrap/env.js';

/**
 * Build the Express application (middleware + routes). Does not listen or connect Mongo.
 * @param {{ parsedEnv?: Record<string, string> }} [options]
 */
export function createApp(options = {}) {
  const parsedEnv = options.parsedEnv || {};
  const __dirname = getBackendRoot();

`;

const appStart = src.indexOf('const app = express();');
if (appStart < 0) throw new Error('app = express not found');

const mongoStart = src.indexOf('// MongoDB connection - MUST be set');
const middlewareStart = src.indexOf('// Middleware\nconst allowedOrigins');
const middlewareStartCR = src.indexOf('// Middleware\r\nconst allowedOrigins');
const mwStart = middlewareStart >= 0 ? middlewareStart : middlewareStartCR;
if (mongoStart < 0 || mwStart < 0) throw new Error('mongo/middleware markers missing');

let body = src.slice(appStart, mongoStart) + src.slice(mwStart);

body = body.replace(
  /const allowedOrigins = \[[\s\S]*?\]\.filter\(Boolean\);/,
  'const allowedOrigins = getAllowedOrigins();',
);

body = body.replace(
  /\/\/ Same handlers under \/api\/super-admin[\s\S]*?app\.get\('\/api\/admin\/analytics', verifyToken, verifyAdmin, extractAdminId, getAnalytics\);\r?\n/,
  '// Duplicate /api/super-admin/* and /api/admin GET mounts removed — served by domain routers.\n',
);

body = body.replace(
  /\/\*\r?\n \* Session middleware REMOVED[\s\S]*?passport\.deserializeUser\(async \(id, done\) => \{[\s\S]*?\}\);\r?\n\r?\n/,
  '// Passport LocalStrategy removed (unused; JWT auth only).\n\n',
);

body = body.replace(
  /\/\/ Routes \(requireAuth\/requireAdmin defined earlier, before mount\)\r?\napp\.get\('\/api\/health', \(req, res\) => \{\r?\n  res\.json\(\{ status: 'OK', timestamp: new Date\(\)\.toISOString\(\) \}\);\r?\n\}\);\r?\n\r?\n/,
  '',
);

body = body.replace(
  /\/\/ Health endpoint with CORS headers \(handle both GET and OPTIONS\)\r?\napp\.get\('\/api\/health',[\s\S]*?app\.options\('\/api\/health',[\s\S]*?\}\);\r?\n/,
  '// Extra /api/health duplicate removed (single health registered earlier).\n',
);

body = body.replace(
  /\/\/ Health check endpoint\r?\napp\.get\('\/api\/health', \(req, res\) => \{[\s\S]*?\}\);\r?\n\r?\n/,
  '',
);

body = body.replace(
  /const parsedEnv = !envResult\.error && envResult\.parsed \? envResult\.parsed : \{\};\r?\n/,
  '',
);

const listenIdx = body.indexOf('const server = app.listen');
if (listenIdx < 0) throw new Error('listen not found');
body = body.slice(0, listenIdx) + '  return app;\n}\n';

const out = head + preamble + body;
fs.writeFileSync(appPath, out);
console.log('Wrote app.js lines:', out.split(/\n/).length);
