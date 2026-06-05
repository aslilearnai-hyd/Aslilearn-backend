/**
 * Recreate rows in `schools` from existing admin users (after partial DB restore).
 * School Management only lists the schools collection — not admin users alone.
 *
 * Usage: node scripts/rebuild-schools-from-admins.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User.js';
import School from '../models/School.js';
import { applySchoolToAdminUser, normalizeSchoolDetails } from '../services/schoolService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

async function main() {
  await connectDB();

  const admins = await User.find({ role: 'admin' }).select('-password');
  if (!admins.length) {
    console.log('No admin users found. Restore users from Atlas backup first, then run this script.');
    process.exit(0);
  }

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const admin of admins) {
    const existing = await School.findOne({ adminUserId: admin._id });
    if (existing) {
      applySchoolToAdminUser(admin, existing);
      await admin.save();
      skipped += 1;
      continue;
    }

    if (admin.schoolId) {
      const byId = await School.findById(admin.schoolId);
      if (byId) {
        byId.adminUserId = admin._id;
        await byId.save();
        applySchoolToAdminUser(admin, byId);
        await admin.save();
        linked += 1;
        continue;
      }
    }

    const name = String(admin.schoolName || admin.fullName || admin.email || 'School').trim();
    const school = await School.create({
      name,
      adminUserId: admin._id,
      board: admin.board || 'ASLI_EXCLUSIVE_SCHOOLS',
      curriculumBoard: admin.curriculumBoard || 'CBSE',
      isAsliPrepExclusive: Boolean(admin.isAsliPrepExclusive),
      contactPerson: admin.contactPerson || admin.fullName || '',
      phone: admin.phone || '',
      secondaryContactPerson: admin.secondaryContactPerson || '',
      secondaryContactPhone: admin.secondaryContactPhone || '',
      place: admin.place || '',
      pin: admin.pin || '',
      schoolLogo: admin.schoolLogo || '',
      schoolDetails: normalizeSchoolDetails(admin.schoolDetails, admin.schoolDetails?.state),
      isActive: admin.isActive !== false,
    });

    applySchoolToAdminUser(admin, school);
    await admin.save();
    created += 1;
    console.log(`✅ School created for ${admin.email} → ${name}`);
  }

  const total = await School.countDocuments();
  console.log(`\nDone. created=${created} linked=${linked} skipped=${skipped} total schools=${total}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
