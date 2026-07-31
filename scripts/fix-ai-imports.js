/**
 * Fix broken relative imports in ai/ after migration (multiline from clauses).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const moveMap = new Map();

function walkShims(dir, base = '') {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'ai' || ent.name === 'uploads' || ent.name === '.git') {
      continue;
    }
    const rel = path.join(base, ent.name).replace(/\\/g, '/');
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkShims(abs, rel);
      continue;
    }
    if (!/\.(js|cjs)$/.test(ent.name)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (text.length >= 400) continue;
    const m = text.match(/export \{ default \} from ['"]([^'"]+)['"]/);
    const m2 = text.match(/module\.exports = require\(['"]([^'"]+)['"]\)/);
    const spec = m?.[1] || m2?.[1];
    if (!spec) continue;
    const target = path.normalize(path.join(path.dirname(abs), spec));
    const newRel = path.relative(root, target).replace(/\\/g, '/');
    moveMap.set(rel, newRel);
  }
}

walkShims(root);
console.log('shim map size', moveMap.size);

const reverseMap = new Map();
for (const [o, n] of moveMap) reverseMap.set(n.replace(/\\/g, '/'), o);

function relImportBetween(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function resolveNewTarget(newRel, spec) {
  const oldRel = reverseMap.get(newRel.replace(/\\/g, '/'));
  const base = path.basename(spec);

  if (oldRel) {
    const oldAbs = path.normalize(path.join(root, path.dirname(oldRel), spec));
    let oldTargetRel = path.relative(root, oldAbs).replace(/\\/g, '/');
    if (!moveMap.has(oldTargetRel) && moveMap.has(`${oldTargetRel}.js`)) {
      oldTargetRel = `${oldTargetRel}.js`;
    }
    if (moveMap.has(oldTargetRel)) return moveMap.get(oldTargetRel);
  }

  // Fallback: moved sibling that lived under services/ or utils/
  for (const prefix of ['services/', 'utils/', 'config/', 'prompts/', 'constants/', 'queues/']) {
    const candidate = prefix + base;
    if (moveMap.has(candidate)) return moveMap.get(candidate);
    if (!base.endsWith('.js') && moveMap.has(candidate + '.js')) return moveMap.get(candidate + '.js');
  }

  // Relative from current new file as-is (unmoved target)
  if (oldRel) {
    const oldAbs = path.normalize(path.join(root, path.dirname(oldRel), spec));
    return path.relative(root, oldAbs).replace(/\\/g, '/');
  }
  return null;
}

function fixFile(newRel) {
  const abs = path.join(root, newRel);
  if (!fs.existsSync(abs)) return 0;
  let content = fs.readFileSync(abs, 'utf8');
  let n = 0;

  content = content.replace(/from\s+(['"])(\.[^'"]+)\1/g, (full, q, spec) => {
    const target = resolveNewTarget(newRel, spec);
    if (!target) return full;
    let outSpec = relImportBetween(newRel, target);
    if (spec.endsWith('.js') && !outSpec.endsWith('.js') && !outSpec.endsWith('.cjs')) outSpec += '.js';
    if (spec.endsWith('.cjs') && !outSpec.endsWith('.cjs')) outSpec += '.cjs';
    if (outSpec === spec) return full;
    // Avoid rewriting already-correct deep imports that happen to differ by normalization
    const resolvedNow = path.normalize(path.join(root, path.dirname(newRel), spec));
    const resolvedOut = path.normalize(path.join(root, path.dirname(newRel), outSpec));
    if (resolvedNow === resolvedOut) return full;
    n++;
    return `from ${q}${outSpec}${q}`;
  });

  content = content.replace(/import\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g, (full, q, spec) => {
    const target = resolveNewTarget(newRel, spec);
    if (!target) return full;
    let outSpec = relImportBetween(newRel, target);
    if (spec.endsWith('.js') && !outSpec.endsWith('.js') && !outSpec.endsWith('.cjs')) outSpec += '.js';
    if (outSpec === spec) return full;
    const resolvedNow = path.normalize(path.join(root, path.dirname(newRel), spec));
    const resolvedOut = path.normalize(path.join(root, path.dirname(newRel), outSpec));
    if (resolvedNow === resolvedOut) return full;
    n++;
    return `import(${q}${outSpec}${q})`;
  });

  if (n > 0) fs.writeFileSync(abs, content);
  return n;
}

function walkAi(dir, base = 'ai') {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${ent.name}`.replace(/\\/g, '/');
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) total += walkAi(abs, rel);
    else if (/\.(js|cjs)$/.test(ent.name)) {
      const c = fixFile(rel);
      if (c) console.log('fixed', rel, c);
      total += c;
    }
  }
  return total;
}

const total = walkAi(path.join(root, 'ai'));
console.log('total fixes', total);

// dotenv: providers is two levels below backend
const gs = path.join(root, 'ai/providers/gemini-service.js');
if (fs.existsSync(gs)) {
  let gst = fs.readFileSync(gs, 'utf8');
  gst = gst.replace(
    /dotenv\.config\(\{\s*path:\s*join\(__dirname,\s*'\.\.',\s*'\.env'\)\s*\}\)/,
    "dotenv.config({ path: join(__dirname, '..', '..', '.env') })",
  );
  fs.writeFileSync(gs, gst);
  console.log('dotenv path checked/fixed');
}
