import mongoose from 'mongoose';
import School from '../models/School.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import {
  isStoredCurriculumBoard,
  resolveAdminStoredBoard,
} from '../constants/boards.js';
import { resolveSchoolIitTrackFields } from '../constants/products.js';

/** Keep only digits, max 10 (Indian mobile). Empty string if none. */
export function normalizePhoneTenDigits(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 10);
  return digits;
}

export function isValidOptionalPhoneTenDigits(raw) {
  const digits = normalizePhoneTenDigits(raw);
  return digits.length === 0 || digits.length === 10;
}

/** Digits only for storage after validation (max 6). */
export function normalizeIndianPincode(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (!/^\d+$/.test(trimmed) || trimmed.length !== 6 || !/^[1-9]\d{5}$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Empty OR exactly 6 digits with first digit 1–9.
 * Rejects longer values (e.g. 12-digit junk) — does not truncate-then-accept.
 */
export function isValidOptionalIndianPincode(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return true;
  if (!/^\d+$/.test(trimmed)) return false;
  if (trimmed.length !== 6) return false;
  return /^[1-9]\d{5}$/.test(trimmed);
}

/** Optional door/street/area lines — reject symbol-only junk. */
export function isValidOptionalAddressLine(raw, { max = 120 } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (s.length > max) return false;
  try {
    if (!/[\p{L}\p{N}]/u.test(s)) return false;
    return /^[\p{L}\p{M}\p{N}\s.'&\-()/#]+$/u.test(s);
  } catch {
    if (!/[A-Za-z0-9]/.test(s)) return false;
    return /^[A-Za-z0-9\s.'&\-()/#]+$/.test(s);
  }
}

/**
 * School / city / district: must include letters; reject symbol-only junk.
 */
export function isValidSchoolPlaceName(raw, { min = 2, max = 120 } = {}) {
  const s = String(raw ?? '').trim();
  if (s.length < min || s.length > max) return false;
  try {
    if (!/\p{L}/u.test(s)) return false;
    return /^[\p{L}\p{M}\p{N}\s.'&\-()/]+$/u.test(s);
  } catch {
    if (!/[A-Za-z]/.test(s)) return false;
    return /^[A-Za-z0-9\s.'&\-()/]+$/.test(s);
  }
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
    iitCategories: rawIitCategories,
    iitCategoriesByClass: rawIitCategoriesByClass,
    licensedStudents,
    licensedTeachers,
    accountSeatsNotes,
  } = body;

  const curriculumUpper = String(board || 'CBSE').toUpperCase().trim();
  const exclusive =
    rawExclusive === undefined || rawExclusive === null ? false : Boolean(rawExclusive);
  const finalBoard = resolveAdminStoredBoard(exclusive, curriculumUpper);
  const schoolDetails = normalizeSchoolDetails(rawSchoolDetails, state);
  const placeLine =
    (place && String(place).trim()) ||
    [schoolDetails.city, schoolDetails.district, schoolDetails.state].filter(Boolean).join(', ');
  const { iitCategories, iitCategoriesByClass } = resolveSchoolIitTrackFields({
    exclusive,
    iitCategories: rawIitCategories,
    iitCategoriesByClass: rawIitCategoriesByClass,
    classesFrom: schoolDetails.classesFrom,
    classesTo: schoolDetails.classesTo,
  });

  const fields = {
    name: String(schoolName || '').trim(),
    schoolLogo: schoolLogo?.trim() || '',
    contactPerson: contactPerson?.trim() || '',
    phone: normalizePhoneTenDigits(phone),
    secondaryContactPerson: secondaryContactPerson?.trim() || '',
    secondaryContactPhone: normalizePhoneTenDigits(secondaryContactPhone),
    place: placeLine,
    pin: normalizeIndianPincode(pin),
    schoolDetails,
    board: finalBoard,
    curriculumBoard: curriculumUpper,
    isAsliPrepExclusive: exclusive,
    iitCategories,
    iitCategoriesByClass,
  };

  if (licensedStudents !== undefined && licensedStudents !== null && licensedStudents !== '') {
    fields.licensedStudents = Math.max(0, Math.floor(Number(licensedStudents) || 0));
  }
  if (licensedTeachers !== undefined && licensedTeachers !== null && licensedTeachers !== '') {
    fields.licensedTeachers = Math.max(0, Math.floor(Number(licensedTeachers) || 0));
  }
  if (accountSeatsNotes !== undefined && accountSeatsNotes !== null) {
    fields.accountSeatsNotes = String(accountSeatsNotes).trim();
  }

  return fields;
}

/** Normalize non-negative integer seat counts from request body */
export function normalizeAccountSeats(body = {}) {
  const parseSeat = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) return NaN;
    return n;
  };
  return {
    licensedStudents: parseSeat(body.licensedStudents),
    licensedTeachers: parseSeat(body.licensedTeachers),
    accountSeatsNotes:
      body.accountSeatsNotes === undefined || body.accountSeatsNotes === null
        ? null
        : String(body.accountSeatsNotes).trim(),
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
  admin.iitCategories = Array.isArray(school.iitCategories) ? school.iitCategories : [];
  admin.iitCategoriesByClass =
    school.iitCategoriesByClass && typeof school.iitCategoriesByClass === 'object'
      ? school.iitCategoriesByClass
      : {};
  if (school.licensedStudents !== undefined) {
    admin.licensedStudents = Math.max(0, Math.floor(Number(school.licensedStudents) || 0));
  }
  if (school.licensedTeachers !== undefined) {
    admin.licensedTeachers = Math.max(0, Math.floor(Number(school.licensedTeachers) || 0));
  }
  if (school.accountSeatsNotes !== undefined) {
    admin.accountSeatsNotes = String(school.accountSeatsNotes || '').trim();
  }
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
    iitCategories: Array.isArray(admin.iitCategories) ? admin.iitCategories : [],
    iitCategoriesByClass:
      admin.iitCategoriesByClass && typeof admin.iitCategoriesByClass === 'object'
        ? admin.iitCategoriesByClass
        : {},
    schoolLogo: admin.schoolLogo || '',
    contactPerson: admin.contactPerson || admin.fullName || '',
    phone: admin.phone || '',
    secondaryContactPerson: admin.secondaryContactPerson || '',
    secondaryContactPhone: admin.secondaryContactPhone || '',
    place: admin.place || '',
    pin: admin.pin || '',
    schoolDetails: normalizeSchoolDetails(admin.schoolDetails),
    licensedStudents: Math.max(0, Math.floor(Number(admin.licensedStudents) || 0)),
    licensedTeachers: Math.max(0, Math.floor(Number(admin.licensedTeachers) || 0)),
    accountSeatsNotes: String(admin.accountSeatsNotes || '').trim(),
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
    vidyaEnabledForTeachers: admin?.vidyaEnabledForTeachers !== false,
    vidyaEnabledForStudents: admin?.vidyaEnabledForStudents !== false,
    vidyaUsageMode:
      String(admin?.vidyaUsageMode || school?.vidyaUsageMode || 'unlimited').toLowerCase() ===
      'limited'
        ? 'limited'
        : 'unlimited',
    vidyaLimitChatbot: Boolean(admin?.vidyaLimitChatbot ?? school?.vidyaLimitChatbot),
    vidyaLimitTools: Boolean(admin?.vidyaLimitTools ?? school?.vidyaLimitTools),
    vidyaChatPerDay: Math.max(
      1,
      Math.floor(Number(admin?.vidyaChatPerDay ?? school?.vidyaChatPerDay) || 10)
    ),
    vidyaGenerationsPerDay: Math.max(
      1,
      Math.floor(Number(admin?.vidyaGenerationsPerDay ?? school?.vidyaGenerationsPerDay) || 10)
    ),
    curriculumBoard:
      school?.curriculumBoard ||
      (isStoredCurriculumBoard(school?.board) ? String(school.board).toUpperCase().trim() : 'CBSE'),
    isAsliPrepExclusive:
      school?.isAsliPrepExclusive === true || school?.board === 'ASLI_EXCLUSIVE_SCHOOLS',
    iitCategories: Array.isArray(school?.iitCategories)
      ? school.iitCategories
      : Array.isArray(admin?.iitCategories)
        ? admin.iitCategories
        : [],
    iitCategoriesByClass:
      school?.iitCategoriesByClass && typeof school.iitCategoriesByClass === 'object'
        ? school.iitCategoriesByClass
        : admin?.iitCategoriesByClass && typeof admin.iitCategoriesByClass === 'object'
          ? admin.iitCategoriesByClass
          : {},
    status: (admin?.isActive !== false && school?.isActive !== false) ? 'Active' : 'Inactive',
    joinDate: school?.createdAt || admin?.createdAt,
    licensedStudents: Math.max(
      0,
      Math.floor(
        Number(
          school?.licensedStudents ?? admin?.licensedStudents ?? 0
        ) || 0
      )
    ),
    licensedTeachers: Math.max(
      0,
      Math.floor(
        Number(
          school?.licensedTeachers ?? admin?.licensedTeachers ?? 0
        ) || 0
      )
    ),
    accountSeatsNotes: String(
      school?.accountSeatsNotes ?? admin?.accountSeatsNotes ?? ''
    ).trim(),
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

/**
 * Live used + licensed seat counts for a school admin.
 * licensed = 0 means no cap set yet (treat as unlimited for enforcement).
 */
export async function getAccountSeatUsage(adminId) {
  const id = adminId?.toString?.() || adminId;
  if (!id) {
    return {
      usedStudents: 0,
      usedTeachers: 0,
      licensedStudents: 0,
      licensedTeachers: 0,
      accountSeatsNotes: '',
    };
  }

  const [admin, school, usedStudents, usedTeachers] = await Promise.all([
    User.findById(id)
      .select('licensedStudents licensedTeachers accountSeatsNotes')
      .lean(),
    School.findOne({ adminUserId: id })
      .select('licensedStudents licensedTeachers accountSeatsNotes')
      .lean(),
    User.countDocuments({ role: 'student', assignedAdmin: id, deletedAt: null }),
    Teacher.countDocuments({ adminId: id }),
  ]);

  const licensedStudents = Math.max(
    0,
    Math.floor(Number(school?.licensedStudents ?? admin?.licensedStudents ?? 0) || 0)
  );
  const licensedTeachers = Math.max(
    0,
    Math.floor(Number(school?.licensedTeachers ?? admin?.licensedTeachers ?? 0) || 0)
  );

  return {
    usedStudents,
    usedTeachers,
    licensedStudents,
    licensedTeachers,
    accountSeatsNotes: String(
      school?.accountSeatsNotes ?? admin?.accountSeatsNotes ?? ''
    ).trim(),
  };
}

/** Returns error message if creating `extra` accounts would exceed licensed seats; null if ok. */
export async function assertWithinAccountSeats(adminId, { students = 0, teachers = 0 } = {}) {
  const usage = await getAccountSeatUsage(adminId);
  if (students > 0 && usage.licensedStudents > 0) {
    if (usage.usedStudents + students > usage.licensedStudents) {
      return {
        ok: false,
        message: `Student account limit reached (${usage.usedStudents}/${usage.licensedStudents}). Contact Super Admin to increase licensed student seats.`,
        usage,
      };
    }
  }
  if (teachers > 0 && usage.licensedTeachers > 0) {
    if (usage.usedTeachers + teachers > usage.licensedTeachers) {
      return {
        ok: false,
        message: `Teacher account limit reached (${usage.usedTeachers}/${usage.licensedTeachers}). Contact Super Admin to increase licensed teacher seats.`,
        usage,
      };
    }
  }
  return { ok: true, usage };
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
