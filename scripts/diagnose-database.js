/**
 * Quick counts for School Management debugging.
 * Usage: node scripts/diagnose-database.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import User from '../models/User.js';
import School from '../models/School.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

async function main() {
  await connectDB();
  const dbName = User.db.name;

  const [schools, admins, students, teachers, classes, superAdmins] = await Promise.all([
    School.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'student' }),
    Teacher.countDocuments(),
    Class.countDocuments(),
    User.countDocuments({ role: 'super-admin' }),
  ]);

  const adminsWithoutSchool = await User.find({ role: 'admin' })
    .select('email schoolName fullName schoolId isActive')
    .lean();

  console.log('\n=== ASLI-LEARN database diagnosis ===');
  console.log('Database:', dbName);
  console.log('Schools collection (what School Management lists):', schools);
  console.log('Admin users (role=admin):', admins);
  console.log('Students:', students);
  console.log('Teachers:', teachers);
  console.log('Classes:', classes);
  console.log('Super-admins:', superAdmins);

  if (schools === 0 && admins === 0) {
    console.log('\n⚠️  School Management shows "No Schools Found" because BOTH are empty.');
    console.log('   This usually means data was deleted from MongoDB.');
    console.log('   Recovery: MongoDB Atlas → Backup → Point-in-Time Restore (before delete).');
  } else if (schools === 0 && admins > 0) {
    console.log('\n⚠️  Admin logins exist but schools collection is empty.');
    console.log('   Run: node scripts/rebuild-schools-from-admins.js');
  }

  if (adminsWithoutSchool.length) {
    console.log('\nAdmin accounts (first 10):');
    for (const a of adminsWithoutSchool.slice(0, 10)) {
      console.log(`  - ${a.email} | ${a.schoolName || a.fullName} | active=${a.isActive !== false}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
