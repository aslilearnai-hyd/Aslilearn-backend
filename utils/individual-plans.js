import IndividualPlanSettings from '../models/IndividualPlanSettings.js';

export const PACKAGE_TYPES = ['board', 'iit', 'both'];
export const PLAN_LABELS = {
  board: 'Boards',
  iit: 'IIT Foundation',
  both: 'Boards + IIT',
};

export const DEFAULT_RATE_FIELDS = {
  studentBoardMonth: 99,
  studentIitMonth: 249,
  studentBothMonth: null,
  studentBoardYear: null,
  studentIitYear: null,
  studentBothYear: null,
  studentYearlyDiscountPercent: 0,
  teacherBoardMonth: 99,
  teacherBoardYear: null,
  teacherIitYear: 3999,
  teacherBothYear: null,
  teacherYearlyDiscountPercent: 0,
};

function n(v, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function roundInr(v) {
  return Math.max(0, Math.round(n(v, 0)));
}

function clampDiscount(v) {
  const d = n(v, 0);
  if (d < 0) return 0;
  if (d > 90) return 90;
  return Math.round(d * 10) / 10;
}

export function normalizeBillingRole(role) {
  return String(role || '').toLowerCase() === 'teacher' ? 'teacher' : 'student';
}

export function normalizePackageType(raw) {
  const v = String(raw || '').toLowerCase().trim();
  return PACKAGE_TYPES.includes(v) ? v : '';
}

export function normalizePeriod(raw, fallback = 'month') {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'year' || v === 'month') return v;
  return fallback;
}

function applyDiscount(listPrice, percent) {
  const list = roundInr(listPrice);
  const d = clampDiscount(percent);
  if (d <= 0) return { listPriceInr: list, amountInr: list, discountPercent: 0 };
  const amount = roundInr(list * (1 - d / 100));
  return { listPriceInr: list, amountInr: Math.max(1, amount), discountPercent: d };
}

function moneyOption(listPrice, discountPercent, period, label) {
  const priced = applyDiscount(listPrice, discountPercent);
  if (priced.listPriceInr <= 0 && priced.amountInr <= 0) return null;
  return {
    ...priced,
    period,
    label,
  };
}

export function ratesFromDoc(doc) {
  const src = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc || {};
  return {
    studentBoardMonth: roundInr(src.studentBoardMonth ?? DEFAULT_RATE_FIELDS.studentBoardMonth),
    studentIitMonth: roundInr(src.studentIitMonth ?? DEFAULT_RATE_FIELDS.studentIitMonth),
    studentBothMonth:
      src.studentBothMonth == null || src.studentBothMonth === ''
        ? null
        : roundInr(src.studentBothMonth),
    studentBoardYear:
      src.studentBoardYear == null || src.studentBoardYear === '' ? null : roundInr(src.studentBoardYear),
    studentIitYear:
      src.studentIitYear == null || src.studentIitYear === '' ? null : roundInr(src.studentIitYear),
    studentBothYear:
      src.studentBothYear == null || src.studentBothYear === '' ? null : roundInr(src.studentBothYear),
    studentYearlyDiscountPercent: clampDiscount(
      src.studentYearlyDiscountPercent ?? DEFAULT_RATE_FIELDS.studentYearlyDiscountPercent,
    ),
    teacherBoardMonth: roundInr(src.teacherBoardMonth ?? DEFAULT_RATE_FIELDS.teacherBoardMonth),
    teacherBoardYear:
      src.teacherBoardYear == null || src.teacherBoardYear === '' ? null : roundInr(src.teacherBoardYear),
    teacherIitYear: roundInr(src.teacherIitYear ?? DEFAULT_RATE_FIELDS.teacherIitYear),
    teacherBothYear:
      src.teacherBothYear == null || src.teacherBothYear === '' ? null : roundInr(src.teacherBothYear),
    teacherYearlyDiscountPercent: clampDiscount(
      src.teacherYearlyDiscountPercent ?? DEFAULT_RATE_FIELDS.teacherYearlyDiscountPercent,
    ),
  };
}

function studentMonth(rates, packageType) {
  const board = rates.studentBoardMonth;
  const iit = rates.studentIitMonth;
  if (packageType === 'board') return board;
  if (packageType === 'iit') return iit;
  return rates.studentBothMonth == null ? board + iit : rates.studentBothMonth;
}

function studentYearList(rates, packageType) {
  const monthly = studentMonth(rates, packageType);
  if (packageType === 'board' && rates.studentBoardYear != null) return rates.studentBoardYear;
  if (packageType === 'iit' && rates.studentIitYear != null) return rates.studentIitYear;
  if (packageType === 'both' && rates.studentBothYear != null) return rates.studentBothYear;
  return monthly * 12;
}

function teacherMonth(rates, packageType) {
  const board = rates.teacherBoardMonth;
  const iitYear = rates.teacherIitYear;
  if (packageType === 'board') return board;
  if (packageType === 'iit') return roundInr(iitYear / 12) || iitYear;
  const bothYear = rates.teacherBothYear == null ? iitYear + board * 12 : rates.teacherBothYear;
  return roundInr(bothYear / 12) || bothYear;
}

function teacherYearList(rates, packageType) {
  const board = rates.teacherBoardMonth;
  const iitYear = rates.teacherIitYear;
  if (packageType === 'board') {
    if (rates.teacherBoardYear != null) return rates.teacherBoardYear;
    return board * 12;
  }
  if (packageType === 'iit') return iitYear;
  return rates.teacherBothYear == null ? iitYear + board * 12 : rates.teacherBothYear;
}

export function buildPlanCatalog(ratesInput) {
  const rates = ratesFromDoc(ratesInput);
  const studentDiscount = rates.studentYearlyDiscountPercent;
  const teacherDiscount = rates.teacherYearlyDiscountPercent;

  const pack = (role) => {
    const out = {};
    for (const packageType of PACKAGE_TYPES) {
      const label = PLAN_LABELS[packageType];
      if (role === 'student') {
        const monthList = studentMonth(rates, packageType);
        const yearList = studentYearList(rates, packageType);
        out[packageType] = {
          month: moneyOption(monthList, 0, 'month', label),
          year: yearList != null ? moneyOption(yearList, studentDiscount, 'year', label) : null,
        };
      } else {
        const monthList = packageType === 'board' ? teacherMonth(rates, 'board') : null;
        const yearList = teacherYearList(rates, packageType);
        out[packageType] = {
          month: monthList != null ? moneyOption(monthList, 0, 'month', label) : null,
          year: yearList != null ? moneyOption(yearList, teacherDiscount, 'year', label) : null,
        };
      }
    }
    return out;
  };

  return {
    student: pack('student'),
    teacher: pack('teacher'),
    rates,
  };
}

export async function getIndividualPlanRates() {
  let doc = await IndividualPlanSettings.findOne({ key: 'individual' });
  if (!doc) {
    doc = await IndividualPlanSettings.create({ key: 'individual', ...DEFAULT_RATE_FIELDS });
  }
  return ratesFromDoc(doc);
}

export async function saveIndividualPlanRates(patch, updatedBy = '') {
  const current = await getIndividualPlanRates();
  const next = ratesFromDoc({ ...current, ...patch });
  const doc = await IndividualPlanSettings.findOneAndUpdate(
    { key: 'individual' },
    { $set: { ...next, updatedBy: String(updatedBy || '') } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return ratesFromDoc(doc);
}

export async function publicPlanCatalog() {
  const rates = await getIndividualPlanRates();
  const built = buildPlanCatalog(rates);
  return { student: built.student, teacher: built.teacher };
}

/**
 * @param {{ role?: string, packageType?: string, period?: string }} input
 */
export async function resolveIndividualPlan(input = {}) {
  const role = normalizeBillingRole(input.role);
  const packageType = normalizePackageType(input.packageType);
  if (!packageType) return null;
  const catalog = await publicPlanCatalog();
  const pack = catalog[role]?.[packageType];
  if (!pack) return null;
  const requested = normalizePeriod(input.period, role === 'teacher' && packageType !== 'board' ? 'year' : 'month');
  const option = pack[requested] || pack.year || pack.month;
  if (!option) return null;
  return {
    role,
    packageType,
    amountInr: option.amountInr,
    amountPaise: option.amountInr * 100,
    listPriceInr: option.listPriceInr,
    discountPercent: option.discountPercent,
    period: option.period,
    label: option.label,
  };
}

export function subscriptionExpiryDate(period, from = new Date()) {
  const d = new Date(from);
  if (period === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}
