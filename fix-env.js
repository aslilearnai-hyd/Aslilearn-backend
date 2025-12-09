// Fix .env file - remove BOM and trailing spaces
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '.env');

console.log('🔧 Fixing .env file...');
console.log('');

// Read the file
let content = fs.readFileSync(envPath, 'utf8');

// Remove BOM if present
if (content.charCodeAt(0) === 0xFEFF) {
  console.log('✅ Removed BOM (Byte Order Mark)');
  content = content.slice(1);
}

// Clean up each line: remove trailing spaces and ensure proper format
const lines = content.split('\n');
const cleanedLines = lines.map(line => {
  // Remove trailing whitespace
  let cleaned = line.trimEnd();
  
  // For lines with =, ensure no spaces around =
  if (cleaned.includes('=') && !cleaned.trim().startsWith('#')) {
    const [key, ...valueParts] = cleaned.split('=');
    const value = valueParts.join('='); // Rejoin in case value contains =
    cleaned = `${key.trim()}=${value.trim()}`;
  }
  
  return cleaned;
});

// Join back together
const fixedContent = cleanedLines.join('\n');

// Write back without BOM
fs.writeFileSync(envPath, fixedContent, { encoding: 'utf8' });

console.log('✅ Fixed .env file');
console.log('');
console.log('📄 Fixed content:');
console.log('---');
console.log(fixedContent);
console.log('---');
console.log('');

// Verify it works
import dotenv from 'dotenv';
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ Still has error:', result.error.message);
} else {
  console.log('✅ dotenv can now parse the file');
  if (result.parsed?.MONGO_URI) {
    console.log('✅ MONGO_URI is now loaded!');
    console.log('   Value (first 30 chars):', result.parsed.MONGO_URI.substring(0, 30) + '...');
  } else {
    console.log('❌ MONGO_URI still not found');
    console.log('   Available keys:', Object.keys(result.parsed || {}).join(', '));
  }
}




