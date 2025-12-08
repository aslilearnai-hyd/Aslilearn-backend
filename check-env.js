// Quick script to check .env file contents
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '.env');

console.log('📁 Checking .env file at:', envPath);
console.log('');

// Check if file exists
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file does not exist!');
  process.exit(1);
}

console.log('✅ .env file exists');
console.log('');

// Read raw file content
const fileContent = fs.readFileSync(envPath, 'utf8');
console.log('📄 File content:');
console.log('---');
console.log(fileContent);
console.log('---');
console.log('');

// Check for MONGO_URI in raw content
const lines = fileContent.split('\n');
const mongoUriLine = lines.find(line => line.includes('MONGO_URI'));
console.log('🔍 MONGO_URI line found:', mongoUriLine || 'NOT FOUND');
console.log('');

// Try to parse with dotenv
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ Error parsing .env:', result.error.message);
} else {
  console.log('✅ dotenv parsed successfully');
  console.log('');
  console.log('📋 Parsed environment variables:');
  if (result.parsed) {
    Object.keys(result.parsed).forEach(key => {
      const value = result.parsed[key];
      if (key === 'MONGO_URI') {
        console.log(`  ${key}=${value.substring(0, 30)}...`);
      } else {
        console.log(`  ${key}=${value}`);
      }
    });
  }
  console.log('');
  console.log('🔍 MONGO_URI in parsed:', !!result.parsed?.MONGO_URI);
  console.log('🔍 MONGO_URI in process.env:', !!process.env.MONGO_URI);
}



