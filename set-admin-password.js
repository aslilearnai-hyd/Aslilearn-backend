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

const setAdminPassword = async () => {
  try {
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const newPassword = String(process.env.ADMIN_NEW_PASSWORD || '');
    if (!adminEmail || !newPassword) {
      throw new Error('ADMIN_EMAIL and ADMIN_NEW_PASSWORD are required');
    }
    if (newPassword.length < 12) {
      throw new Error('ADMIN_NEW_PASSWORD must be at least 12 characters');
    }

    await connectDB();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const admin = await User.findOneAndUpdate(
      { email: adminEmail },
      { password: hashedPassword },
      { new: true }
    );
    
    if (admin) {
      console.log('Admin password updated successfully.');
    } else {
      console.log('Admin not found. No password was changed.');
    }
    
  } catch (error) {
    console.error('Password update failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

setAdminPassword();








