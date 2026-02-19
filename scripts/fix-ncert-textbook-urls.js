/**
 * Fix NCERT Textbook URLs
 * 
 * This script updates the textbook URLs with correct epathshala.nic.in links
 * 
 * Usage: node backend/scripts/fix-ncert-textbook-urls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';
import axios from 'axios';

// Correct URLs based on epathshala.nic.in structure
// These need to be verified - the pattern might be different
const CORRECT_URLS = {
  // Science - Curiosity (Grade 6-8)
  'Curiosity Science class 6': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/#page=1',
  'Curiosity Science class 7': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Curosity_Science/feculps/#page=1',
  'Curiosity Science class 8': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Curosity_Science/feculps/#page=1',
  
  // Science (Grade 9-10)
  'Science class 9': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20IX/0677-Science/feculps/#page=1',
  'Science class 10': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20X/0677-Science/feculps/#page=1',
  
  // Maths - Ganita prakash (Grade 6-8)
  'Ganita prakash class 6': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Ganita_Prakash/feculps/#page=1',
  'Ganita prakash class 7': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash/feculps/#page=1',
  'Ganita prakash class 8': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash/feculps/#page=1',
  
  // Maths - Ganita prakash Vol 1 & 2 (Grade 7-8)
  'Ganita prakash Vol 1 class 7': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol1/feculps/#page=1',
  'Ganita prakash Vol 2 class 7': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
  'Ganita prakash Vol 1 class 8': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol1/feculps/#page=1',
  'Ganita prakash Vol 2 class 8': 'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VIII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
};

// Alternative URL patterns to try
const ALTERNATIVE_PATTERNS = {
  'Class VI': 'Class%206',
  'Class VII': 'Class%207', 
  'Class VIII': 'Class%208',
  'Class IX': 'Class%209',
  'Class X': 'Class%2010',
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

// Test URL accessibility
async function testUrl(url) {
  try {
    const response = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });
    return response.status < 400;
  } catch (error) {
    return false;
  }
}

// Generate alternative URLs
function generateAlternativeUrls(baseTitle, classNumber) {
  const alternatives = [];
  
  // Try different class number formats
  const classFormats = [
    `Class%20${classNumber === 'VI' ? '6' : classNumber === 'VII' ? '7' : classNumber === 'VIII' ? '8' : classNumber === 'IX' ? '9' : '10'}`,
    `Class%20${classNumber}`,
    `Class${classNumber}`,
  ];
  
  // Try different book name formats
  let bookName = '';
  if (baseTitle.includes('Curiosity')) {
    bookName = 'Curosity_Science'; // Note: might be misspelled in actual URL
  } else if (baseTitle.includes('Ganita')) {
    if (baseTitle.includes('Vol 1')) {
      bookName = 'Ganita_Prakash_Vol1';
    } else if (baseTitle.includes('Vol 2')) {
      bookName = 'Ganita_Prakash_Vol2';
    } else {
      bookName = 'Ganita_Prakash';
    }
  } else if (baseTitle.includes('Science')) {
    bookName = 'Science';
  }
  
  for (const classFormat of classFormats) {
    alternatives.push(`https://epathshala.nic.in/wp-content/doc/book/flipbook/${classFormat}/0677-${bookName}/feculps/#page=1`);
  }
  
  return alternatives;
}

async function fixUrls() {
  try {
    await connectDB();
    
    console.log('\n🔍 Finding all NCERT textbooks...\n');
    
    // Find all textbooks
    const textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS',
      $or: [
        { title: { $regex: /Curiosity|Ganita|Science class/ } }
      ]
    });
    
    console.log(`Found ${textbooks.length} textbooks to check\n`);
    
    const updated = [];
    const notFound = [];
    
    for (const textbook of textbooks) {
      console.log(`\n📖 Checking: ${textbook.title}`);
      console.log(`   Current URL: ${textbook.fileUrl}`);
      
      // Check if current URL works
      const currentWorks = await testUrl(textbook.fileUrl);
      
      if (currentWorks) {
        console.log(`   ✅ Current URL works`);
        continue;
      }
      
      console.log(`   ❌ Current URL not found, trying alternatives...`);
      
      // Try the correct URL from our map
      if (CORRECT_URLS[textbook.title]) {
        const testUrl = CORRECT_URLS[textbook.title];
        const works = await testUrl(testUrl);
        
        if (works) {
          textbook.fileUrl = testUrl;
          textbook.fileUrls = [testUrl];
          await textbook.save();
          updated.push({ title: textbook.title, newUrl: testUrl });
          console.log(`   ✅ Updated with working URL`);
          continue;
        }
      }
      
      // Try alternative patterns
      const alternatives = generateAlternativeUrls(textbook.title, textbook.classNumber);
      let foundWorking = false;
      
      for (const altUrl of alternatives) {
        const works = await testUrl(altUrl);
        if (works) {
          textbook.fileUrl = altUrl;
          textbook.fileUrls = [altUrl];
          await textbook.save();
          updated.push({ title: textbook.title, newUrl: altUrl });
          console.log(`   ✅ Found working URL: ${altUrl}`);
          foundWorking = true;
          break;
        }
      }
      
      if (!foundWorking) {
        notFound.push({ title: textbook.title, url: textbook.fileUrl });
        console.log(`   ❌ No working URL found`);
      }
    }
    
    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updated.length}`);
    console.log(`   ❌ Not Found: ${notFound.length}`);
    
    if (updated.length > 0) {
      console.log(`\n✅ Updated Textbooks:`);
      updated.forEach(tb => {
        console.log(`   - ${tb.title}`);
        console.log(`     URL: ${tb.newUrl}`);
      });
    }
    
    if (notFound.length > 0) {
      console.log(`\n❌ Textbooks Needing Manual URL Fix:`);
      notFound.forEach(tb => {
        console.log(`   - ${tb.title}`);
        console.log(`     Current: ${tb.url}`);
      });
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixUrls();
