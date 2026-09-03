import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import School from '../models/School.js';

// Query current state on each request: deactivation must not wait for JWT expiry.
export async function resolveActiveAccount(claims, models = { User, Teacher, School }) {
  const id = claims?.userId || claims?.id;
  const role = claims?.role;
  if (!mongoose.isValidObjectId(id) || !['student', 'teacher', 'admin', 'super-admin'].includes(role)) return null;
  let account = role === 'teacher' ? await models.Teacher.findById(id).lean() : null;
  if (!account) account = await models.User.findById(id).lean();
  if (!account || account.role !== role || account.isActive === false || account.deletedAt) return null;
  const adminId = role === 'admin' ? account._id : account.adminId || account.assignedAdmin;
  if (adminId && role !== 'admin') {
    const admin = await models.User.findById(adminId).lean();
    if (!admin || admin.role !== 'admin' || admin.isActive === false || admin.deletedAt) return null;
  }
  const schoolQuery = account.schoolId ? { _id: account.schoolId } : adminId ? { adminUserId: adminId } : null;
  if (schoolQuery) {
    const school = await models.School.findOne(schoolQuery).lean();
    if ((account.schoolId && !school) || school?.isActive === false) return null;
  }
  return { ...claims, userId: String(account._id), id: String(account._id), role: account.role };
}
