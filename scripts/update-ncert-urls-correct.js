/**
 * Update NCERT Textbook URLs with Correct PDF Links
 * 
 * This script updates all NCERT textbook URLs with the correct PDF links from ncert.nic.in
 * 
 * Usage: node backend/scripts/update-ncert-urls-correct.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';

// Correct URLs from ncert.nic.in
const CORRECT_URLS = {
  // Class 6
  'Curiosity Science class 6': 'https://ncert.nic.in/textbook/pdf/fecu1ps.pdf',
  'Ganita prakash class 6': 'https://ncert.nic.in/textbook/pdf/fegp1ps.pdf',
  
  // Class 7
  'Curiosity Science class 7': 'https://ncert.nic.in/textbook/pdf/gecu1ps.pdf',
  'Ganita prakash class 7': 'https://ncert.nic.in/textbook/pdf/gegp1ps.pdf',
  'Ganita prakash Vol 1 class 7': 'https://ncert.nic.in/textbook/pdf/gegp1ps.pdf', // Part I
  'Ganita prakash Vol 2 class 7': 'https://ncert.nic.in/textbook/pdf/gegp2ps.pdf', // Part II - need to verify
  
  // Class 8
  'Curiosity Science class 8': 'https://ncert.nic.in/textbook/pdf/hecu1ps.pdf',
  'Ganita prakash class 8': 'https://ncert.nic.in/textbook/pdf/hegp1ps.pdf',
  'Ganita prakash Vol 1 class 8': 'https://ncert.nic.in/textbook/pdf/hegp1ps.pdf', // Part I
  'Ganita prakash Vol 2 class 8': 'https://ncert.nic.in/textbook/pdf/hegp2ps.pdf', // Part II - need to verify
  
  // Class 9 & 10 - These need to be found from the textbook page
  'Science class 9': 'https://ncert.nic.in/textbook.php?ln=en', // Placeholder - need actual PDF URL
  'Science class 10': 'https://ncert.nic.in/textbook.php?ln=en', // Placeholder - need actual PDF URL
};

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

async function updateUrls() {
  try {
    await connectDB();
    
    console.log('\n📚 Updating NCERT textbook URLs with correct PDF links...\n');
    
    const textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS'
    });
    
    console.log(`Found ${textbooks.length} textbooks\n`);
    
    const updated = [];
    const skipped = [];
    const notFound = [];
    
    for (const textbook of textbooks) {
      console.log(`\n📖 Processing: ${textbook.title}`);
      
      // Try exact match first
      let correctUrl = CORRECT_URLS[textbook.title];
      
      // If not found, try pattern matching
      if (!correctUrl) {
        if (textbook.title.includes('Curiosity') && textbook.title.includes('class 6')) {
          correctUrl = CORRECT_URLS['Curiosity Science class 6'];
        } else if (textbook.title.includes('Curiosity') && textbook.title.includes('class 7')) {
          correctUrl = CORRECT_URLS['Curiosity Science class 7'];
        } else if (textbook.title.includes('Curiosity') && textbook.title.includes('class 8')) {
          correctUrl = CORRECT_URLS['Curiosity Science class 8'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('class 6') && !textbook.title.includes('Vol')) {
          correctUrl = CORRECT_URLS['Ganita prakash class 6'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('class 7') && !textbook.title.includes('Vol')) {
          correctUrl = CORRECT_URLS['Ganita prakash class 7'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('class 8') && !textbook.title.includes('Vol')) {
          correctUrl = CORRECT_URLS['Ganita prakash class 8'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('Vol 1') && textbook.title.includes('class 7')) {
          correctUrl = CORRECT_URLS['Ganita prakash Vol 1 class 7'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('Vol 2') && textbook.title.includes('class 7')) {
          correctUrl = CORRECT_URLS['Ganita prakash Vol 2 class 7'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('Vol 1') && textbook.title.includes('class 8')) {
          correctUrl = CORRECT_URLS['Ganita prakash Vol 1 class 8'];
        } else if (textbook.title.includes('Ganita') && textbook.title.includes('Vol 2') && textbook.title.includes('class 8')) {
          correctUrl = CORRECT_URLS['Ganita prakash Vol 2 class 8'];
        } else if (textbook.title.includes('Science') && textbook.title.includes('class 9')) {
          correctUrl = CORRECT_URLS['Science class 9'];
        } else if (textbook.title.includes('Science') && textbook.title.includes('class 10')) {
          correctUrl = CORRECT_URLS['Science class 10'];
        }
      }
      
      if (correctUrl && correctUrl.trim() !== '' && !correctUrl.includes('textbook.php')) {
        if (textbook.fileUrl !== correctUrl) {
          textbook.fileUrl = correctUrl;
          textbook.fileUrls = [correctUrl];
          await textbook.save();
          updated.push({ title: textbook.title, newUrl: correctUrl });
          console.log(`   ✅ Updated URL`);
          console.log(`   New URL: ${correctUrl}`);
        } else {
          console.log(`   ✓ URL already correct`);
        }
      } else if (correctUrl && correctUrl.includes('textbook.php')) {
        skipped.push({ title: textbook.title, reason: 'Needs actual PDF URL from ncert.nic.in' });
        console.log(`   ⚠️  Skipped - needs actual PDF URL (placeholder found)`);
      } else {
        notFound.push({ title: textbook.title, currentUrl: textbook.fileUrl });
        console.log(`   ❌ No matching URL found`);
      }
    }
    
    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updated.length}`);
    console.log(`   ⚠️  Skipped (need PDF URLs): ${skipped.length}`);
    console.log(`   ❌ Not Found: ${notFound.length}`);
    
    if (updated.length > 0) {
      console.log(`\n✅ Updated Textbooks:`);
      updated.forEach(tb => {
        console.log(`   - ${tb.title}`);
        console.log(`     URL: ${tb.newUrl}`);
      });
    }
    
    if (skipped.length > 0) {
      console.log(`\n⚠️  Textbooks Needing PDF URLs:`);
      skipped.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
      console.log(`\n💡 To fix:`);
      console.log(`   1. Visit https://ncert.nic.in/textbook.php?ln=en`);
      console.log(`   2. Navigate to Class 9 and Class 10 Science textbooks`);
      console.log(`   3. Find the PDF download links`);
      console.log(`   4. Update CORRECT_URLS in this script`);
      console.log(`   5. Run this script again`);
    }
    
    if (notFound.length > 0) {
      console.log(`\n❌ Textbooks Not Matched:`);
      notFound.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
    }
    
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateUrls();
