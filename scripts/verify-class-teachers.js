/**
 * Verify Class 6C Teachers Assignment
 * 
 * This script verifies that teachers are properly assigned to Class 6C
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';

const ADMIN_EMAIL = 'brahmamtalent@gmail.com';
const CLASS_NUMBER = '6';
const CLASS_SECTION = 'C';

async function verify() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find admin
    const admin = await User.findOne({ email: ADMIN_EMAIL, role: 'admin' });
    if (!admin) {
      throw new Error('Admin not found');
    }

    // Find class 6C
    const classDoc = await Class.findOne({
      classNumber: CLASS_NUMBER,
      section: CLASS_SECTION,
      assignedAdmin: admin._id
    });

    if (!classDoc) {
      throw new Error('Class 6C not found');
    }

    console.log(`📋 Class 6C Details:`);
    console.log(`   ID: ${classDoc._id}`);
    console.log(`   Name: ${classDoc.name}`);
    console.log(`   Class Number: ${classDoc.classNumber}`);
    console.log(`   Section: ${classDoc.section}\n`);

    // Find all teachers for this admin
    const teachers = await Teacher.find({ adminId: admin._id, isActive: true });
    console.log(`👨‍🏫 Found ${teachers.length} teachers for this admin\n`);

    const classIdStr = classDoc._id.toString();
    console.log(`🔍 Looking for class ID: ${classIdStr}\n`);

    let assignedTeachers = [];
    let notAssignedTeachers = [];

    for (const teacher of teachers) {
      console.log(`\n📝 Teacher: ${teacher.fullName}`);
      console.log(`   Email: ${teacher.email}`);
      console.log(`   assignedClassIds: ${JSON.stringify(teacher.assignedClassIds)}`);
      
      if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
        console.log(`   ❌ No assigned classes`);
        notAssignedTeachers.push(teacher);
      } else {
        const hasClass = teacher.assignedClassIds.some(id => {
          const idStr = String(id);
          const matches = idStr === classIdStr;
          if (matches) {
            console.log(`   ✅ Found class ID match: ${idStr}`);
          }
          return matches;
        });
        
        if (hasClass) {
          assignedTeachers.push(teacher);
        } else {
          console.log(`   ❌ Class ID not found in assignedClassIds`);
          notAssignedTeachers.push(teacher);
        }
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Assigned to Class 6C: ${assignedTeachers.length}`);
    console.log(`   ❌ Not assigned: ${notAssignedTeachers.length}`);

    if (assignedTeachers.length > 0) {
      console.log(`\n✅ Assigned Teachers:`);
      assignedTeachers.forEach(t => {
        console.log(`   - ${t.fullName} (${t.email})`);
      });
    }

    if (notAssignedTeachers.length > 0) {
      console.log(`\n❌ Not Assigned Teachers:`);
      notAssignedTeachers.forEach(t => {
        console.log(`   - ${t.fullName} (${t.email})`);
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verify();
