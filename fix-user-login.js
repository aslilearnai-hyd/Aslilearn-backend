import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

// MongoDB connection - must be set in .env
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment variables!');
  process.exit(1);
}

async function fixUserLogin() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const email = 'ak@gmail.com';
    const password = 'Password123';

    // Check if user exists
    let user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log('❌ User not found. Creating new user...');
      const hashedPassword = await bcrypt.hash(password, 12);
      user = new User({
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: 'Akhilesh',
        role: 'admin',
        isActive: true,
        board: 'CBSE_AP',
        schoolName: 'Test School'
      });
      await user.save();
      console.log('✅ User created successfully');
    } else {
      console.log('✅ User found:', {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive
      });

      // Update password
      console.log('Updating password...');
      const hashedPassword = await bcrypt.hash(password, 12);
      user.password = hashedPassword;
      user.isActive = true;
      await user.save();
      console.log('✅ Password updated successfully');
    }

    // Verify login
    console.log('\n🔐 Verifying login...');
    const testUser = await User.findOne({ email: email.toLowerCase() });
    const isValid = await bcrypt.compare(password, testUser.password);
    
    if (isValid) {
      console.log('✅ Login verification successful!');
      console.log('\n📋 Login Credentials:');
      console.log(`   Email: ${email}`);
      // Password deliberately NOT logged — it was printed in plaintext here, so
      // it landed in terminal scrollback, CI output and any captured log file.
      console.log('   Password: (set as provided — not printed)');
      console.log(`   Role: ${testUser.role}`);
    } else {
      console.log('❌ Login verification failed!');
    }

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixUserLogin();

