/**
 * Recreate core accounts after accidental deletion from MongoDB.
 * Does NOT restore other deleted users — use Atlas backup / point-in-time restore for that.
 *
 * Usage (from backend folder):
 *   node scripts/restore-core-users.js
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

/** Accounts that should exist in the users collection */
const CORE_USERS = [
  {
    email: 'sealucknow2017@gmail.com',
    password: 'Asli123',
    fullName: 'Super Admin',
    role: 'super-admin',
  },
  {
    email: 'amenityforge@gmail.com',
    password: 'Amenity',
    fullName: 'Super Admin',
    role: 'super-admin',
  },
];

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
    console.log(`✅ Updated existing user: ${email} (role=${config.role}, id=${user._id})`);
    return user;
  }

  user = new User({
    email,
    password: hashedPassword,
    fullName: config.fullName,
    role: config.role,
    isActive: true,
  });
  await user.save();
  console.log(`✅ Created user: ${email} (role=${config.role}, id=${user._id})`);
  return user;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set in backend/.env');
    process.exit(1);
  }

  await connectDB();
  console.log('Connected to MongoDB\n');

  for (const config of CORE_USERS) {
    await ensureUser(config);
  }

  const counts = await User.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  console.log('\nCurrent user counts by role:');
  for (const row of counts) {
    console.log(`  ${row._id}: ${row.count}`);
  }

  console.log('\n--- Super Admin login (also works without DB row) ---');
  console.log('  Email:    sealucknow2017@gmail.com');
  console.log('  Password: Asli123');
  console.log('  Endpoint: POST /api/super-admin/login  OR  POST /api/auth/login');
  console.log('\nTo recover ALL deleted users, use MongoDB Atlas → Backup → Restore / Point-in-Time.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Restore failed:', err.message || err);
  process.exit(1);
});
