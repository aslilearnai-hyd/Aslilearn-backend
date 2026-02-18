/**
 * Bulk Upload Grade 6 Videos Script
 * Uploads Chemistry, Mathematics, and Biology videos for Class 6
 * 
 * Usage: node backend/scripts/bulk-upload-grade6-videos.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  process.exit(1);
}

// Video data structure
const videosData = {
  chemistry: {
    subjectName: 'Chemistry_6',
    classNumber: '6',
    chapters: [
      {
        chapter: 'Chapter-1 STATES OF MATTER',
        topic: 'STATES OF MATTER',
        urls: [
          'https://youtu.be/_qY29_v_UF0',
          'https://youtu.be/5OIEyEMm47Q',
          'https://youtu.be/C4wPVpoXuQw',
          'https://youtu.be/tjzDwLtVeQk',
          'https://youtu.be/aWlRgfyz1Wo',
          'https://youtu.be/0fnNH41Gc5k',
          'https://youtu.be/2hkmOcgaGv8',
          'https://youtu.be/dKkHKf0Atas',
          'https://youtu.be/HNH6DxATjLE',
          'https://youtu.be/ivHtfu4kW5I'
        ]
      },
      {
        chapter: 'Chapter-2 Elements, compounds & mixtures',
        topic: 'Elements, compounds & mixtures',
        urls: [
          'https://youtu.be/u--cCQsLczU',
          'https://youtu.be/7_A3QRnghQI',
          'https://youtu.be/X41DeIZtOMs'
        ]
      },
      {
        chapter: 'Chapter-3 Language of Chemistry',
        topic: 'Language of Chemistry',
        urls: [
          'https://youtu.be/SQfh2Fss6iY',
          'https://youtu.be/S4MISnXFWw0'
        ]
      },
      {
        chapter: 'Chapter-5 Metals and Non - Metals',
        topic: 'Metals and Non - Metals',
        urls: [
          'https://youtu.be/2u4DviMc7Nw',
          'https://youtu.be/iC2swQyFrbQ'
        ]
      }
    ]
  },
  mathematics: {
    subjectName: 'Maths_6',
    classNumber: '6',
    chapters: [
      {
        chapter: 'Chapter-1 KNOWING OUR NUMBERS',
        topic: 'KNOWING OUR NUMBERS',
        urls: [
          'https://youtu.be/_M7w3IinX-Q',
          'https://youtu.be/-XrMZix9Og0',
          'https://youtu.be/T8lj-P6X02U',
          'https://youtu.be/KgjztGcmB3E',
          'https://youtu.be/5rIJdOuSMYQ',
          'https://youtu.be/oTgFKsDkbyo',
          'https://youtu.be/xB0HsJU4Y0Y',
          'https://youtu.be/X8yQwSU8GIU'
        ]
      },
      {
        chapter: 'Chapter-2 Whole Numbers',
        topic: 'Whole Numbers',
        urls: [
          'https://youtu.be/epxNEJ5RZ4A',
          'https://youtu.be/hsTdQ_RHbU8',
          'https://youtu.be/6yLdTFoYpfg',
          'https://youtu.be/HHa2wcyQ8vA',
          'https://youtu.be/f3ujOSAQtYQ',
          'https://youtu.be/LHUw3VguH8s',
          'https://youtu.be/1L5Iq-3DgvE',
          'https://youtu.be/Gq8zGKXwm00',
          'https://youtu.be/L2IN2YCTa1k'
        ]
      },
      {
        chapter: 'Chapter-3 Playing with numbers',
        topic: 'Playing with numbers',
        urls: [
          'https://youtu.be/W2dd0MIfJxM',
          'https://youtu.be/R059rovifA4',
          'https://youtu.be/SHgAK4xF7IY',
          'https://youtu.be/SY6Kdkr5IDA',
          'https://youtu.be/quITCieJ8tk',
          'https://youtu.be/TSWr_nlCX5M',
          'https://youtu.be/L5UVHAzRfBo',
          'https://youtu.be/HRHgPybOnVw',
          'https://youtu.be/LZ1voPDk-lY'
        ]
      },
      {
        chapter: 'Chapter-4 Basic Geometrical Ideas',
        topic: 'Basic Geometrical Ideas',
        urls: [
          'https://youtu.be/XnMsGiJ0KB4',
          'https://youtu.be/F6jMjxvjBZk',
          'https://youtu.be/BhWSPJXPAI0',
          'https://youtu.be/8UxpLVHLSpg',
          'https://youtu.be/tqeSCLNJ6L0',
          'https://youtu.be/g7JStkmpNYg',
          'https://youtu.be/aU8TqIDLXjs',
          'https://youtu.be/RR5cQlGlXLU',
          'https://youtu.be/C252pmR9woo',
          'https://youtu.be/-KTZB-EP6PM'
        ]
      },
      {
        chapter: 'Chapter-5 Understanding Elementary Shapes',
        topic: 'Understanding Elementary Shapes',
        urls: [
          'https://youtu.be/IFwyaSE-UzU',
          'https://youtu.be/nrlwLkHTfQw',
          'https://youtu.be/pCmNVJoFkCU',
          'https://youtu.be/FQRp3jHIgAQ',
          'https://youtu.be/yUkJx_l-leI',
          'https://youtu.be/uMfY_5MIDmI',
          'https://youtu.be/iKeSPQ5o7vg',
          'https://youtu.be/8WKkYB-tRG4',
          'https://youtu.be/mW9kIv-kWV4',
          'https://youtu.be/duJmkvE_yR0'
        ]
      },
      {
        chapter: 'Chapter-6 Integers Four Operations',
        topic: 'Integers Four Operations',
        urls: [
          'https://youtu.be/DUJgait-MmE',
          'https://youtu.be/U9WqEJHBP9M'
        ]
      }
    ]
  },
  biology: {
    subjectName: 'Biology_6',
    classNumber: '6',
    chapters: [
      {
        chapter: 'Chapter-1 FOOD AND ITS COMPONENTS',
        topic: 'FOOD AND ITS COMPONENTS',
        urls: [
          'https://youtu.be/mJ06xlLhncA',
          'https://youtu.be/1Qrr3nAbhDY',
          'https://youtu.be/9rHyDJYwT1s'
        ]
      },
      {
        chapter: 'Chapter-2 Getting to know plants plant parts and functions',
        topic: 'Getting to know plants plant parts and functions',
        urls: [
          'https://youtu.be/7AfhAhvj-IA',
          'https://youtu.be/S_ISnvz0ZYk'
        ]
      },
      {
        chapter: 'Chapter-3 Body Movements- Musculo Skeletal System',
        topic: 'Body Movements- Musculo Skeletal System',
        urls: [
          'https://youtu.be/Jc3CSU6NGaM',
          'https://youtu.be/VGcG-N9NdOg'
        ]
      }
    ]
  }
};

// Extract YouTube video ID for thumbnail
function getYouTubeThumbnail(url) {
  let videoId = '';
  if (url.includes('youtube.com/watch?v=')) {
    videoId = url.split('v=')[1].split('&')[0];
  } else if (url.includes('youtu.be/')) {
    videoId = url.split('youtu.be/')[1].split('?')[0];
  }
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';
}

async function uploadVideos() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const board = 'ASLI_EXCLUSIVE_SCHOOLS';
    let totalUploaded = 0;
    let totalFailed = 0;

    // Process each subject
    for (const [subjectKey, subjectData] of Object.entries(videosData)) {
      console.log(`\n📚 Processing ${subjectData.subjectName}...`);

      // Find subject by name and board (exact match with class number)
      let subject = await Subject.findOne({
        name: subjectData.subjectName, // Exact match for Chemistry_6, Maths_6, Biology_6
        board: board
      });

      // If not found, try alternative names with class number
      if (!subject) {
        const alternatives = {
          'Chemistry_6': ['Chemistry_6', 'Chemistry'],
          'Maths_6': ['Maths_6', 'Mathematics_6', 'Math_6', 'Maths', 'Mathematics'],
          'Biology_6': ['Biology_6', 'Biology']
        };
        
        const altNames = alternatives[subjectData.subjectName] || [subjectData.subjectName];
        for (const altName of altNames) {
          subject = await Subject.findOne({
            name: altName,
            board: board
          });
          if (subject) {
            console.log(`   ℹ️  Using subject "${subject.name}" instead of "${subjectData.subjectName}"`);
            break;
          }
        }
      }

      if (!subject) {
        console.log(`❌ Subject "${subjectData.subjectName}" not found for board ${board}`);
        const allSubjects = await Subject.find({ board }).select('name');
        console.log(`   Available subjects:`, allSubjects.map(s => s.name).join(', '));
        continue;
      }

      console.log(`✅ Found subject: ${subject.name} (ID: ${subject._id})`);

      // Process each chapter
      for (const chapterData of subjectData.chapters) {
        console.log(`\n  📖 Processing ${chapterData.chapter}...`);

        // Create a separate content entry for each video URL
        for (let i = 0; i < chapterData.urls.length; i++) {
          const videoUrl = chapterData.urls[i];
          const videoNumber = i + 1;
          
          const contentData = {
            title: `Grade-6 ${subjectData.subjectName} - ${chapterData.chapter} - Video ${videoNumber}`,
            description: `${chapterData.topic} - Grade 6 ${subjectData.subjectName} - Part ${videoNumber}`,
            type: 'Video',
            board: board,
            subject: subject._id,
            classNumber: subjectData.classNumber,
            topic: chapterData.topic,
            date: new Date(),
            fileUrl: videoUrl,
            fileUrls: [videoUrl], // Single video URL in array
            thumbnailUrl: getYouTubeThumbnail(videoUrl),
            duration: 0, // Duration not available
            size: 0,
            isExclusive: true,
            createdBy: 'super-admin'
          };

          try {
            // Check if content already exists
            const existingContent = await Content.findOne({
              fileUrl: videoUrl,
              subject: subject._id,
              board: board
            });

            if (existingContent) {
              console.log(`  ⚠️  Video already exists: ${contentData.title}`);
              continue;
            }

            const content = new Content(contentData);
            await content.save();
            console.log(`  ✅ Uploaded: Video ${videoNumber} - ${chapterData.chapter}`);
            totalUploaded++;
          } catch (error) {
            console.error(`  ❌ Failed to upload ${contentData.title}:`, error.message);
            totalFailed++;
          }
        }
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Successfully uploaded: ${totalUploaded}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`\n✅ Bulk upload completed!`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
    process.exit(0);
  }
}

// Run the script
uploadVideos();
