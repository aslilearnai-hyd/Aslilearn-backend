/**
 * Manual Update Textbook URLs
 * 
 * This script allows you to manually update textbook URLs.
 * Update the CORRECT_URLS object with the correct URLs from epathshala.nic.in
 * 
 * Usage: node backend/scripts/manual-update-textbook-urls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';

// MANUALLY UPDATE THESE URLs WITH CORRECT ONES FROM epathshala.nic.in
// To find correct URLs:
// 1. Visit https://epathshala.nic.in/process.php?id=students&type=eTextbooks&ln=en
// 2. Click on each textbook
// 3. Copy the flipbook URL from the browser address bar
// 4. Update the URLs below
const CORRECT_URLS = {
  'Curiosity Science class 6': '', // TODO: Add correct URL
  'Curiosity Science class 7': '', // TODO: Add correct URL
  'Curiosity Science class 8': '', // TODO: Add correct URL
  'Science class 9': '', // TODO: Add correct URL
  'Science class 10': '', // TODO: Add correct URL
  'Ganita prakash class 6': '', // TODO: Add correct URL
  'Ganita prakash class 7': '', // TODO: Add correct URL
  'Ganita prakash class 8': '', // TODO: Add correct URL
  'Ganita prakash Vol 1 class 7': '', // TODO: Add correct URL
  'Ganita prakash Vol 2 class 7': '', // TODO: Add correct URL
  'Ganita prakash Vol 1 class 8': '', // TODO: Add correct URL
  'Ganita prakash Vol 2 class 8': '', // TODO: Add correct URL
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
    
    console.log('\n📚 Updating textbook URLs...\n');
    
    const textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS'
    });
    
    console.log(`Found ${textbooks.length} textbooks\n`);
    
    const updated = [];
    const skipped = [];
    
    for (const textbook of textbooks) {
      const correctUrl = CORRECT_URLS[textbook.title];
      
      if (correctUrl && correctUrl.trim() !== '') {
        if (textbook.fileUrl !== correctUrl) {
          textbook.fileUrl = correctUrl;
          textbook.fileUrls = [correctUrl];
          await textbook.save();
          updated.push({ title: textbook.title, newUrl: correctUrl });
          console.log(`✅ Updated: ${textbook.title}`);
        } else {
          console.log(`✓ Already correct: ${textbook.title}`);
        }
      } else {
        skipped.push({ title: textbook.title, reason: 'No URL provided in CORRECT_URLS' });
        console.log(`⚠️  Skipped: ${textbook.title} (no URL in CORRECT_URLS)`);
      }
    }
    
    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updated.length}`);
    console.log(`   ⚠️  Skipped: ${skipped.length}`);
    
    if (updated.length > 0) {
      console.log(`\n✅ Updated Textbooks:`);
      updated.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
    }
    
    if (skipped.length > 0) {
      console.log(`\n⚠️  Skipped Textbooks (need URLs):`);
      skipped.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
      console.log(`\n💡 To fix:`);
      console.log(`   1. Visit https://epathshala.nic.in/process.php?id=students&type=eTextbooks&ln=en`);
      console.log(`   2. Find each textbook and copy its flipbook URL`);
      console.log(`   3. Update the CORRECT_URLS object in this script`);
      console.log(`   4. Run this script again`);
    }
    
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateUrls();
