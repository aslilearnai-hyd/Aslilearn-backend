/**
 * Fix ai/** imports of /shared/ that resolve to missing files.
 * Prefer generators/shared, rag/pdf/shared, then ai/shared.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const genSharedDir = path.join(root, 'ai/generators/shared');
const pdfSharedDir = path.join(root, 'ai/rag/pdf/shared');
const aiSharedDir = path.join(root, 'ai/shared');

function relImportBetween(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function resolveSharedFile(file) {
  const name = file.endsWith('.js') || file.endsWith('.cjs') ? file : `${file}.js`;
  for (const dir of [genSharedDir, pdfSharedDir, aiSharedDir]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fixFile(abs) {
  let text = fs.readFileSync(abs, 'utf8');
  let n = 0;
  text = text.replace(/from\s+(['"])([^'"]*\/shared\/)([^'"]+)\1/g, (full, q, pre, file) => {
    const current = path.normalize(path.join(path.dirname(abs), pre + file));
    if (fs.existsSync(current)) return full;
    const target = resolveSharedFile(file);
    if (!target) return full;
    const out = relImportBetween(abs, target);
    n++;
    return `from ${q}${out}${q}`;
  });
  if (n > 0) {
    fs.writeFileSync(abs, text);
  }
  return n;
}

function walk(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) total += walk(abs);
    else if (ent.name.endsWith('.js')) {
      const c = fixFile(abs);
      if (c) console.log(path.relative(root, abs).replace(/\\/g, '/'), c);
      total += c;
    }
  }
  return total;
}

console.log('shared-path fixes', walk(path.join(root, 'ai')));
