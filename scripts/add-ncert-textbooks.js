/**
 * Add NCERT Textbooks from epathshala.nic.in
 * 
 * This script adds NCERT textbooks to the platform:
 * - Grade 6 to 8: Curiosity (Science)
 * - Grade 9 & 10: Science
 * - Grade 6 to 8: Ganita prakash (Maths)
 * - Grade 7 & 8: Ganita prakash vol 1 and vol 2 (Maths)
 * 
 * Usage: node backend/scripts/add-ncert-textbooks.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import models
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';

const BOARD = 'ASLI_EXCLUSIVE_SCHOOLS';

// NCERT Textbook URLs structure from epathshala.nic.in
// Based on the pattern: https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/#page=1
const TEXTBOOKS = [
  // Science - Curiosity (Grade 6-8)
  {
    title: 'Curiosity Science class 6',
    classNumber: '6',
    subjectName: 'Science',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/#page=1',
    description: 'NCERT Curiosity Science Textbook for Class 6'
  },
  {
    title: 'Curiosity Science class 7',
    classNumber: '7',
    subjectName: 'Science',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Curosity_Science/feculps/#page=1',
    description: 'NCERT Curiosity Science Textbook for Class 7'
  },
  {
    title: 'Curiosity Science class 8',
    classNumber: '8',
    subjectName: 'Science',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Curosity_Science/feculps/#page=1',
    description: 'NCERT Curiosity Science Textbook for Class 8'
  },
  // Science (Grade 9-10)
  {
    title: 'Science class 9',
    classNumber: '9',
    subjectName: 'Science',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20IX/0677-Science/feculps/#page=1',
    description: 'NCERT Science Textbook for Class 9'
  },
  {
    title: 'Science class 10',
    classNumber: '10',
    subjectName: 'Science',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20X/0677-Science/feculps/#page=1',
    description: 'NCERT Science Textbook for Class 10'
  },
  // Maths - Ganita prakash (Grade 6-8)
  {
    title: 'Ganita prakash class 6',
    classNumber: '6',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Ganita_Prakash/feculps/#page=1',
    description: 'NCERT Ganita Prakash Mathematics Textbook for Class 6'
  },
  {
    title: 'Ganita prakash class 7',
    classNumber: '7',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash/feculps/#page=1',
    description: 'NCERT Ganita Prakash Mathematics Textbook for Class 7'
  },
  {
    title: 'Ganita prakash class 8',
    classNumber: '8',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash/feculps/#page=1',
    description: 'NCERT Ganita Prakash Mathematics Textbook for Class 8'
  },
  // Maths - Ganita prakash Vol 1 & 2 (Grade 7-8)
  {
    title: 'Ganita prakash Vol 1 class 7',
    classNumber: '7',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol1/feculps/#page=1',
    description: 'NCERT Ganita Prakash Vol 1 Mathematics Textbook for Class 7'
  },
  {
    title: 'Ganita prakash Vol 2 class 7',
    classNumber: '7',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
    description: 'NCERT Ganita Prakash Vol 2 Mathematics Textbook for Class 7'
  },
  {
    title: 'Ganita prakash Vol 1 class 8',
    classNumber: '8',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol1/feculps/#page=1',
    description: 'NCERT Ganita Prakash Vol 1 Mathematics Textbook for Class 8'
  },
  {
    title: 'Ganita prakash Vol 2 class 8',
    classNumber: '8',
    subjectName: 'Maths',
    type: 'TextBook',
    url: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
    description: 'NCERT Ganita Prakash Vol 2 Mathematics Textbook for Class 8'
  }
];

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

// Get or create subject
async function getOrCreateSubject(subjectName, classNumber) {
  // Try different naming conventions
  const possibleNames = [
    `${subjectName}_${classNumber}`, // e.g., Science_6, Maths_6
    subjectName, // e.g., Science, Maths
    `${subjectName} ${classNumber}`, // e.g., Science 6
  ];

  let subject = null;

  // Try to find existing subject with different naming patterns
  for (const name of possibleNames) {
    subject = await Subject.findOne({ 
      name: name, 
      board: BOARD
    });
    
    if (subject) {
      console.log(`✅ Found existing subject: ${name}`);
      break;
    }
  }

  // Also try with classNumber filter
  if (!subject) {
    for (const name of possibleNames) {
      subject = await Subject.findOne({ 
        name: name, 
        board: BOARD,
        classNumber: classNumber 
      });
      
      if (subject) {
        console.log(`✅ Found existing subject: ${name} (Class ${classNumber})`);
        break;
      }
    }
  }

  if (!subject) {
    // Create new subject with standard naming convention (SubjectName_ClassNumber)
    const subjectNameWithClass = `${subjectName}_${classNumber}`;
    subject = new Subject({
      name: subjectNameWithClass,
      board: BOARD,
      classNumber: classNumber,
      description: `${subjectName} for Class ${classNumber}`,
      isActive: true,
      createdBy: 'super-admin'
    });
    await subject.save();
    console.log(`✅ Created subject: ${subjectNameWithClass}`);
  }

  return subject;
}

// Main function
async function addTextbooks() {
  try {
    await connectDB();

    console.log(`\n📚 Adding ${TEXTBOOKS.length} NCERT textbooks...\n`);

    const created = [];
    const skipped = [];
    const errors = [];

    for (const textbook of TEXTBOOKS) {
      try {
        console.log(`\n📖 Processing: ${textbook.title}`);

        // Get or create subject
        const subject = await getOrCreateSubject(textbook.subjectName, textbook.classNumber);

        // Check if content already exists
        const existingContent = await Content.findOne({
          title: textbook.title,
          board: BOARD,
          subject: subject._id,
          type: 'TextBook'
        });

        if (existingContent) {
          console.log(`⚠️  Textbook already exists: ${textbook.title}`);
          skipped.push({ title: textbook.title, reason: 'Already exists' });
          continue;
        }

        // Create content
        const content = new Content({
          title: textbook.title,
          description: textbook.description,
          type: textbook.type,
          board: BOARD,
          subject: subject._id,
          classNumber: textbook.classNumber,
          fileUrl: textbook.url,
          fileUrls: [textbook.url],
          date: new Date(),
          isExclusive: true,
          createdBy: 'super-admin',
          isActive: true
        });

        await content.save();
        created.push({ 
          title: textbook.title, 
          classNumber: textbook.classNumber,
          subject: textbook.subjectName,
          url: textbook.url 
        });
        console.log(`✅ Added: ${textbook.title}`);

      } catch (error) {
        console.error(`❌ Error adding ${textbook.title}:`, error.message);
        errors.push({ title: textbook.title, error: error.message });
      }
    }

    // Summary
    console.log(`\n\n🎉 Import Complete!`);
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Created: ${created.length}`);
    console.log(`   ⚠️  Skipped: ${skipped.length}`);
    console.log(`   ❌ Errors: ${errors.length}`);

    if (created.length > 0) {
      console.log(`\n✅ Created Textbooks:`);
      created.forEach(tb => {
        console.log(`   - ${tb.title} (Class ${tb.classNumber}, ${tb.subject})`);
      });
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️  Skipped Textbooks:`);
      skipped.forEach(tb => {
        console.log(`   - ${tb.title}: ${tb.reason}`);
      });
    }

    if (errors.length > 0) {
      console.log(`\n❌ Errors:`);
      errors.forEach(tb => {
        console.log(`   - ${tb.title}: ${tb.error}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the import
addTextbooks().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
