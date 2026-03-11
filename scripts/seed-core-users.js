import bcrypt from 'bcryptjs';
import connectDB from '../config/database.js';
import User from '../models/User.js';

const usersToEnsure = [
  {
    email: 'amenityforge@gmail.com',
    password: 'Amenity',
    fullName: 'Super Admin',
    role: 'super-admin'
  },
  {
    email: 'satya.ram@brahmamtalent.com',
    password: 'Password123',
    fullName: 'Satya Ram',
    role: 'teacher'
  }
];

const run = async () => {
  try {
    await connectDB();

    for (const config of usersToEnsure) {
      const email = config.email.toLowerCase();
      let user = await User.findOne({ email });

      if (user) {
        console.log(`ℹ️ User already exists: ${email} (role=${user.role})`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(config.password, 10);

      user = new User({
        email,
        password: hashedPassword,
        fullName: config.fullName,
        role: config.role,
        isActive: true
      });

      await user.save();
      console.log(`✅ Created user: ${email} (role=${config.role})`);
    }
  } catch (err) {
    console.error('Error seeding core users:', err);
  } finally {
    process.exit(0);
  }
};

run();

