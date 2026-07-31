/**
 * Normalize ../../.. depth for imports from ai/** into backend top-level folders.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP = new Set([
  'models',
  'services',
  'config',
  'utils',
  'constants',
  'middleware',
  'controllers',
  'queues',
  'bootstrap',
  'prompts',
  'routes',
  'tests',
]);

function depthToBackend(fileRel) {
  // ai/rag/pdf/x.js → 3
  return fileRel.split('/').length - 1;
}

function fixFile(fileRel) {
  const abs = path.join(root, fileRel);
  let text = fs.readFileSync(abs, 'utf8');
  const depth = depthToBackend(fileRel);
  const prefix = '../'.repeat(depth);
  let n = 0;

  const replacer = (full, q, _dots, folder, rest) => {
    const next = `from ${q}${prefix}${folder}/${rest}${q}`;
    if (next !== full.replace(/from\s+/, 'from ').replace(/\s+/g, ' ') && full !== `from ${q}${prefix}${folder}/${rest}${q}`) {
      // compare specs only
    }
    const newFull = `from ${q}${prefix}${folder}/${rest}${q}`;
    if (newFull !== full) n++;
    return newFull;
  };

  text = text.replace(
    /from\s+(['"])((?:\.\.\/)+)([A-Za-z0-9_-]+)\/([^'"]+)\1/g,
    (full, q, dots, folder, rest) => {
      if (!TOP.has(folder)) return full;
      const newFull = `from ${q}${prefix}${folder}/${rest}${q}`;
      if (newFull !== full) n++;
      return newFull;
    },
  );

  text = text.replace(
    /import\s*\(\s*(['"])((?:\.\.\/)+)([A-Za-z0-9_-]+)\/([^'"]+)\1\s*\)/g,
    (full, q, dots, folder, rest) => {
      if (!TOP.has(folder)) return full;
      const newFull = `import(${q}${prefix}${folder}/${rest}${q})`;
      if (newFull !== full) n++;
      return newFull;
    },
  );

  // require() for cjs
  text = text.replace(
    /require\s*\(\s*(['"])((?:\.\.\/)+)([A-Za-z0-9_-]+)\/([^'"]+)\1\s*\)/g,
    (full, q, dots, folder, rest) => {
      if (!TOP.has(folder)) return full;
      const newFull = `require(${q}${prefix}${folder}/${rest}${q})`;
      if (newFull !== full) n++;
      return newFull;
    },
  );

  if (n > 0) fs.writeFileSync(abs, text);
  return n;
}

function walk(dir, base = 'ai') {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${ent.name}`.replace(/\\/g, '/');
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) total += walk(abs, rel);
    else if (/\.(js|cjs)$/.test(ent.name)) {
      const c = fixFile(rel);
      if (c) console.log(rel, c);
      total += c;
    }
  }
  return total;
}

console.log('fixed specs', walk(path.join(root, 'ai')));
