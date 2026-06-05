import mongoose from 'mongoose';
import School from '../models/School.js';
import User from '../models/User.js';
import {
  isStoredCurriculumBoard,
  resolveAdminStoredBoard,
} from '../constants/boards.js';

/** Keep only digits, max 10 (Indian mobile). Empty string if none. */
export function normalizePhoneTenDigits(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 10);
  return digits;
}

export function isValidOptionalPhoneTenDigits(raw) {
  const digits = normalizePhoneTenDigits(raw);
  return digits.length === 0 || digits.length === 10;
}

export const normalizeSchoolDetails = (raw, fallbackState) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const stateVal =
    (typeof src.state === 'string' && src.state.trim()) ||
    (typeof fallbackState === 'string' && fallbackState.trim()) ||
    '';
  return {
    doorNo: String(src.doorNo || '').trim(),
    street: String(src.street || '').trim(),
    area: String(src.area || '').trim(),
    city: String(src.city || '').trim(),
    district: String(src.district || '').trim(),
    state: stateVal,
    medium: String(src.medium || '').trim(),
    classesFrom: String(src.classesFrom || '').trim(),
    classesTo: String(src.classesTo || '').trim(),
    totalStrength: String(src.totalStrength || '').trim(),
    schoolType: String(src.schoolType || '').trim(),
    photos: Array.isArray(src.photos) ? src.photos.map((p) => String(p).trim()).filter(Boolean) : [],
  };
};

/** Build school document fields from create/update request body */
export function buildSchoolFieldsFromBody(body) {
  const {
    schoolName,
    schoolLogo,
    contactPerson,
    phone,
    secondaryContactPerson,
    secondaryContactPhone,
    place,
    pin,
    state,
    schoolDetails: rawSchoolDetails,
    board,
    isAsliPrepExclusive: rawExclusive,
  } = body;

  const curriculumUpper = String(board || 'CBSE').toUpperCase().trim();
  const exclusive =
    rawExclusive === undefined || rawExclusive === null ? false : Boolean(rawExclusive);
  const finalBoard = resolveAdminStoredBoard(exclusive, curriculumUpper);
  const schoolDetails = normalizeSchoolDetails(rawSchoolDetails, state);
  const placeLine =
    (place && String(place).trim()) ||
    [schoolDetails.city, schoolDetails.district, schoolDetails.state].filter(Boolean).join(', ');

  return {
    name: String(schoolName || '').trim(),
    schoolLogo: schoolLogo?.trim() || '',
    contactPerson: contactPerson?.trim() || '',
    phone: normalizePhoneTenDigits(phone),
    secondaryContactPerson: secondaryContactPerson?.trim() || '',
    secondaryContactPhone: normalizePhoneTenDigits(secondaryContactPhone),
    place: placeLine,
    pin: pin?.trim() || '',
    schoolDetails,
    board: finalBoard,
    curriculumBoard: curriculumUpper,
    isAsliPrepExclusive: exclusive,
  };
}

/** Copy school profile onto admin user for legacy code paths */
export function applySchoolToAdminUser(admin, school) {
  if (!admin || !school) return;
  admin.schoolId = school._id;
  admin.schoolName = school.name;
  admin.schoolLogo = school.schoolLogo;
  admin.contactPerson = school.contactPerson;
  admin.phone = school.phone;
  admin.secondaryContactPerson = school.secondaryContactPerson;
  admin.secondaryContactPhone = school.secondaryContactPhone;
  admin.place = school.place;
  admin.pin = school.pin;
  admin.schoolDetails = school.schoolDetails;
  admin.board = school.board;
  admin.curriculumBoard = school.curriculumBoard;
  admin.isAsliPrepExclusive = school.isAsliPrepExclusive;
}

/** Build a school-shaped object from an admin user when schools collection row is missing */
export function schoolShapeFromAdminUser(admin) {
  if (!admin) return null;
  return {
    _id: admin.schoolId || undefined,
    adminUserId: admin._id,
    name: String(admin.schoolName || admin.fullName || admin.email || 'School').trim(),
    board: admin.board || 'ASLI_EXCLUSIVE_SCHOOLS',
    curriculumBoard: admin.curriculumBoard || 'CBSE',
    isAsliPrepExclusive: Boolean(admin.isAsliPrepExclusive),
    schoolLogo: admin.schoolLogo || '',
    contactPerson: admin.contactPerson || admin.fullName || '',
    phone: admin.phone || '',
    secondaryContactPerson: admin.secondaryContactPerson || '',
    secondaryContactPhone: admin.secondaryContactPhone || '',
    place: admin.place || '',
    pin: admin.pin || '',
    schoolDetails: normalizeSchoolDetails(admin.schoolDetails),
    isActive: admin.isActive !== false,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

/** API shape for School Management UI (id = admin login id for backward compatibility) */
export function formatSchoolListItem(school, admin, stats = {}) {
  const sd = school?.schoolDetails || {};
  const adminUserId = admin?._id || school?.adminUserId;
  return {
    id: (adminUserId || school?._id)?.toString(),
    adminUserId: adminUserId?.toString() || '',
    schoolId: school?._id?.toString(),
    name: admin?.fullName || school?.contactPerson || '',
    email: admin?.email || '',
    board: school?.board,
    schoolName: school?.name,
    schoolLogo: school?.schoolLogo,
    contactPerson: school?.contactPerson,
    phone: school?.phone,
    secondaryContactPerson: school?.secondaryContactPerson,
    secondaryContactPhone: school?.secondaryContactPhone,
    place: school?.place,
    pin: school?.pin,
    state: sd.state || school?.place || '',
    schoolDetails: sd,
    permissions: admin?.permissions || [],
    curriculumBoard:
      school?.curriculumBoard ||
      (isStoredCurriculumBoard(school?.board) ? String(school.board).toUpperCase().trim() : 'CBSE'),
    isAsliPrepExclusive:
      school?.isAsliPrepExclusive === true || school?.board === 'ASLI_EXCLUSIVE_SCHOOLS',
    status: (admin?.isActive !== false && school?.isActive !== false) ? 'Active' : 'Inactive',
    joinDate: school?.createdAt || admin?.createdAt,
    stats: {
      students: stats.students ?? 0,
      teachers: stats.teachers ?? 0,
      videos: stats.videos ?? 0,
      assessments: stats.assessments ?? 0,
      exams: stats.exams ?? 0,
      totalExamsTaken: stats.totalExamsTaken ?? 0,
      averageScore: stats.averageScore ?? 0,
      averageAccuracy: stats.averageAccuracy ?? 0,
    },
    analytics: stats.analytics,
  };
}

export async function findSchoolByAdminId(adminId) {
  if (!adminId) return null;
  return School.findOne({ adminUserId: adminId }).lean();
}

export async function deleteSchoolById(schoolId) {
  if (!schoolId) return null;
  return School.findByIdAndDelete(schoolId);
}

/**
 * Resolve school + admin login from route param (admin user id or schools collection id).
 */
export async function resolveSchoolAndAdminByParamId(paramId) {
  const id = String(paramId || '').trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return { admin: null, school: null };
  }

  let admin = await User.findById(id);
  if (admin?.role === 'admin') {
    const school = admin.schoolId
      ? await School.findById(admin.schoolId)
      : await School.findOne({ adminUserId: admin._id });
    return { admin, school };
  }

  let school = await School.findById(id);
  if (!school) {
    school = await School.findOne({ adminUserId: id });
  }

  if (!school) {
    return { admin: null, school: null };
  }

  if (school.adminUserId) {
    admin = await User.findById(school.adminUserId);
    if (admin?.role !== 'admin') {
      admin = null;
    }
  }

  return { admin, school };
}
