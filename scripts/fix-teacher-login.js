// Script to check and fix teacher login issues
// Usage: node backend/scripts/fix-teacher-login.js <email> [newPassword]

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

// Import Teacher model
import Teacher from '../models/Teacher.js';

async function fixTeacherLogin() {
  try {
    // Get email from command line arguments
    const email = process.argv[2];
    const newPassword = process.argv[3] || 'Password123';

    if (!email) {
      console.error('❌ Please provide teacher email as argument');
      console.log('Usage: node backend/scripts/fix-teacher-login.js <email> [newPassword]');
      console.log('Example: node backend/scripts/fix-teacher-login.js akhileshsamayamanthula@gmail.com Password123');
      process.exit(1);
    }

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cognilearn';
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find teacher
    const teacher = await Teacher.findOne({ email: email.toLowerCase() });
    
    if (!teacher) {
      console.log(`\n❌ Teacher with email "${email}" not found in database.`);
      console.log('\nWould you like to create this teacher account? (This requires manual confirmation)');
      console.log('To create, use the admin panel or run:');
      console.log(`node backend/scripts/create-teacher.js ${email} ${newPassword}`);
      process.exit(1);
    }

    console.log(`\n✅ Teacher found:`);
    console.log(`   Email: ${teacher.email}`);
    console.log(`   Name: ${teacher.fullName}`);
    console.log(`   Active: ${teacher.isActive}`);
    console.log(`   Has Password: ${!!teacher.password}`);

    // Check if account is active
    if (!teacher.isActive) {
      console.log('\n⚠️  Teacher account is INACTIVE. Activating...');
      teacher.isActive = true;
      await teacher.save();
      console.log('✅ Account activated');
    }

    // Test current password
    if (teacher.password) {
      const testPassword = newPassword;
      const isCurrentPasswordValid = await bcrypt.compare(testPassword, teacher.password);
      console.log(`\n🔐 Testing password "${testPassword}": ${isCurrentPasswordValid ? '✅ Valid' : '❌ Invalid'}`);
    }

    // Reset password
    console.log(`\n🔑 Resetting password to: "${newPassword}"`);
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    teacher.password = hashedPassword;
    teacher.isActive = true; // Ensure active
    await teacher.save();

    console.log('\n✅ Teacher account fixed successfully!');
    console.log('\n📋 Login Credentials:');
    console.log(`   Email: ${teacher.email}`);
    console.log(`   Password: ${newPassword}`);
    console.log(`   Status: Active`);
    
    // Verify the password works
    const verifyPassword = await bcrypt.compare(newPassword, teacher.password);
    console.log(`\n✅ Password verification: ${verifyPassword ? 'SUCCESS' : 'FAILED'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

fixTeacherLogin();
