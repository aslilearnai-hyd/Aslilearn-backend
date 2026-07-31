/**
 * Fix relative imports between modules under backend/ai/*.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AI_TOP = new Set([
  'prompt-engine',
  'prompt-registry',
  'prompt-versioning',
  'generators',
  'rag',
  'validation',
  'quality-gates',
  'repair',
  'streaming',
  'providers',
  // note: do NOT include 'shared' — ambiguous (ai/shared vs generators/shared vs rag/pdf/shared)
]);

function relImportBetween(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function fixFile(fileRel) {
  const abs = path.join(root, fileRel);
  let text = fs.readFileSync(abs, 'utf8');
  let n = 0;

  const rewrite = (full, kind, q, dots, folder, rest) => {
    if (!AI_TOP.has(folder)) return full;
    const targetRel = `ai/${folder}/${rest}`;
    let out = relImportBetween(fileRel, targetRel);
    if (!out.endsWith('.js') && !out.endsWith('.cjs') && rest.endsWith('.js')) {
      // rest already has extension
    }
    const rebuilt =
      kind === 'from'
        ? `from ${q}${out}${q}`
        : kind === 'import'
          ? `import(${q}${out}${q})`
          : `require(${q}${out}${q})`;
    if (rebuilt !== full) n++;
    return rebuilt;
  };

  text = text.replace(
    /from\s+(['"])((?:\.\.\/)+)([A-Za-z0-9_-]+)\/([^'"]+)\1/g,
    (full, q, dots, folder, rest) => rewrite(full, 'from', q, dots, folder, rest),
  );
  text = text.replace(
    /import\s*\(\s*(['"])((?:\.\.\/)+)([A-Za-z0-9_-]+)\/([^'"]+)\1\s*\)/g,
    (full, q, dots, folder, rest) => rewrite(full, 'import', q, dots, folder, rest),
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

console.log('intra-ai fixes', walk(path.join(root, 'ai')));
