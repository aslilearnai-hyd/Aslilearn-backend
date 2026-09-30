import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ MONGO_URI is not set in environment variables!');
      process.exit(1);
    }
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const testLogin = async () => {
  try {
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const testPassword = String(process.env.ADMIN_TEST_PASSWORD || '');
    if (!adminEmail || !testPassword) {
      throw new Error('ADMIN_EMAIL and ADMIN_TEST_PASSWORD are required');
    }

    await connectDB();
    
    const admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      console.log('❌ Admin not found');
      return;
    }
    
    console.log('Admin found:', admin.email);
    console.log('Admin active:', admin.isActive);
    console.log('Admin role:', admin.role);
    console.log('Admin name:', admin.fullName);
    
    // Read-only verification: this script never changes stored credentials.
    const isPasswordValid = await bcrypt.compare(testPassword, admin.password);
    console.log('Password valid:', isPasswordValid);
    
    if (isPasswordValid) {
      console.log('✅ Login should work!');
    } else {
      console.log('❌ Password verification failed');
      process.exitCode = 1;
    }
    
  } catch (error) {
    console.error('Login verification failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

testLogin();








