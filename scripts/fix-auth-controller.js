import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'controllers', 'authController.js');
let s = fs.readFileSync(path, 'utf8');

// Function endings incorrectly left as `});` from app.post wrappers
s = s.replace(/^}\);$/gm, '}');

// Dynamic imports from controllers/
s = s.replace(/import\('\.\//g, "import('../");
s = s.replace(/import\("\.\//g, 'import("../');

fs.writeFileSync(path, s);
console.log('fixed endings', (s.match(/^}$/gm) || []).length);
