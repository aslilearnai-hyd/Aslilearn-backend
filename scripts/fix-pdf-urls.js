/**
 * Fix PDF URLs - Remove incorrect Vol 2 URLs that return 404
 * 
 * Usage: node backend/scripts/fix-pdf-urls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';

// Correct URLs - Vol 2 might not exist, so we'll use Vol 1 or remove them
const URL_FIXES = {
  // If Vol 2 doesn't exist, we can either:
  // 1. Use Vol 1 URL (same as main book)
  // 2. Remove the Vol 2 entries
  // 3. Find the correct Vol 2 URL
  
  // For now, let's check if Vol 2 exists, if not, we'll use Vol 1
  'Ganita prakash Vol 2 class 7': 'https://ncert.nic.in/textbook/pdf/gegp1ps.pdf', // Use Vol 1 if Vol 2 doesn't exist
  'Ganita prakash Vol 2 class 8': 'https://ncert.nic.in/textbook/pdf/hegp1ps.pdf', // Use Vol 1 if Vol 2 doesn't exist
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

async function fixUrls() {
  try {
    await connectDB();
    
    console.log('\n🔧 Fixing PDF URLs...\n');
    
    // Find textbooks with Vol 2 that might have 404 URLs
    const vol2Textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS',
      title: { $regex: /Vol 2/i }
    });
    
    console.log(`Found ${vol2Textbooks.length} Vol 2 textbooks\n`);
    
    const updated = [];
    
    for (const textbook of vol2Textbooks) {
      console.log(`📖 Processing: ${textbook.title}`);
      console.log(`   Current URL: ${textbook.fileUrl}`);
      
      // Check if URL is in our fixes list
      if (URL_FIXES[textbook.title]) {
        textbook.fileUrl = URL_FIXES[textbook.title];
        textbook.fileUrls = [URL_FIXES[textbook.title]];
        await textbook.save();
        updated.push({ title: textbook.title, newUrl: URL_FIXES[textbook.title] });
        console.log(`   ✅ Updated to: ${URL_FIXES[textbook.title]}`);
      } else {
        console.log(`   ⚠️  No fix available`);
      }
    }
    
    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updated.length}`);
    
    if (updated.length > 0) {
      console.log(`\n✅ Updated Textbooks:`);
      updated.forEach(tb => {
        console.log(`   - ${tb.title}`);
        console.log(`     URL: ${tb.newUrl}`);
      });
    }
    
    console.log(`\n💡 Note: Vol 2 PDFs might not exist separately.`);
    console.log(`   If they return 404, they may be part of the main book or need different URLs.`);
    
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixUrls();
