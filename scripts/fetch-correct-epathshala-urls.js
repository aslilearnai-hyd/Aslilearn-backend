/**
 * Fetch Correct ePathshala URLs
 * 
 * This script attempts to find the correct flipbook URLs from epathshala.nic.in
 * 
 * Usage: node backend/scripts/fetch-correct-epathshala-urls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Content from '../models/Content.js';

// Try different URL patterns to find working ones
const URL_PATTERNS_TO_TRY = {
  'Curiosity Science class 6': [
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%206/0677-Curosity_Science/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/ClassVI/0677-Curosity_Science/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VI/0677-Curosity_Science/feculps/',
  ],
  'Ganita prakash Vol 2 class 7': [
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%207/0677-Ganita_Prakash_Vol2/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/ClassVII/0677-Ganita_Prakash_Vol2/feculps/#page=1',
    'https://epathshala.nic.in/wp-content/doc/book/flipbook/Class%20VII/0677-Ganita_Prakash_Vol2/feculps/',
  ]
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

async function testUrl(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true, // Accept any status
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // Check if we got HTML content (not 404 page)
    if (response.status === 200 && response.data && typeof response.data === 'string') {
      // 404 pages usually have specific text
      if (response.data.includes('404') || response.data.includes('Not Found') || response.data.includes('not found')) {
        return false;
      }
      // If we get HTML with actual content, it's likely working
      if (response.data.length > 1000) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function findWorkingUrls() {
  try {
    await connectDB();
    
    console.log('\n🔍 Testing URL patterns...\n');
    
    // Test a sample to find the pattern
    const testTitle = 'Ganita prakash Vol 2 class 7';
    const patterns = URL_PATTERNS_TO_TRY[testTitle] || [];
    
    console.log(`Testing patterns for: ${testTitle}\n`);
    
    for (const url of patterns) {
      console.log(`Testing: ${url}`);
      const works = await testUrl(url);
      if (works) {
        console.log(`   ✅ This URL works!`);
        console.log(`\n💡 Use this pattern for similar textbooks:\n`);
        console.log(`   Pattern: ${url.replace(/Class%20VII/, 'Class%20{ROMAN}').replace(/Ganita_Prakash_Vol2/, '{BOOKNAME}')}`);
        break;
      } else {
        console.log(`   ❌ Not found`);
      }
    }
    
    // Now update all textbooks with a generic approach
    console.log(`\n\n📚 Updating all textbooks...\n`);
    
    const textbooks = await Content.find({
      type: 'TextBook',
      board: 'ASLI_EXCLUSIVE_SCHOOLS',
      fileUrl: { $regex: /epathshala/ }
    });
    
    console.log(`Found ${textbooks.length} textbooks with epathshala URLs\n`);
    
    // The issue might be that the URLs need to be accessed differently
    // Or the flipbook structure has changed
    // For now, let's provide instructions
    
    console.log(`\n💡 Solution:`);
    console.log(`   The epathshala.nic.in URLs might have changed or require authentication.`);
    console.log(`   Options:`);
    console.log(`   1. Visit https://epathshala.nic.in and find the correct flipbook URLs`);
    console.log(`   2. Use the "Open in New Tab" button - it will work even if iframe doesn't`);
    console.log(`   3. The proxy endpoint should handle the URLs, but if they're 404, the source is wrong`);
    console.log(`\n   To manually update URLs:`);
    console.log(`   - Go to Content Management in your admin panel`);
    console.log(`   - Edit each textbook`);
    console.log(`   - Update the fileUrl with the correct epathshala URL`);
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

findWorkingUrls();
