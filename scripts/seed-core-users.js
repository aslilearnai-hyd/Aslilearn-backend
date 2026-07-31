/**
 * Ensure core users exist. Passwords MUST come from environment — never hardcode.
 *
 * Required env:
 *   CORE_SUPER_ADMIN_EMAIL / CORE_SUPER_ADMIN_PASSWORD
 * Optional additional accounts via CORE_USERS_JSON (array of {email,password,fullName,role})
 *
 * Usage:
 *   CORE_SUPER_ADMIN_EMAIL=... CORE_SUPER_ADMIN_PASSWORD='...' node scripts/seed-core-users.js
 */
import bcrypt from 'bcryptjs';
import connectDB from '../config/database.js';
import User from '../models/User.js';

function buildUsersFromEnv() {
  const users = [];
  const email = process.env.CORE_SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.CORE_SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) {
      throw new Error('CORE_SUPER_ADMIN_PASSWORD must be at least 12 characters');
    }
    users.push({
      email,
      password,
      fullName: process.env.CORE_SUPER_ADMIN_NAME || 'Super Admin',
      role: 'super-admin',
    });
  }
  if (process.env.CORE_USERS_JSON) {
    const extra = JSON.parse(process.env.CORE_USERS_JSON);
    if (!Array.isArray(extra)) throw new Error('CORE_USERS_JSON must be a JSON array');
    for (const row of extra) {
      if (!row?.email || !row?.password || String(row.password).length < 12) {
        throw new Error('Each CORE_USERS_JSON entry needs email and password (≥12 chars)');
      }
      users.push({
        email: row.email,
        password: row.password,
        fullName: row.fullName || row.email,
        role: row.role || 'admin',
      });
    }
  }
  return users;
}

const run = async () => {
  try {
    const usersToEnsure = buildUsersFromEnv();
    if (!usersToEnsure.length) {
      console.error(
        'Refusing to seed: set CORE_SUPER_ADMIN_EMAIL + CORE_SUPER_ADMIN_PASSWORD (min 12 chars).'
      );
      process.exit(1);
    }

    await connectDB();

    for (const config of usersToEnsure) {
      const email = config.email.toLowerCase();
      let user = await User.findOne({ email });

      const hashedPassword = await bcrypt.hash(config.password, 12);

      if (user) {
        user.password = hashedPassword;
        user.fullName = config.fullName;
        user.role = config.role;
        user.isActive = true;
        await user.save();
        console.log(`Updated ${email}`);
      } else {
        await User.create({
          email,
          password: hashedPassword,
          fullName: config.fullName,
          role: config.role,
          isActive: true,
        });
        console.log(`Created ${email}`);
      }
    }

    console.log('Done. Passwords were never written to source.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();
