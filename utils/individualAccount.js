import { IIT_CATEGORIES, normalizeIitCategories } from '../constants/products.js';
import { withTrialUsageLimits } from './trialUsageLimits.js';

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

export const ACCOUNT_SOURCES = [
  'web_register',
  'mobile_register',
  'super_admin',
  'legacy',
];

export const ACCOUNT_SOURCE_LABELS = {
  web_register: 'Self-signup · Web',
  mobile_register: 'Self-signup · Mobile',
  super_admin: 'Added by Super Admin',
  legacy: 'Self-signup · Legacy',
};

export function normalizeAccountSource(raw, fallback = 'legacy') {
  const value = String(raw || '')
    .toLowerCase()
    .trim();
  if (ACCOUNT_SOURCES.includes(value)) return value;
  return fallback;
}

export function accountSourceLabel(source) {
  const key = normalizeAccountSource(source);
  return ACCOUNT_SOURCE_LABELS[key] || ACCOUNT_SOURCE_LABELS.legacy;
}

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
  const accountSource = normalizeAccountSource(
    body.accountSource || body.source,
    'web_register',
  );
  const trialDaysRaw = Number(body.trialDays);
  const trialDays =
    Number.isFinite(trialDaysRaw) && trialDaysRaw > 0
      ? Math.min(365, Math.floor(trialDaysRaw))
      : INDIVIDUAL_TRIAL_DAYS;

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

  const { trialStartsAt, trialEndsAt } = buildTrialWindow(new Date(), trialDays);

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
      accountSource,
      isIndividualAccount: true,
      isAsliPrepExclusive: iitCategories.length > 0,
      subscriptionStatus: 'trial',
      trialStartsAt,
      trialEndsAt,
      trialDays,
    },
  };
}

/**
 * Resolve billing access for an individual account document (User or Teacher).
 */
export function resolveIndividualAccess(doc) {
  const schoolManagedStudent = Boolean(
    doc &&
      doc.role === 'student' &&
      !doc.isIndividualAccount &&
      doc.schoolStudentSubscriptionEnabled,
  );
  if (!doc || (!doc.isIndividualAccount && !schoolManagedStudent)) {
    return withTrialUsageLimits(
      {
        isIndividualAccount: false,
        isSchoolManagedSubscription: false,
        subscriptionStatus: 'none',
        paymentRequired: false,
        trialActive: false,
        trialEndsAt: null,
        trialDaysLeft: null,
        trialAllowedContentTypes: [],
        trialAllowedAiTools: [],
      },
      doc
    );
  }

  const now = Date.now();
  const ends = doc.trialEndsAt ? new Date(doc.trialEndsAt).getTime() : null;
  const status = String(doc.subscriptionStatus || 'trial').toLowerCase();

  if (status === 'active' || status === 'paid') {
    const exp = doc.subscriptionExpiresAt ? new Date(doc.subscriptionExpiresAt).getTime() : null;
    const stillPaid = !exp || exp > now;
    if (!stillPaid) {
      return withTrialUsageLimits(
        {
          isIndividualAccount: Boolean(doc.isIndividualAccount),
          isSchoolManagedSubscription: schoolManagedStudent,
          subscriptionStatus: 'expired',
          paymentRequired: true,
          trialActive: false,
          trialEndsAt: doc.trialEndsAt || null,
          trialDaysLeft: 0,
          canSubscribeEarly: false,
          ...individualSubscriptionSummary(doc),
          trialAllowedContentTypes: Array.isArray(doc.trialAllowedContentTypes)
            ? doc.trialAllowedContentTypes
            : [],
          trialAllowedAiTools: Array.isArray(doc.trialAllowedAiTools) ? doc.trialAllowedAiTools : [],
        },
        doc
      );
    }
    return withTrialUsageLimits(
      {
        isIndividualAccount: Boolean(doc.isIndividualAccount),
        isSchoolManagedSubscription: schoolManagedStudent,
        subscriptionStatus: 'active',
        paymentRequired: false,
        trialActive: false,
        trialEndsAt: doc.trialEndsAt || null,
        trialDaysLeft: 0,
        canSubscribeEarly: false,
        ...individualSubscriptionSummary(doc),
        trialAllowedContentTypes: Array.isArray(doc.trialAllowedContentTypes)
          ? doc.trialAllowedContentTypes
          : [],
        trialAllowedAiTools: Array.isArray(doc.trialAllowedAiTools) ? doc.trialAllowedAiTools : [],
      },
      doc
    );
  }

  const trialActive = Boolean(ends && ends > now && (status === 'trial' || !status || status === 'none'));
  const daysLeft =
    trialActive && ends ? Math.max(0, Math.ceil((ends - now) / (24 * 60 * 60 * 1000))) : 0;

  return withTrialUsageLimits(
    {
      isIndividualAccount: Boolean(doc.isIndividualAccount),
      isSchoolManagedSubscription: schoolManagedStudent,
      subscriptionStatus: trialActive ? 'trial' : 'expired',
      paymentRequired: !trialActive,
      trialActive,
      trialEndsAt: doc.trialEndsAt || null,
      trialDaysLeft: daysLeft,
      canSubscribeEarly: trialActive,
      ...individualSubscriptionSummary(doc),
    },
    doc
  );
}

/** Individual accounts that are not fully paid — eligible for trialOnly quizzes. */
export function isTrialQuizAudience(doc) {
  if (!doc?.isIndividualAccount) return false;
  const access = resolveIndividualAccess(doc);
  return access.subscriptionStatus !== 'active';
}

const PACKAGE_LABELS = {
  board: 'Boards',
  iit: 'IIT Foundation',
  both: 'Boards + IIT',
};

function buildLegacyPayment(doc) {
  const amount = doc?.trialPaymentAmount;
  const paidAt = doc?.trialPaidAt;
  const reference = doc?.trialPaymentReference || doc?.razorpayPaymentId;
  const validUntil = doc?.subscriptionExpiresAt;
  if (amount == null && !paidAt && !reference && !validUntil) return null;
  const packageType = String(doc?.paidPackage || '').toLowerCase();
  const period = String(doc?.subscriptionPeriod || '').toLowerCase();
  return {
    paidAt: paidAt || null,
    amountInr: amount ?? null,
    packageType: packageType || null,
    packageLabel: packageType ? PACKAGE_LABELS[packageType] || packageType : null,
    period: period || null,
    periodLabel: period === 'year' ? 'Yearly' : period === 'month' ? 'Monthly' : null,
    paymentMethod: doc?.trialPaymentMethod || null,
    paymentReference: reference || null,
    razorpayOrderId: doc?.razorpayOrderId || null,
    validUntil: validUntil || null,
    status: 'paid',
    source: doc?.trialPaymentMethod === 'razorpay' ? 'razorpay' : 'manual',
  };
}

function paymentTimeValue(payment) {
  const ts = payment?.paidAt ? new Date(payment.paidAt).getTime() : 0;
  return Number.isFinite(ts) ? ts : 0;
}

function individualPaymentHistory(doc) {
  const existing = Array.isArray(doc?.subscriptionPayments) ? doc.subscriptionPayments : [];
  const merged = [...existing];
  const legacy = buildLegacyPayment(doc);
  if (legacy) {
    const hasLegacy = merged.some(
      (entry) =>
        String(entry?.paymentReference || '') &&
        String(entry?.paymentReference || '') === String(legacy.paymentReference || ''),
    );
    if (!hasLegacy) merged.push(legacy);
  }
  return merged
    .map((entry) => ({
      paidAt: entry?.paidAt || null,
      amountInr: entry?.amountInr ?? null,
      packageType: entry?.packageType || null,
      packageLabel: entry?.packageLabel || null,
      period: entry?.period || null,
      periodLabel: entry?.periodLabel || null,
      paymentMethod: entry?.paymentMethod || null,
      paymentReference: entry?.paymentReference || null,
      razorpayOrderId: entry?.razorpayOrderId || null,
      validUntil: entry?.validUntil || null,
      status: entry?.status || 'paid',
      source: entry?.source || null,
    }))
    .sort((a, b) => paymentTimeValue(b) - paymentTimeValue(a));
}

export function individualSubscriptionSummary(doc) {
  if (!doc?.isIndividualAccount && !doc?.schoolStudentSubscriptionEnabled) return {};
  const pkg = String(doc.paidPackage || '').toLowerCase() || null;
  const period = String(doc.subscriptionPeriod || '').toLowerCase() || null;
  const payments = individualPaymentHistory(doc);
  return {
    paidPackage: pkg,
    paidPackageLabel: pkg ? PACKAGE_LABELS[pkg] || pkg : null,
    subscriptionPeriod: period,
    subscriptionPeriodLabel: period === 'year' ? 'Yearly' : period === 'month' ? 'Monthly' : null,
    subscriptionExpiresAt: doc.subscriptionExpiresAt || null,
    lastPaidAt: doc.trialPaidAt || null,
    lastPaymentAmountInr: doc.trialPaymentAmount ?? null,
    paymentMethod: doc.trialPaymentMethod || null,
    paymentReference: doc.trialPaymentReference || doc.razorpayPaymentId || null,
    razorpayOrderId: doc.razorpayOrderId || null,
    recentPayments: payments.slice(0, 8),
    recentPaymentCount: payments.length,
    isSchoolManagedSubscription: Boolean(doc?.schoolStudentSubscriptionEnabled),
    schoolStudentPaymentMode: doc?.schoolStudentPaymentMode || null,
    schoolStudentAnnualPriceInr: doc?.schoolStudentAnnualPriceInr ?? null,
  };
}

export function buildIndividualReceipt(doc, planExtra = {}) {
  const summary = individualSubscriptionSummary(doc);
  const status = String(doc?.subscriptionStatus || '').toLowerCase();
  const now = Date.now();
  const exp = summary.subscriptionExpiresAt
    ? new Date(summary.subscriptionExpiresAt).getTime()
    : null;
  const active = (status === 'active' || status === 'paid') && (!exp || exp > now);
  return {
    ...summary,
    status: active ? 'active' : status === 'trial' ? 'trial' : 'expired',
    statusLabel: active ? 'Active' : status === 'trial' ? 'Trial' : 'Expired',
    planLabel: planExtra.label || summary.paidPackageLabel,
    amountInr: planExtra.amountInr ?? summary.lastPaymentAmountInr,
    period: planExtra.period || summary.subscriptionPeriod,
    periodLabel: planExtra.period === 'year' ? 'Yearly' : planExtra.period === 'month' ? 'Monthly' : summary.subscriptionPeriodLabel,
    validUntil: summary.subscriptionExpiresAt,
    paidOn: summary.lastPaidAt,
  };
}

export { IIT_CATEGORIES };
