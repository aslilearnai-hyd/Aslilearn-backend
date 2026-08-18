import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = join(__dirname, '..');

/**
 * Load backend/.env and fail fast on required secrets.
 * @returns {{ envResult: import('dotenv').DotenvConfigOutput, parsedEnv: Record<string, string> }}
 */
export function loadEnv() {
  const envPath = join(backendRoot, '.env');
  const envResult = dotenv.config({ path: envPath });

  if (envResult.error) {
    console.warn('⚠️  Warning: Could not load .env file:', envResult.error.message);
    console.warn('   Attempted path:', envPath);
  } else {
    console.log('✅ Loaded .env file from:', envPath);
    if (envResult.parsed) {
      const hasMongoUri = 'MONGO_URI' in envResult.parsed;
      console.log('📋 Environment variables loaded:', Object.keys(envResult.parsed).length);
      console.log('🔍 MONGO_URI in parsed env:', hasMongoUri);
      if (hasMongoUri) {
        const mongoUriValue = envResult.parsed.MONGO_URI;
        console.log(
          '🔍 MONGO_URI value (first 30 chars):',
          mongoUriValue ? mongoUriValue.substring(0, 30) + '...' : 'EMPTY',
        );
      }
    }
    console.log('🔍 MONGO_URI in process.env:', !!process.env.MONGO_URI);
    if (process.env.MONGO_URI) {
      console.log(
        '🔍 process.env.MONGO_URI (first 30 chars):',
        process.env.MONGO_URI.substring(0, 30) + '...',
      );
    }
  }

  const REQUIRED_SECRETS = ['JWT_SECRET', 'MONGO_URI'];
  const missingSecrets = REQUIRED_SECRETS.filter((k) => !String(process.env[k] || '').trim());
  if (missingSecrets.length) {
    console.error(
      `\n❌ FATAL: required environment variable(s) missing: ${missingSecrets.join(', ')}`,
    );
    console.error('   Set them in the environment. There are no defaults — that is deliberate.\n');
    process.exit(1);
  }
  if (String(process.env.JWT_SECRET).length < 16) {
    console.error('\n❌ FATAL: JWT_SECRET is shorter than 16 characters. Use a long random value.\n');
    process.exit(1);
  }

  const parsedEnv = !envResult.error && envResult.parsed ? envResult.parsed : {};

  // .env file wins over stale PM2/systemd values for Razorpay.
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
    const fromFile = parsedEnv[k];
    if (fromFile != null && String(fromFile).trim()) {
      process.env[k] = String(fromFile).trim();
    }
  }
  const rzpId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const rzpSecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (rzpId && rzpSecret) {
    const mode = rzpId.startsWith('rzp_live_')
      ? 'live'
      : rzpId.startsWith('rzp_test_')
        ? 'test'
        : 'unknown';
    console.log(
      `🔐 Razorpay: mode=${mode} keyIdLen=${rzpId.length} secretLen=${rzpSecret.length}${
        rzpSecret.startsWith('rzp_') ? ' (KEY_ID and KEY_SECRET look swapped)' : ''
      }`,
    );
  } else {
    console.warn('⚠️  Razorpay keys missing in .env (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  }

  return { envResult, parsedEnv };
}

export function getBackendRoot() {
  return backendRoot;
}
