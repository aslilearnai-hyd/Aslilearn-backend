/**
 * Rewrite migration shims: only export default when the target actually has one.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, base = '') {
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'ai', 'uploads', '.git', 'qa-results'].includes(ent.name)) continue;
    const rel = path.join(base, ent.name).replace(/\\/g, '/');
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      n += walk(abs, rel);
      continue;
    }
    if (!ent.name.endsWith('.js')) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (text.length >= 400) continue;
    const m = text.match(/export \{ default \} from ['"]([^'"]+)['"]/);
    if (!m) continue;
    const spec = m[1];
    const targetAbs = path.normalize(path.join(path.dirname(abs), spec));
    if (!fs.existsSync(targetAbs)) {
      console.warn('missing target', rel, '→', spec);
      continue;
    }
    const target = fs.readFileSync(targetAbs, 'utf8');
    const hasDefault =
      /\bexport\s+default\b/.test(target) ||
      /\bexport\s*\{[^}]*\bdefault\b/.test(target);
    const shim = hasDefault
      ? `export { default } from '${spec}';\nexport * from '${spec}';\n`
      : `export * from '${spec}';\n`;
    if (shim !== text) {
      fs.writeFileSync(abs, shim);
      console.log(hasDefault ? 'default+star' : 'star-only', rel);
      n++;
    }
  }
  return n;
}

console.log('shim updates', walk(root));
