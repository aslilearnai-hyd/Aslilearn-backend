import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import Subject from '../models/Subject.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import ExamResult from '../models/ExamResult.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  console.error('Please set MONGO_URI in your .env file or environment variables.');
  process.exit(1);
}

async function setupTestData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing test data (optional - comment out if you want to keep existing data)
    console.log('\n🧹 Cleaning up existing test data...');
    await User.deleteMany({ email: { $regex: /^test(admin|teacher|student)/ } });
    await Teacher.deleteMany({ email: { $regex: /^testteacher/ } });
    await Class.deleteMany({ classNumber: { $regex: /^Class-10/ } });
    await Exam.deleteMany({ title: { $regex: /^Test Exam/ } });
    await ExamResult.deleteMany({ examTitle: { $regex: /^Test Exam/ } });
    console.log('✅ Cleanup complete');

    // Step 1: Create Admin Users (Schools)
    console.log('\n📚 Step 1: Creating Admin Users (Schools)...');
    const adminPassword = await bcrypt.hash('Admin123', 10);
    const admins = [];

    const adminData = [
      { name: 'Greenwood High School', email: 'testadmin1@school.com' },
      { name: 'Sunshine Academy', email: 'testadmin2@school.com' },
      { name: 'Riverside School', email: 'testadmin3@school.com' }
    ];

    for (const admin of adminData) {
      const existingAdmin = await User.findOne({ email: admin.email });
      if (existingAdmin) {
        console.log(`   ⚠️  Admin ${admin.email} already exists, skipping...`);
        admins.push(existingAdmin);
      } else {
        const newAdmin = await User.create({
          email: admin.email,
          password: adminPassword,
          fullName: admin.name,
          role: 'admin',
          isActive: true,
          board: 'ASLI_EXCLUSIVE_SCHOOLS'
        });
        admins.push(newAdmin);
        console.log(`   ✅ Created admin: ${admin.name} (${admin.email})`);
      }
    }

    // Step 2: Get or Create Subjects
    console.log('\n📖 Step 2: Setting up Subjects...');
    const subjectNames = ['Mathematics', 'Science', 'English', 'Social Studies'];
    const subjects = [];

    for (const subjectName of subjectNames) {
      let subject = await Subject.findOne({ name: subjectName, board: 'ASLI_EXCLUSIVE_SCHOOLS' });
      if (!subject) {
        subject = await Subject.create({
          name: subjectName,
          board: 'ASLI_EXCLUSIVE_SCHOOLS',
          isActive: true
        });
        console.log(`   ✅ Created subject: ${subjectName}`);
      } else {
        console.log(`   ℹ️  Subject ${subjectName} already exists`);
      }
      subjects.push(subject);
    }

    // Step 3: Create Teachers
    console.log('\n👨‍🏫 Step 3: Creating Teachers...');
    const teacherPassword = await bcrypt.hash('Teacher123', 10);
    const teachers = [];

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i];
      const teacherCount = 3; // 3 teachers per admin

      for (let j = 1; j <= teacherCount; j++) {
        const teacherEmail = `testteacher${i + 1}_${j}@school.com`;
        const existingTeacher = await Teacher.findOne({ email: teacherEmail });
        
        if (existingTeacher) {
          console.log(`   ⚠️  Teacher ${teacherEmail} already exists, skipping...`);
          teachers.push(existingTeacher);
        } else {
          const teacher = await Teacher.create({
            email: teacherEmail,
            password: teacherPassword,
            fullName: `Teacher ${j} - ${admin.fullName}`,
            phone: `+123456789${j}`,
            department: subjectNames[j % subjectNames.length],
            adminId: admin._id,
            board: 'ASLI_EXCLUSIVE_SCHOOLS',
            subjects: [subjects[j % subjects.length]._id],
            role: 'teacher',
            isActive: true
          });
          teachers.push(teacher);
          console.log(`   ✅ Created teacher: ${teacher.fullName} (${teacherEmail})`);
        }
      }
    }

    // Step 4: Create Classes
    console.log('\n🏫 Step 4: Creating Classes...');
    const classes = [];

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i];
      const sections = ['A', 'B', 'C'];
      
      for (const section of sections) {
        const classNumber = `Class-10${section}`;
        const existingClass = await Class.findOne({ 
          classNumber, 
          section, 
          assignedAdmin: admin._id 
        });

        if (existingClass) {
          console.log(`   ⚠️  Class ${classNumber}-${section} already exists, skipping...`);
          classes.push(existingClass);
        } else {
          const newClass = await Class.create({
            classNumber: '10',
            section,
            name: `${classNumber} - ${section}`,
            description: `Class 10 Section ${section} for ${admin.fullName}`,
            assignedAdmin: admin._id,
            assignedSubjects: subjects.map(s => s._id),
            board: 'ASLI_EXCLUSIVE_SCHOOLS',
            isActive: true
          });
          classes.push(newClass);
          console.log(`   ✅ Created class: ${newClass.name} for ${admin.fullName}`);
        }
      }
    }

    // Step 5: Create Students
    console.log('\n👨‍🎓 Step 5: Creating Students...');
    const studentPassword = await bcrypt.hash('Student123', 10);
    const students = [];

    // Create 10 students total, distributed across admins
    const studentsPerAdmin = Math.ceil(10 / admins.length);

    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i];
      const adminClasses = classes.filter(c => c.assignedAdmin.toString() === admin._id.toString());
      
      for (let j = 1; j <= studentsPerAdmin && students.length < 10; j++) {
        const studentNum = students.length + 1;
        const studentEmail = `teststudent${studentNum}@school.com`;
        const existingStudent = await User.findOne({ email: studentEmail });

        if (existingStudent) {
          console.log(`   ⚠️  Student ${studentEmail} already exists, skipping...`);
          students.push(existingStudent);
        } else {
          // Assign to a random class from this admin's classes
          const assignedClass = adminClasses[Math.floor(Math.random() * adminClasses.length)];
          
          const student = await User.create({
            email: studentEmail,
            password: studentPassword,
            fullName: `Student ${studentNum} - ${admin.fullName}`,
            role: 'student',
            classNumber: assignedClass ? assignedClass.classNumber : '10',
            phone: `+123456789${studentNum}`,
            assignedAdmin: admin._id,
            assignedClass: assignedClass ? assignedClass._id : null,
            board: 'ASLI_EXCLUSIVE_SCHOOLS',
            isActive: true
          });

          students.push(student);
          const classInfo = assignedClass ? `${assignedClass.classNumber}-${assignedClass.section}` : '10';
          console.log(`   ✅ Created student: ${student.fullName} (${studentEmail}) - Class ${classInfo}`);
        }
      }
    }

    // Step 6: Create Exam as Super Admin
    console.log('\n📝 Step 6: Creating Exam...');
    
    // Get super admin user ID (or create a placeholder)
    let superAdmin = await User.findOne({ role: 'super-admin' });
    if (!superAdmin) {
      // Use the first admin as creator if no super admin exists
      superAdmin = admins[0];
    }

    const examTitle = 'Test Exam - Mathematics & Science';
    let exam = await Exam.findOne({ title: examTitle });

    if (exam) {
      console.log(`   ⚠️  Exam "${examTitle}" already exists, using existing exam...`);
    } else {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30); // Exam valid for 30 days

        exam = await Exam.create({
        title: examTitle,
        description: 'Comprehensive test exam covering Mathematics, Physics, and Chemistry topics',
        examType: 'weekend',
        duration: 60, // 60 minutes
        totalQuestions: 20,
        totalMarks: 100,
        instructions: 'Read all questions carefully. Answer to the best of your ability.',
        isActive: true,
        startDate,
        endDate,
        createdBy: superAdmin._id,
        board: 'ASLI_EXCLUSIVE_SCHOOLS',
        subjects: ['maths', 'physics', 'chemistry'] // Subject names as strings
      });

      console.log(`   ✅ Created exam: ${exam.title}`);

      // Create Questions for the Exam
      console.log('\n   📋 Creating Questions for Exam...');
      const questions = [
        {
          questionText: 'What is 2 + 2?',
          options: [
            { text: '3', isCorrect: false },
            { text: '4', isCorrect: true },
            { text: '5', isCorrect: false },
            { text: '6', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is H2O?',
          options: [
            { text: 'Oxygen', isCorrect: false },
            { text: 'Hydrogen', isCorrect: false },
            { text: 'Water', isCorrect: true },
            { text: 'Carbon Dioxide', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'chemistry'
        },
        {
          questionText: 'What is 10 × 5?',
          options: [
            { text: '40', isCorrect: false },
            { text: '50', isCorrect: true },
            { text: '60', isCorrect: false },
            { text: '70', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the largest planet in our solar system?',
          options: [
            { text: 'Earth', isCorrect: false },
            { text: 'Mars', isCorrect: false },
            { text: 'Jupiter', isCorrect: true },
            { text: 'Saturn', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'physics'
        },
        {
          questionText: 'What is the square root of 16?',
          options: [
            { text: '2', isCorrect: false },
            { text: '4', isCorrect: true },
            { text: '6', isCorrect: false },
            { text: '8', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the chemical symbol for Gold?',
          options: [
            { text: 'Go', isCorrect: false },
            { text: 'Gd', isCorrect: false },
            { text: 'Au', isCorrect: true },
            { text: 'Ag', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'chemistry'
        },
        {
          questionText: 'What is 15 - 7?',
          options: [
            { text: '6', isCorrect: false },
            { text: '7', isCorrect: false },
            { text: '8', isCorrect: true },
            { text: '9', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the speed of light?',
          options: [
            { text: '300,000 km/s', isCorrect: true },
            { text: '150,000 km/s', isCorrect: false },
            { text: '450,000 km/s', isCorrect: false },
            { text: '600,000 km/s', isCorrect: false }
          ],
          correctAnswer: 0,
          marks: 5,
          subject: 'physics'
        },
        {
          questionText: 'What is 3²?',
          options: [
            { text: '6', isCorrect: false },
            { text: '9', isCorrect: true },
            { text: '12', isCorrect: false },
            { text: '15', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the formula for water?',
          options: [
            { text: 'H2O', isCorrect: true },
            { text: 'CO2', isCorrect: false },
            { text: 'O2', isCorrect: false },
            { text: 'NaCl', isCorrect: false }
          ],
          correctAnswer: 0,
          marks: 5,
          subject: 'chemistry'
        },
        {
          questionText: 'What is 100 ÷ 4?',
          options: [
            { text: '20', isCorrect: false },
            { text: '25', isCorrect: true },
            { text: '30', isCorrect: false },
            { text: '35', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the smallest unit of matter?',
          options: [
            { text: 'Molecule', isCorrect: false },
            { text: 'Atom', isCorrect: true },
            { text: 'Cell', isCorrect: false },
            { text: 'Particle', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'physics'
        },
        {
          questionText: 'What is 7 × 8?',
          options: [
            { text: '54', isCorrect: false },
            { text: '56', isCorrect: true },
            { text: '58', isCorrect: false },
            { text: '60', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is 12 + 13?',
          options: [
            { text: '23', isCorrect: false },
            { text: '24', isCorrect: false },
            { text: '25', isCorrect: true },
            { text: '26', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is gravity?',
          options: [
            { text: 'Force that pulls objects down', isCorrect: true },
            { text: 'Force that pushes objects up', isCorrect: false },
            { text: 'Type of energy', isCorrect: false },
            { text: 'Type of matter', isCorrect: false }
          ],
          correctAnswer: 0,
          marks: 5,
          subject: 'physics'
        },
        {
          questionText: 'What is 20 - 9?',
          options: [
            { text: '10', isCorrect: false },
            { text: '11', isCorrect: true },
            { text: '12', isCorrect: false },
            { text: '13', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the largest organ in the human body?',
          options: [
            { text: 'Heart', isCorrect: false },
            { text: 'Liver', isCorrect: false },
            { text: 'Skin', isCorrect: true },
            { text: 'Lungs', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'physics'
        },
        {
          questionText: 'What is 6 × 7?',
          options: [
            { text: '40', isCorrect: false },
            { text: '42', isCorrect: true },
            { text: '44', isCorrect: false },
            { text: '46', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'maths'
        },
        {
          questionText: 'What is the atomic number of Carbon?',
          options: [
            { text: '4', isCorrect: false },
            { text: '5', isCorrect: false },
            { text: '6', isCorrect: true },
            { text: '7', isCorrect: false }
          ],
          correctAnswer: 2,
          marks: 5,
          subject: 'chemistry'
        },
        {
          questionText: 'What is Newton\'s first law of motion?',
          options: [
            { text: 'F = ma', isCorrect: false },
            { text: 'An object at rest stays at rest', isCorrect: true },
            { text: 'Energy cannot be created or destroyed', isCorrect: false },
            { text: 'Every action has an equal and opposite reaction', isCorrect: false }
          ],
          correctAnswer: 1,
          marks: 5,
          subject: 'physics'
        }
      ];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await Question.create({
          questionText: q.questionText,
          options: q.options,
          correctAnswer: q.correctAnswer,
          marks: q.marks,
          exam: exam._id,
          subject: q.subject,
          questionType: 'mcq',
          createdBy: superAdmin._id,
          board: 'ASLI_EXCLUSIVE_SCHOOLS',
          isActive: true
        });
      }

      console.log(`   ✅ Created ${questions.length} questions for the exam`);
    }

    // Step 7: Create Exam Results for Students
    console.log('\n📊 Step 7: Creating Exam Results for Students...');
    
    // Get all questions for this exam
    const examQuestions = await Question.find({ exam: exam._id });
    const totalQuestions = examQuestions.length;

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      // Check if result already exists
      const existingResult = await ExamResult.findOne({
        examId: exam._id,
        userId: student._id
      });

      if (existingResult) {
        console.log(`   ⚠️  Exam result for ${student.fullName} already exists, skipping...`);
        continue;
      }

      // Generate random performance (60-95% range for variety)
      const percentage = 60 + Math.random() * 35;
      const correctAnswers = Math.round((percentage / 100) * totalQuestions);
      const wrongAnswers = Math.round(totalQuestions * 0.15); // Some wrong answers
      const unattempted = totalQuestions - correctAnswers - wrongAnswers;
      
      // Calculate marks
      const marksPerQuestion = exam.totalMarks / totalQuestions;
      const obtainedMarks = Math.round(correctAnswers * marksPerQuestion);

      // Calculate subject-wise scores
      const subjectWiseScore = {};
      examQuestions.forEach(q => {
        const subjectName = q.subject; // subject is a string, not ObjectId
        if (!subjectWiseScore[subjectName]) {
          subjectWiseScore[subjectName] = { total: 0, correct: 0 };
        }
        subjectWiseScore[subjectName].total += 1;
        // Randomly assign correct/incorrect based on overall performance
        if (Math.random() < (percentage / 100)) {
          subjectWiseScore[subjectName].correct += 1;
        }
      });

      // Get student's admin
      const studentAdmin = await User.findById(student.assignedAdmin);

      const examResult = await ExamResult.create({
        examId: exam._id,
        userId: student._id,
        adminId: studentAdmin ? studentAdmin._id : null,
        board: 'ASLI_EXCLUSIVE_SCHOOLS',
        examTitle: exam.title,
        totalQuestions,
        correctAnswers,
        wrongAnswers,
        unattempted,
        totalMarks: exam.totalMarks,
        obtainedMarks,
        percentage: Math.round(percentage),
        timeTaken: 45 + Math.random() * 15, // 45-60 minutes
        completedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random date in last 7 days
        subjectWiseScore,
        answers: (() => {
          const answersMap = new Map();
          examQuestions.forEach((q, idx) => {
            const isCorrect = idx < correctAnswers;
            answersMap.set(q._id.toString(), {
              selectedOption: isCorrect ? q.correctAnswer : ((q.correctAnswer + 1) % 4),
              isCorrect: isCorrect
            });
          });
          return answersMap;
        })()
      });

      console.log(`   ✅ Created exam result for ${student.fullName}: ${Math.round(percentage)}% (${correctAnswers}/${totalQuestions} correct)`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST DATA SETUP COMPLETE!');
    console.log('='.repeat(60));
    console.log(`📚 Admins (Schools): ${admins.length}`);
    console.log(`👨‍🏫 Teachers: ${teachers.length}`);
    console.log(`👨‍🎓 Students: ${students.length}`);
    console.log(`🏫 Classes: ${classes.length}`);
    console.log(`📝 Exam: ${exam.title}`);
    console.log(`📊 Exam Results: ${students.length}`);
    console.log('\n📋 Login Credentials:');
    console.log('   Admin: testadmin1@school.com / Admin123');
    console.log('   Teacher: testteacher1_1@school.com / Teacher123');
    console.log('   Student: teststudent1@school.com / Student123');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    process.exit(1);
  }
}

setupTestData();

