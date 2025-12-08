// Fix .env file - remove BOM completely
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '.env');

console.log('🔧 Fixing .env file (removing BOM)...');
console.log('');

// Read as buffer to handle BOM properly
const buffer = fs.readFileSync(envPath);
let content;

// Check for UTF-8 BOM (EF BB BF)
if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
  console.log('✅ Found UTF-8 BOM, removing...');
  content = buffer.slice(3).toString('utf8');
} else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
  console.log('✅ Found UTF-16 BE BOM, removing...');
  content = buffer.slice(2).toString('utf16le');
} else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
  console.log('✅ Found UTF-16 LE BOM, removing...');
  content = buffer.slice(2).toString('utf16le');
} else {
  console.log('📄 No BOM detected, reading as UTF-8...');
  content = buffer.toString('utf8');
}

// Clean up lines
const lines = content.split(/\r?\n/);
const cleanedLines = lines.map(line => {
  // Remove trailing whitespace
  let cleaned = line.replace(/\s+$/, '');
  
  // For non-comment lines with =, ensure no spaces around =
  if (cleaned.includes('=') && !cleaned.trim().startsWith('#')) {
    const trimmed = cleaned.trim();
    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=');
    cleaned = `${key.trim()}=${value.trim()}`;
  } else {
    cleaned = cleaned.trimEnd();
  }
  
  return cleaned;
}).filter(line => line.length > 0 || line === ''); // Keep empty lines for structure

// Join with newlines
const fixedContent = cleanedLines.join('\n') + '\n';

// Write back as UTF-8 without BOM
const outputBuffer = Buffer.from(fixedContent, 'utf8');
fs.writeFileSync(envPath, outputBuffer);

console.log('✅ Written .env file without BOM');
console.log('');

// Verify
console.log('🔍 Verifying...');
const verifyBuffer = fs.readFileSync(envPath);
console.log('   First 3 bytes (hex):', Array.from(verifyBuffer.slice(0, 3)).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
if (verifyBuffer[0] === 0xEF && verifyBuffer[1] === 0xBB && verifyBuffer[2] === 0xBF) {
  console.log('   ❌ BOM still present!');
} else {
  console.log('   ✅ No BOM detected');
}

// Test parsing
import dotenv from 'dotenv';
const result = dotenv.config({ path: envPath });

console.log('');
if (result.error) {
  console.error('❌ Parse error:', result.error.message);
} else {
  console.log('✅ dotenv parsed successfully');
  if (result.parsed) {
    const keys = Object.keys(result.parsed);
    console.log('   Found', keys.length, 'environment variables');
    if (result.parsed.MONGO_URI) {
      console.log('   ✅ MONGO_URI is loaded!');
      console.log('      Value (first 40 chars):', result.parsed.MONGO_URI.substring(0, 40) + '...');
    } else {
      console.log('   ❌ MONGO_URI not found');
      console.log('   Available keys:', keys.join(', '));
      
      // Show the actual MONGO_URI line from file
      const fileContent = verifyBuffer.toString('utf8');
      const mongoLine = fileContent.split('\n').find(l => l.includes('MONGO_URI'));
      if (mongoLine) {
        console.log('   📄 MONGO_URI line in file:', mongoLine.substring(0, 80));
      }
    }
  }
}



