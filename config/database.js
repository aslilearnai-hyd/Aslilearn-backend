import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables - explicitly specify path
const envPath = join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });

// Debug: Log if .env file was found
if (result.error) {
  console.warn('⚠️  Warning: Could not load .env file:', result.error.message);
  console.warn('   Attempted path:', envPath);
} else {
  console.log('✅ Loaded .env file from:', envPath);
}

// MONGO_URI from .env (loaded above)
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  console.error('   Please set MONGO_URI in your .env file');
  process.exit(1);
}

// Log which database is being connected to (without showing password)
const uriForLogging = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
const dbName = MONGO_URI.split('/').pop()?.split('?')[0] || 'Unknown';
console.log('🔌 Connecting to MongoDB...');
console.log('📍 URI:', uriForLogging);
console.log('📦 Database:', dbName);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const connectedDbName = conn.connection.db.databaseName;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database Name: ${connectedDbName}`);
    
    // Set up connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;








