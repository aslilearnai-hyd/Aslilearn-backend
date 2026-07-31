import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'legacyInline.js');
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/import\('\.\//g, "import('../");
s = s.replace(/import\("\.\//g, 'import("../');
fs.writeFileSync(p, s);
console.log('fixed legacy imports');
