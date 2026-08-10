import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

/**
 * Recovery script for the "Promote Students" bug (fixed in adminController.js,
 * see the "never set isActive:false" comment in the Class-12 promotion path).
 *
 * Before the fix, promoting a batch past Class 12 marked those students
 * `classNumber: 'Finished'` AND `isActive: false` in the same update. The
 * `isActive: false` flag blocks login ("Account is deactivated") and drops
 * them out of active-student counts/filters — so they looked deleted even
 * though the record was never removed.
 *
 * This script finds any student still stuck in that state and reactivates
 * them (isActive: true). It does NOT touch classNumber, assignedClass, or
 * any other field — those are already correct ("Finished").
 *
 * Usage:
 *   node fix-finished-class-inactive-students.js            (dry run — lists matches only)
 *   node fix-finished-class-inactive-students.js --apply     (actually flips isActive: true)
 */
async function main() {
  const apply = process.argv.includes('--apply');

  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not set in environment variables!');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to MongoDB\n');

  try {
    const affected = await User.find({
      role: 'student',
      classNumber: 'Finished',
      isActive: false,
    }).select('email fullName assignedAdmin classNumber isActive');

    console.log('============================================================');
    console.log('FINISHED-CLASS STUDENTS STUCK DEACTIVATED');
    console.log('============================================================');
    console.log(`Found ${affected.length} student(s) matching the bug signature\n`);

    if (affected.length === 0) {
      console.log('Nothing to fix.');
      return;
    }

    for (const student of affected) {
      console.log(
        `${apply ? '🔧 Reactivating' : '👀 Would reactivate'}: ${student.email || student._id} ` +
          `(${student.fullName || 'no name'}) — admin ${student.assignedAdmin || 'none'}`,
      );
    }

    if (apply) {
      const result = await User.updateMany(
        { role: 'student', classNumber: 'Finished', isActive: false },
        { $set: { isActive: true } },
      );
      console.log(`\n✅ Reactivated ${result.modifiedCount} student(s).`);
    } else {
      console.log(`\nDry run only — no changes made. Re-run with --apply to fix these ${affected.length} account(s).`);
    }
  } catch (error) {
    console.error('Error fixing finished-class students:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

main();
