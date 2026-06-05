/**
 * Attempt partial recovery: rebuild school + admin rows from orphaned adminId
 * references still present in content/exams/etc.
 *
 * Usage: node scripts/recover-schools-from-orphans.js
 *        node scripts/recover-schools-from-orphans.js --dry-run
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User.js';
import School from '../models/School.js';
import { applySchoolToAdminUser } from '../services/schoolService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const COLS = ['contents', 'exams', 'assessments', 'videos', 'classes', 'examresults', 'teachers'];
const dryRun = process.argv.includes('--dry-run');

async function collectOrphanAdminIds(db) {
  const map = new Map();

  for (const col of COLS) {
    try {
      const cursor = db.collection(col).find({ adminId: { $exists: true, $ne: null } });
      for await (const doc of cursor) {
        const id = String(doc.adminId);
        if (!map.has(id)) {
          map.set(id, { adminId: id, hints: { schoolNames: new Set(), emails: new Set(), boards: new Set() } });
        }
        const h = map.get(id).hints;
        if (doc.schoolName) h.schoolNames.add(String(doc.schoolName).trim());
        if (doc.board) h.boards.add(String(doc.board).trim());
        if (doc.metadata?.schoolName) h.schoolNames.add(String(doc.metadata.schoolName).trim());
        if (doc.createdByEmail) h.emails.add(String(doc.createdByEmail).trim());
      }
    } catch {
      // ignore missing collections
    }
  }

  return map;
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const orphans = await collectOrphanAdminIds(db);

  console.log(`Found ${orphans.size} orphaned adminId(s) in content\n`);
  if (!orphans.size) {
    console.log('Nothing to recover from content references. Use MongoDB Atlas backup.');
    process.exit(0);
  }

  const defaultPassword = process.env.RECOVERY_ADMIN_PASSWORD || 'TempRestore123!';
  const hashed = await bcrypt.hash(defaultPassword, 12);

  let created = 0;
  for (const [adminId, row] of orphans) {
    const existingUser = await User.findById(adminId);
    const existingSchool = await School.findOne({ adminUserId: adminId });
    if (existingUser && existingSchool) {
      console.log(`Skip ${adminId} — already exists`);
      continue;
    }

    const schoolName =
      [...row.hints.schoolNames].find(Boolean) ||
      `Recovered School ${adminId.slice(-6)}`;
    const email =
      [...row.hints.emails].find((e) => e.includes('@')) ||
      `recovered.${adminId.slice(-8)}@aslilearn.restore`;
    const board = [...row.hints.boards][0] || 'ASLI_EXCLUSIVE_SCHOOLS';

    console.log(`\nRecover: ${schoolName}`);
    console.log(`  adminId: ${adminId}`);
    console.log(`  email: ${email} (change password after login)`);

    if (dryRun) continue;

    let admin = existingUser;
    if (!admin) {
      admin = new User({
        _id: new mongoose.Types.ObjectId(adminId),
        email: email.toLowerCase(),
        password: hashed,
        fullName: schoolName,
        role: 'admin',
        schoolName,
        board,
        isActive: true,
      });
      await admin.save();
    }

    let school = existingSchool;
    if (!school) {
      school = await School.create({
        name: schoolName,
        adminUserId: admin._id,
        board,
        curriculumBoard: board === 'ASLI_EXCLUSIVE_SCHOOLS' ? 'CBSE' : board,
        isAsliPrepExclusive: board === 'ASLI_EXCLUSIVE_SCHOOLS',
        contactPerson: admin.fullName,
        isActive: true,
      });
    }

    applySchoolToAdminUser(admin, school);
    await admin.save();
    created += 1;
  }

  const totalSchools = await School.countDocuments();
  const totalAdmins = await User.countDocuments({ role: 'admin' });

  console.log('\n--- Summary ---');
  if (dryRun) {
    console.log('Dry run only. Re-run without --dry-run to create records.');
  } else {
    console.log(`Created/linked: ${created}`);
    console.log(`Recovery login password (all new admins): ${defaultPassword}`);
    console.log('Change passwords after first login.');
  }
  console.log(`Schools now: ${totalSchools}, Admins now: ${totalAdmins}`);
  console.log('\nThis only recovers schools tied to leftover content. For ALL deleted schools, use Atlas backup.');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
