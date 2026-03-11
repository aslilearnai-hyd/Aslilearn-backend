import connectDB from '../config/database.js';
import User from '../models/User.js';

const run = async () => {
  try {
    const emailArg = process.argv[2];
    if (!emailArg) {
      console.error('Please provide an email to lookup, e.g.:');
      console.error('  node backend/scripts/debug-login-user.js user@example.com');
      process.exit(1);
    }

    const email = emailArg.toLowerCase();
    console.log('🔍 Looking up user by email:', email);

    await connectDB();

    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found in database');
    } else {
      console.log('✅ User found:');
      console.log({
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        hasPassword: !!user.password,
      });
    }
  } catch (err) {
    console.error('Error while checking user:', err);
  } finally {
    process.exit(0);
  }
};

run();

