import { IIT_CATEGORIES, normalizeIitCategories } from '../constants/products.js';

export const INDIVIDUAL_TRIAL_DAYS = 7;

export const INDIVIDUAL_COURSE_OPTIONS = [
  'CBSE',
  'STATE',
  'IIT Foundation',
  'NEET',
  'Board Exams',
];

export const INDIVIDUAL_SUBJECT_OPTIONS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Science',
  'English',
  'Social Science',
  'Hindi',
  'Telugu',
];

export const INDIVIDUAL_CLASS_OPTIONS = [
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

export function buildTrialWindow(fromDate = new Date(), days = INDIVIDUAL_TRIAL_DAYS) {
  const trialStartsAt = new Date(fromDate);
  const trialEndsAt = new Date(trialStartsAt);
  trialEndsAt.setDate(trialEndsAt.getDate() + days);
  return { trialStartsAt, trialEndsAt };
}

export function normalizePhoneTenDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 10);
}

export function normalizeStringList(list, allowed = null) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const v = String(item || '').trim();
    if (!v) continue;
    if (allowed && !allowed.includes(v) && !allowed.map((a) => a.toUpperCase()).includes(v.toUpperCase())) {
      // allow free-text course/subject labels that aren't in the fixed list
      if (allowed === INDIVIDUAL_COURSE_OPTIONS || allowed === INDIVIDUAL_SUBJECT_OPTIONS) {
        // still accept custom values for flexibility
      } else {
        continue;
      }
    }
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function normalizeIndividualSignupBody(body = {}) {
  const role = String(body.role || 'student').toLowerCase().trim();
  if (role !== 'student' && role !== 'teacher') {
    return { ok: false, message: 'Role must be student or teacher for individual signup.' };
  }

  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const schoolName = String(body.schoolName || '').trim();
  const phone = normalizePhoneTenDigits(body.phone);
  const classNumber = String(body.classNumber || body.classLabel || '').trim();
  const curriculumBoard = String(body.curriculumBoard || body.board || 'CBSE')
    .toUpperCase()
    .trim();
  const interestedCourses = normalizeStringList(body.interestedCourses || body.courses);
  const interestedSubjects = normalizeStringList(body.interestedSubjects || body.subjects);
  const iitCategories = normalizeIitCategories(body.iitCategories || body.products);

  if (!fullName) return { ok: false, message: 'Full name is required.' };
  if (!email || !email.includes('@')) return { ok: false, message: 'Valid email is required.' };
  if (!password || password.length < 6) {
    return { ok: false, message: 'Password must be at least 6 characters.' };
  }
  if (!schoolName) return { ok: false, message: 'School name is required.' };
  if (phone.length !== 10) return { ok: false, message: 'Phone number must be exactly 10 digits.' };
  if (role === 'student' && !classNumber) {
    return { ok: false, message: 'Class is required for students.' };
  }
  if (!interestedCourses.length) {
    return { ok: false, message: 'Select at least one course you are interested in.' };
  }
  if (!interestedSubjects.length) {
    return { ok: false, message: 'Select at least one subject.' };
  }

  const { trialStartsAt, trialEndsAt } = buildTrialWindow();

  return {
    ok: true,
    data: {
      role,
      fullName,
      email,
      password,
      schoolName,
      phone,
      classNumber: classNumber || '',
      curriculumBoard: curriculumBoard || 'CBSE',
      interestedCourses,
      interestedSubjects,
      iitCategories,
      isIndividualAccount: true,
      isAsliPrepExclusive: iitCategories.length > 0,
      subscriptionStatus: 'trial',
      trialStartsAt,
      trialEndsAt,
      trialDays: INDIVIDUAL_TRIAL_DAYS,
    },
  };
}

/**
 * Resolve billing access for an individual account document (User or Teacher).
 */
export function resolveIndividualAccess(doc) {
  if (!doc || !doc.isIndividualAccount) {
    return {
      isIndividualAccount: false,
      subscriptionStatus: 'none',
      paymentRequired: false,
      trialActive: false,
      trialEndsAt: null,
      trialDaysLeft: null,
      trialAllowedContentTypes: [],
      trialAllowedAiTools: [],
    };
  }

  const now = Date.now();
  const ends = doc.trialEndsAt ? new Date(doc.trialEndsAt).getTime() : null;
  const status = String(doc.subscriptionStatus || 'trial').toLowerCase();

  if (status === 'active' || status === 'paid') {
    return {
      isIndividualAccount: true,
      subscriptionStatus: 'active',
      paymentRequired: false,
      trialActive: false,
      trialEndsAt: doc.trialEndsAt || null,
      trialDaysLeft: 0,
      trialAllowedContentTypes: Array.isArray(doc.trialAllowedContentTypes)
        ? doc.trialAllowedContentTypes
        : [],
      trialAllowedAiTools: Array.isArray(doc.trialAllowedAiTools) ? doc.trialAllowedAiTools : [],
    };
  }

  const trialActive = Boolean(ends && ends > now && (status === 'trial' || !status || status === 'none'));
  const daysLeft =
    trialActive && ends ? Math.max(0, Math.ceil((ends - now) / (24 * 60 * 60 * 1000))) : 0;

  return {
    isIndividualAccount: true,
    subscriptionStatus: trialActive ? 'trial' : 'expired',
    paymentRequired: !trialActive,
    trialActive,
    trialEndsAt: doc.trialEndsAt || null,
    trialDaysLeft: daysLeft,
    trialAllowedContentTypes: Array.isArray(doc.trialAllowedContentTypes)
      ? doc.trialAllowedContentTypes
      : [],
    trialAllowedAiTools: Array.isArray(doc.trialAllowedAiTools) ? doc.trialAllowedAiTools : [],
  };
}

/** Individual accounts that are not fully paid — eligible for trialOnly quizzes. */
export function isTrialQuizAudience(doc) {
  if (!doc?.isIndividualAccount) return false;
  const access = resolveIndividualAccess(doc);
  return access.subscriptionStatus !== 'active';
}

export { IIT_CATEGORIES };
