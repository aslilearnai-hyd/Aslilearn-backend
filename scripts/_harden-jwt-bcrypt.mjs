import fs from 'fs';

const path = 'E:/Asli learn/backend/index.js';
let s = fs.readFileSync(path, 'utf8');

s = s.replace(/jwt\.verify\(([^,]+),\s*([^,\)]+)\)/g, (m, a, b) => {
  if (m.includes('algorithms')) return m;
  return `jwt.verify(${a}, ${b}, { algorithms: ['HS256'] })`;
});

s = s.replace(
  /jwt\.sign\(([\s\S]*?),\s*(process\.env\.JWT_SECRET|jwtSecret),\s*\{([^}]*)\}\s*\)/g,
  (m, payload, secret, opts) => {
    if (opts.includes('algorithm')) return m;
    const trimmed = opts.trim().replace(/,\s*$/, '');
    return `jwt.sign(${payload}, ${secret}, { ${trimmed}, algorithm: 'HS256' })`;
  },
);

s = s.replace(/bcrypt\.hash\(([^,]+),\s*10\)/g, 'bcrypt.hash($1, 12)');

fs.writeFileSync(path, s);
console.log('index.js jwt+bcrypt hardened');
