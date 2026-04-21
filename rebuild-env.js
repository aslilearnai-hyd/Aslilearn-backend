// Completely rebuild .env file from scratch
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '.env');

console.log('🔧 Rebuilding .env file from scratch...');
console.log('');

// Create clean .env content
const envContent = `# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration - REQUIRED
MONGO_URI=mongodb+srv://akhileshsamayamanthula:rxvIPIT4Bzobk9Ne@cluster0.4ej8ne2.mongodb.net/Asli?retryWrites=true&w=majority&appName=Cluster0

# JWT Configuration - REQUIRED
JWT_SECRET=33e5d04de5698b678209074e1c412adc39f792cd1f81d8dfacbd89f38601cf38

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Super Admin Credentials (Optional - for initial setup only)
SUPER_ADMIN_EMAIL=amenityforge@gmail.com
SUPER_ADMIN_PASSWORD=Amenity

# Local LLM (LM Studio) Configuration
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=mistralai/mistral-7b-instruct-v0.3
`;

// Write as UTF-8 without BOM
const buffer = Buffer.from(envContent, 'utf8');
fs.writeFileSync(envPath, buffer);

console.log('✅ Created new .env file');
console.log('');

// Verify
import dotenv from 'dotenv';
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ Error:', result.error.message);
} else {
  console.log('✅ dotenv parsed successfully');
  if (result.parsed) {
    const keys = Object.keys(result.parsed);
    console.log('   Found', keys.length, 'environment variables:', keys.join(', '));
    
    if (result.parsed.MONGO_URI) {
      console.log('');
      console.log('✅ MONGO_URI is loaded!');
      console.log('   Value (first 50 chars):', result.parsed.MONGO_URI.substring(0, 50) + '...');
    } else {
      console.log('');
      console.log('❌ MONGO_URI still not found');
    }
  }
}







