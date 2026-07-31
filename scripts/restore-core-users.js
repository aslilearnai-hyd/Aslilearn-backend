/**
 * Recreate core accounts after accidental deletion from MongoDB.
 * Does NOT restore other deleted users — use Atlas backup / point-in-time restore for that.
 *
 * Passwords MUST come from environment — never hardcode.
 *
 * Usage (from backend folder):
 *   CORE_SUPER_ADMIN_EMAIL=... CORE_SUPER_ADMIN_PASSWORD='...' node scripts/restore-core-users.js
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function buildCoreUsers() {
  const email = process.env.CORE_SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.CORE_SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set CORE_SUPER_ADMIN_EMAIL and CORE_SUPER_ADMIN_PASSWORD (min 12 chars) before restore.'
    );
  }
  if (password.length < 12) {
    throw new Error('CORE_SUPER_ADMIN_PASSWORD must be at least 12 characters');
  }
  const users = [
    {
      email,
      password,
      fullName: process.env.CORE_SUPER_ADMIN_NAME || 'Super Admin',
      role: 'super-admin',
    },
  ];
  if (process.env.CORE_USERS_JSON) {
    const extra = JSON.parse(process.env.CORE_USERS_JSON);
    for (const row of extra) {
      if (!row?.email || !row?.password || String(row.password).length < 12) {
        throw new Error('Each CORE_USERS_JSON entry needs email and password (≥12 chars)');
      }
      users.push({
        email: row.email,
        password: row.password,
        fullName: row.fullName || row.email,
        role: row.role || 'super-admin',
      });
    }
  }
  return users;
}

async function ensureUser(config) {
  const email = config.email.toLowerCase().trim();
  const hashedPassword = await bcrypt.hash(config.password, 12);

  let user = await User.findOne({ email });
  if (user) {
    user.password = hashedPassword;
    user.fullName = config.fullName;
    user.role = config.role;
    user.isActive = true;
    await user.save();
    console.log(`Updated ${email}`);
    return;
  }
  await User.create({
    email,
    password: hashedPassword,
    fullName: config.fullName,
    role: config.role,
    isActive: true,
  });
  console.log(`Created ${email}`);
}

async function main() {
  const CORE_USERS = buildCoreUsers();
  await connectDB();
  for (const config of CORE_USERS) {
    await ensureUser(config);
  }
  console.log('Core users restored. Use Atlas PITR for full data recovery.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
