/**
 * Import VI C Students and Staff Script
 * 
 * This script imports students and staff from Excel files for Brahmam Talent High School
 * and creates class 6C, linking all students and teachers to it.
 * 
 * Usage: node backend/scripts/import-vi-c-data.js
 */

import mongoose from 'mongoose';
import XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import models
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import Subject from '../models/Subject.js';

const ADMIN_EMAIL = 'brahmamtalent@gmail.com';
const SCHOOL_NAME = 'Brahmam Talent High School';
const CLASS_NUMBER = '6';
const CLASS_SECTION = 'C';
const DEFAULT_PASSWORD = 'Password123';

// Connect to MongoDB
async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not set in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Read Excel file
function readExcelFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
  } catch (error) {
    console.error(`❌ Error reading Excel file ${filePath}:`, error);
    throw error;
  }
}

// Generate email from name
function generateEmail(fullName, schoolEmail) {
  const nameParts = fullName.toLowerCase().trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];
  const baseEmail = schoolEmail.split('@')[0];
  return `${firstName}.${lastName}@${baseEmail.split('@')[0]}.com`;
}

// Main import function
async function importData() {
  try {
    await connectDB();

    // Find admin
    console.log(`\n🔍 Finding admin: ${ADMIN_EMAIL}`);
    const admin = await User.findOne({ email: ADMIN_EMAIL, role: 'admin' });
    
    if (!admin) {
      throw new Error(`Admin not found with email: ${ADMIN_EMAIL}`);
    }
    
    console.log(`✅ Found admin: ${admin.fullName || admin.email}`);
    console.log(`   School: ${admin.schoolName || 'N/A'}`);
    console.log(`   Board: ${admin.board || 'N/A'}`);

    const adminId = admin._id;
    const adminBoard = admin.board || 'ASLI_EXCLUSIVE_SCHOOLS';
    const adminSchoolName = admin.schoolName || SCHOOL_NAME;

    // Read Excel files
    const studentFilePath = path.join(__dirname, '../VI C STUDENT LIST.xlsx');
    const staffFilePath = path.join(__dirname, '../VI C STAFF LIST.xlsx');

    console.log(`\n📖 Reading student file: ${studentFilePath}`);
    const studentData = readExcelFile(studentFilePath);
    console.log(`✅ Found ${studentData.length} students in Excel`);

    console.log(`\n📖 Reading staff file: ${staffFilePath}`);
    const staffData = readExcelFile(staffFilePath);
    console.log(`✅ Found ${staffData.length} staff members in Excel`);

    // Create or get class 6C
    console.log(`\n🏫 Creating/Getting class ${CLASS_NUMBER}${CLASS_SECTION}`);
    let classDoc = await Class.findOne({
      classNumber: CLASS_NUMBER,
      section: CLASS_SECTION,
      assignedAdmin: adminId
    });

    if (!classDoc) {
      classDoc = new Class({
        classNumber: CLASS_NUMBER,
        section: CLASS_SECTION,
        name: `Class ${CLASS_NUMBER}${CLASS_SECTION}`,
        description: `Class ${CLASS_NUMBER}${CLASS_SECTION} for ${adminSchoolName}`,
        board: adminBoard,
        school: adminSchoolName,
        assignedAdmin: adminId,
        isActive: true,
        assignedSubjects: []
      });
      await classDoc.save();
      console.log(`✅ Created class ${CLASS_NUMBER}${CLASS_SECTION}`);
    } else {
      console.log(`✅ Class ${CLASS_NUMBER}${CLASS_SECTION} already exists`);
    }

    const classId = classDoc._id;

    // Create subjects based on staff list
    console.log(`\n📚 Creating subjects...`);
    const subjectMap = new Map(); // Map subject names to Subject IDs
    
    // Define subjects from staff list
    const subjectNames = [
      'ENGLISH',
      'SL TELUGU', // Second Language Telugu
      'SL HINDI',  // Second Language Hindi
      'TL TELUGU', // Third Language Telugu
      'TL HINDI',  // Third Language Hindi
      'MATHS',
      'PHY/CHE',   // Physics/Chemistry
      'BIO',       // Biology
      'SOCIAL'     // Social Studies
    ];

    for (const subjectName of subjectNames) {
      try {
        // Check if subject already exists
        let subject = await Subject.findOne({ 
          name: subjectName.trim(), 
          board: adminBoard 
        });

        if (!subject) {
          // Create new subject
          subject = new Subject({
            name: subjectName.trim(),
            board: adminBoard,
            classNumber: CLASS_NUMBER,
            description: `${subjectName} for Class ${CLASS_NUMBER}`,
            isActive: true,
            createdBy: 'super-admin'
          });
          await subject.save();
          console.log(`✅ Created subject: ${subjectName}`);
        } else {
          console.log(`⚠️  Subject already exists: ${subjectName}`);
        }
        
        subjectMap.set(subjectName.toUpperCase(), subject._id);
      } catch (error) {
        console.error(`❌ Error creating subject ${subjectName}:`, error.message);
      }
    }

    // Import students
    console.log(`\n👥 Importing students...`);
    const createdStudents = [];
    const skippedStudents = [];

    // Log first row to see structure
    if (studentData.length > 0) {
      console.log(`\n📋 Sample student row structure:`, Object.keys(studentData[0]));
    }

    for (let i = 0; i < studentData.length; i++) {
      const row = studentData[i];
      try {
        // Extract student data - try multiple column name variations
        const fullName = row['Name'] || row['Student Name'] || row['Full Name'] || row['NAME'] || 
                        row['name'] || row['student name'] || row['full name'] ||
                        row['Name of Student'] || row['Student'] || Object.values(row)[0] || '';
        const email = row['Email'] || row['EMAIL'] || row['email'] || 
                     row['Email ID'] || row['Email Id'] || generateEmail(fullName, ADMIN_EMAIL);
        const phone = row['Phone'] || row['PHONE'] || row['phone'] || 
                     row['Mobile'] || row['mobile'] || row['Contact'] || row['contact'] || 
                     row['Phone Number'] || row['Mobile Number'] || '';
        const rollNumber = row['Roll No'] || row['Roll Number'] || row['RollNo'] || 
                          row['ROLL NO'] || row['roll no'] || row['Roll'] || row['roll'] || '';

        if (!fullName || fullName.toString().trim() === '') {
          console.log(`⚠️  Skipping row ${i + 1}: Missing name`);
          skippedStudents.push({ row: i + 1, reason: 'Missing name' });
          continue;
        }

        // Check if student already exists
        const existingStudent = await User.findOne({ email: email.toLowerCase() });
        if (existingStudent) {
          console.log(`⚠️  Student already exists: ${fullName} (${email})`);
          skippedStudents.push({ name: fullName, email, reason: 'Already exists' });
          
          // Update existing student to link to class if not already linked
          if (!existingStudent.assignedClass || existingStudent.assignedClass.toString() !== classId.toString()) {
            existingStudent.assignedClass = classId;
            existingStudent.classNumber = `${CLASS_NUMBER}${CLASS_SECTION}`;
            await existingStudent.save();
            console.log(`   ✅ Updated existing student to link to class ${CLASS_NUMBER}${CLASS_SECTION}`);
          }
          continue;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

        // Create student
        const newStudent = new User({
          email: email.toLowerCase(),
          password: hashedPassword,
          fullName: fullName.trim(),
          role: 'student',
          isActive: true,
          classNumber: `${CLASS_NUMBER}${CLASS_SECTION}`,
          phone: phone ? phone.toString().trim() : '',
          assignedAdmin: adminId,
          assignedClass: classId,
          board: adminBoard,
          schoolName: adminSchoolName
        });

        await newStudent.save();
        createdStudents.push({ name: fullName, email, id: newStudent._id });
        console.log(`✅ Created student: ${fullName} (${email})`);
      } catch (error) {
        console.error(`❌ Error creating student at row ${i + 1}:`, error.message);
        skippedStudents.push({ row: i + 1, reason: error.message });
      }
    }

    console.log(`\n📊 Student Import Summary:`);
    console.log(`   ✅ Created: ${createdStudents.length}`);
    console.log(`   ⚠️  Skipped: ${skippedStudents.length}`);

    // Import teachers/staff
    console.log(`\n👨‍🏫 Importing teachers/staff...`);
    const createdTeachers = [];
    const skippedTeachers = [];

    // Log first row to see structure
    if (staffData.length > 0) {
      console.log(`\n📋 Sample staff row structure:`, Object.keys(staffData[0]));
      console.log(`📋 Sample staff row values:`, Object.values(staffData[0]));
    }

    for (let i = 0; i < staffData.length; i++) {
      const row = staffData[i];
      try {
        // Skip rows that are clearly headers or empty
        const rowValues = Object.values(row).filter(v => v !== null && v !== undefined && v !== '');
        if (rowValues.length === 0) {
          continue;
        }

        // Extract teacher data - try multiple column name variations
        // Based on Excel: Column A = S NO, Column B = Staff Name, Column C = Subject
        let fullName = row['Staff Name'] || row['Name'] || row['Teacher Name'] || row['Full Name'] || 
                      row['NAME'] || row['name'] || row['teacher name'] || row['staff name'] ||
                      row['Name of Teacher'] || row['Teacher'] || row['Staff'] || '';
        
        // If no name found in standard columns, try to get from column B (index 1)
        if (!fullName || fullName.toString().trim() === '') {
          const rowArray = Object.values(row);
          // Column B is typically index 1 (after S NO)
          if (rowArray.length > 1 && rowArray[1]) {
            const nameCandidate = rowArray[1].toString().trim();
            if (nameCandidate && nameCandidate.length > 2 && !nameCandidate.match(/^(S\.?NO|SNO|NO|Add|Remove|Columns|__EMPTY|Staff Name)/i)) {
              fullName = nameCandidate;
            }
          }
          // Fallback: find first meaningful value
          if (!fullName || fullName.length < 2) {
            const firstValue = rowValues.find(v => {
              const str = v.toString().trim();
              return str && str.length > 2 && !str.match(/^(S\.?NO|SNO|NO|Add|Remove|Columns|__EMPTY)/i);
            });
            fullName = firstValue ? firstValue.toString().trim() : '';
          }
        }

        // Ensure fullName is a string
        fullName = fullName ? fullName.toString().trim() : '';

        const email = row['Email'] || row['EMAIL'] || row['email'] || 
                     row['Email ID'] || row['Email Id'] || generateEmail(fullName, ADMIN_EMAIL);
        const phone = row['Phone'] || row['PHONE'] || row['phone'] || 
                     row['Mobile'] || row['mobile'] || row['Mobile No'] || row['Contact'] || row['contact'] || 
                     row['Phone Number'] || row['Mobile Number'] || '';
        const department = row['Department'] || row['DEPT'] || row['department'] || 
                          row['Dept'] || '';
        const qualifications = row['Qualifications'] || row['Qualification'] || row['Qual'] || 
                             row['qualifications'] || row['qualification'] || row['qual'] || '';
        
        // Extract subject from the row - Column C (index 2) contains the subject
        let teacherSubject = row['Subject'] || row['subject'] || row['SUBJECT'] || 
                           row['Staff Subject'] || row['Teaching Subject'] || '';
        
        // If not found, try column C (index 2) from row array
        if (!teacherSubject || teacherSubject.toString().trim() === '') {
          const rowArray = Object.values(row);
          // Column C is typically index 2 (after S NO and Staff Name)
          if (rowArray.length > 2 && rowArray[2]) {
            const subjectCandidate = rowArray[2].toString().trim();
            if (subjectCandidate && subjectCandidate.length > 0) {
              teacherSubject = subjectCandidate;
            }
          }
          // Also try __EMPTY columns which might contain the subject
          if ((!teacherSubject || teacherSubject.toString().trim() === '') && row['__EMPTY']) {
            teacherSubject = row['__EMPTY'].toString().trim();
          }
        }
        
        // If subject is in a different column, try to find it in all values
        if (!teacherSubject || teacherSubject.toString().trim() === '') {
          // Check all column values for subject-like strings
          for (const [key, value] of Object.entries(row)) {
            if (value && typeof value === 'string') {
              const val = value.toString().trim().toUpperCase();
              // Check if it matches any known subject (exact or partial match)
              if (subjectMap.has(val)) {
                teacherSubject = value.toString().trim();
                break;
              }
              // Try partial matches
              for (const subjName of subjectNames) {
                if (val.includes(subjName.toUpperCase()) || subjName.toUpperCase().includes(val)) {
                  teacherSubject = subjName;
                  break;
                }
              }
              if (teacherSubject) break;
            }
          }
        }
        
        // Normalize subject name to match our subject map
        if (teacherSubject && teacherSubject.toString().trim() !== '') {
          const subjectUpper = teacherSubject.toString().trim().toUpperCase();
          // Map variations to standard names
          if (subjectUpper.includes('ENGLISH')) {
            teacherSubject = 'ENGLISH';
          } else if (subjectUpper.includes('TELUGU') && (subjectUpper.includes('SL') || subjectUpper.includes('SECOND'))) {
            teacherSubject = 'SL TELUGU';
          } else if (subjectUpper.includes('TELUGU') && (subjectUpper.includes('TL') || subjectUpper.includes('THIRD'))) {
            teacherSubject = 'TL TELUGU';
          } else if (subjectUpper.includes('HINDI') && (subjectUpper.includes('SL') || subjectUpper.includes('SECOND'))) {
            teacherSubject = 'SL HINDI';
          } else if (subjectUpper.includes('HINDI') && (subjectUpper.includes('TL') || subjectUpper.includes('THIRD'))) {
            teacherSubject = 'TL HINDI';
          } else if (subjectUpper.includes('MATH')) {
            teacherSubject = 'MATHS';
          } else if (subjectUpper.includes('PHY') || subjectUpper.includes('CHE') || subjectUpper.includes('PHYSICS') || subjectUpper.includes('CHEMISTRY')) {
            teacherSubject = 'PHY/CHE';
          } else if (subjectUpper.includes('BIO') || subjectUpper.includes('BIOLOGY')) {
            teacherSubject = 'BIO';
          } else if (subjectUpper.includes('SOCIAL')) {
            teacherSubject = 'SOCIAL';
          }
        }

        // Skip if name is still empty or looks like a header
        if (!fullName || fullName.length < 2 || 
            fullName.match(/^(S\.?NO|SNO|NO|Add|Remove|Columns|__EMPTY|Add\/Remove)/i)) {
          console.log(`⚠️  Skipping row ${i + 1}: Invalid or missing name (${fullName})`);
          skippedTeachers.push({ row: i + 1, reason: 'Invalid or missing name' });
          continue;
        }

        // Find subject ID for this teacher
        let teacherSubjectId = null;
        if (teacherSubject && teacherSubject.toString().trim() !== '') {
          const subjectKey = teacherSubject.toString().trim().toUpperCase();
          // Try exact match first
          if (subjectMap.has(subjectKey)) {
            teacherSubjectId = subjectMap.get(subjectKey);
            console.log(`   📚 Found subject for ${fullName}: ${teacherSubject} (exact match)`);
          } else {
            // Try partial match
            for (const [subjName, subjId] of subjectMap.entries()) {
              if (subjectKey.includes(subjName) || subjName.includes(subjectKey)) {
                teacherSubjectId = subjId;
                console.log(`   📚 Found subject for ${fullName}: ${teacherSubject} -> ${subjName} (partial match)`);
                break;
              }
            }
            if (!teacherSubjectId) {
              console.log(`   ⚠️  Could not match subject "${teacherSubject}" for ${fullName}`);
            }
          }
        } else {
          console.log(`   ⚠️  No subject found for ${fullName}`);
        }

        // Check if teacher already exists
        const existingTeacher = await Teacher.findOne({ email: email.toLowerCase() });
        if (existingTeacher) {
          console.log(`⚠️  Teacher already exists: ${fullName} (${email})`);
          skippedTeachers.push({ name: fullName, email, reason: 'Already exists' });
          
          // Update existing teacher to link to class if not already linked
          if (!existingTeacher.assignedClassIds || !existingTeacher.assignedClassIds.includes(classId.toString())) {
            if (!existingTeacher.assignedClassIds) {
              existingTeacher.assignedClassIds = [];
            }
            existingTeacher.assignedClassIds.push(classId.toString());
          }
          
          // Add subject to teacher if not already assigned
          if (teacherSubjectId && !existingTeacher.subjects.includes(teacherSubjectId)) {
            existingTeacher.subjects.push(teacherSubjectId);
          }
          
          await existingTeacher.save();
          console.log(`   ✅ Updated existing teacher to link to class ${CLASS_NUMBER}${CLASS_SECTION}`);
          if (teacherSubjectId) {
            console.log(`   ✅ Assigned subject to teacher`);
          }
          continue;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

        // Create teacher with subject assignment
        const teacherSubjects = teacherSubjectId ? [teacherSubjectId] : [];
        const newTeacher = new Teacher({
          email: email.toLowerCase(),
          password: hashedPassword,
          fullName: fullName.trim(),
          phone: phone ? phone.toString().trim() : '',
          department: department ? department.toString().trim() : '',
          qualifications: qualifications ? qualifications.toString().trim() : '',
          school: adminSchoolName,
          board: adminBoard,
          subjects: teacherSubjects,
          assignedClassIds: [classId.toString()],
          role: 'teacher',
          adminId: adminId,
          isActive: true
        });

        await newTeacher.save();
        createdTeachers.push({ name: fullName, email, id: newTeacher._id, subject: teacherSubject || 'N/A' });
        console.log(`✅ Created teacher: ${fullName} (${email})${teacherSubject ? ` - Subject: ${teacherSubject}` : ''}`);
      } catch (error) {
        console.error(`❌ Error creating teacher at row ${i + 1}:`, error.message);
        skippedTeachers.push({ row: i + 1, reason: error.message });
      }
    }

    console.log(`\n📊 Teacher Import Summary:`);
    console.log(`   ✅ Created: ${createdTeachers.length}`);
    console.log(`   ⚠️  Skipped: ${skippedTeachers.length}`);

    // Assign all subjects to class 6C
    console.log(`\n🔗 Assigning subjects to class ${CLASS_NUMBER}${CLASS_SECTION}...`);
    const allSubjectIds = Array.from(subjectMap.values());
    
    if (allSubjectIds.length > 0) {
      classDoc.assignedSubjects = allSubjectIds;
      await classDoc.save();
      console.log(`✅ Assigned ${allSubjectIds.length} subjects to class ${CLASS_NUMBER}${CLASS_SECTION}`);
    }

    // Assign all teachers to class 6C
    console.log(`\n👨‍🏫 Assigning teachers to class ${CLASS_NUMBER}${CLASS_SECTION}...`);
    const classIdStr = classId.toString();
    const classIdObj = classId; // Keep as ObjectId too
    
    console.log(`   Class ID (string): ${classIdStr}`);
    console.log(`   Class ID (ObjectId): ${classIdObj}`);
    
    // Get all teachers for this admin
    const allTeachers = await Teacher.find({ adminId: adminId, isActive: true });
    console.log(`   Found ${allTeachers.length} teachers for this admin`);
    
    let assignedCount = 0;
    let alreadyAssignedCount = 0;
    
    for (const teacher of allTeachers) {
      // Ensure assignedClassIds is an array
      if (!teacher.assignedClassIds) {
        teacher.assignedClassIds = [];
      }
      
      // Check if class ID is already present (try both string and ObjectId formats)
      const hasClassId = teacher.assignedClassIds.some(id => {
        const idStr = String(id);
        return idStr === classIdStr || idStr === String(classIdObj);
      });
      
      if (!hasClassId) {
        // Add class ID as string (as per Teacher model schema)
        teacher.assignedClassIds.push(classIdStr);
        await teacher.save();
        assignedCount++;
        console.log(`✅ Assigned teacher ${teacher.fullName} to class ${CLASS_NUMBER}${CLASS_SECTION}`);
      } else {
        alreadyAssignedCount++;
        console.log(`   ✓ Teacher ${teacher.fullName} already assigned to class ${CLASS_NUMBER}${CLASS_SECTION}`);
      }
    }
    
    console.log(`✅ Assigned ${assignedCount} new teachers to class ${CLASS_NUMBER}${CLASS_SECTION}`);
    console.log(`   ${alreadyAssignedCount} teachers were already assigned`);

    // Final summary
    console.log(`\n🎉 Import Complete!`);
    console.log(`\n📋 Summary:`);
    console.log(`   🏫 Class: ${CLASS_NUMBER}${CLASS_SECTION} (${classDoc.name})`);
    console.log(`   👥 Students: ${createdStudents.length} created, ${skippedStudents.length} skipped`);
    console.log(`   👨‍🏫 Teachers: ${createdTeachers.length} created, ${skippedTeachers.length} skipped`);
    console.log(`\n✅ All students and teachers are linked to class ${CLASS_NUMBER}${CLASS_SECTION}`);

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the import
importData().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
