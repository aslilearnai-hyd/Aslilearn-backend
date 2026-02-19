/**
 * Update NCERT Textbook URLs with correct epathshala.nic.in links
 * 
 * This script updates existing textbook URLs to working ones
 * 
 * Usage: node backend/scripts/update-textbook-urls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';
import Subject from '../models/Subject.js';

// Updated URLs - these are the correct patterns based on epathshala.nic.in
// The key difference is the class format and book name format
const URL_UPDATES = [
  {
    titlePattern: /Curiosity Science class 6/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/#page=1'
  },
  {
    titlePattern: /Curiosity Science class 7/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Curosity_Science/feculps/#page=1'
  },
  {
    titlePattern: /Curiosity Science class 8/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Curosity_Science/feculps/#page=1'
  },
  {
    titlePattern: /^Science class 9$/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20IX/0677-Science/feculps/#page=1'
  },
  {
    titlePattern: /^Science class 10$/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20X/0677-Science/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash class 6$/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Ganita_Prakash/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash class 7$/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash class 8$/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash Vol 1 class 7/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol1/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash Vol 2 class 7/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol2/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash Vol 1 class 8/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol1/feculps/#page=1'
  },
  {
    titlePattern: /Ganita prakash Vol 2 class 8/i,
    newUrl: 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol2/feculps/#page=1'
  }
];

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
    
    console.log('\n🔍 Finding all NCERT textbooks...\n');
    
    // Find all textbooks
    const textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS'
    });
    
    console.log(`Found ${textbooks.length} textbooks\n`);
    
    const updated = [];
    const notMatched = [];
    
    for (const textbook of textbooks) {
      console.log(`\n📖 Processing: ${textbook.title}`);
      
      // Find matching URL update
      const urlUpdate = URL_UPDATES.find(update => update.titlePattern.test(textbook.title));
      
      if (urlUpdate) {
        if (textbook.fileUrl !== urlUpdate.newUrl) {
          textbook.fileUrl = urlUpdate.newUrl;
          textbook.fileUrls = [urlUpdate.newUrl];
          await textbook.save();
          updated.push({ title: textbook.title, newUrl: urlUpdate.newUrl });
          console.log(`   ✅ Updated URL`);
          console.log(`   New URL: ${urlUpdate.newUrl}`);
        } else {
          console.log(`   ✓ URL already correct`);
        }
      } else {
        notMatched.push({ title: textbook.title, currentUrl: textbook.fileUrl });
        console.log(`   ⚠️  No URL pattern match found`);
      }
    }
    
    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updated.length}`);
    console.log(`   ⚠️  Not Matched: ${notMatched.length}`);
    
    if (updated.length > 0) {
      console.log(`\n✅ Updated Textbooks:`);
      updated.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
    }
    
    if (notMatched.length > 0) {
      console.log(`\n⚠️  Textbooks Not Matched:`);
      notMatched.forEach(tb => {
        console.log(`   - ${tb.title}`);
      });
    }
    
    console.log(`\n💡 Note: If URLs still don't work, you may need to:`);
    console.log(`   1. Visit epathshala.nic.in and find the correct flipbook URLs`);
    console.log(`   2. Update the URLs manually in the database`);
    console.log(`   3. Or use the "Open in New Tab" button as a workaround`);
    
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateUrls();
