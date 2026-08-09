/**
 * School CSV often uses admission IDs (e.g. "1724") as login ids.
 * Browser login requires an email shape, so we normalize bare ids to local@example.com.
 */

export const STUDENT_LOGIN_EMAIL_DOMAIN = 'example.com';

/**
 * @param {unknown} raw
 * @returns {string} normalized email (lowercase) or '' if empty
 */
export function normalizeStudentLoginEmail(raw) {
  let value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (!value) return '';

  // Strip accidental mailto: or wrappers
  value = value.replace(/^mailto:/i, '');

  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (!local || !domain) return '';
    return `${local}@${domain}`;
  }

  // Bare admission / roll id → valid email shape for login + storage
  if (!/^[a-z0-9._+-]+$/i.test(value)) {
    return '';
  }

  return `${value}@${STUDENT_LOGIN_EMAIL_DOMAIN}`;
}

/**
 * Emails to try when authenticating (supports legacy bare-id accounts).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function studentLoginEmailCandidates(raw) {
  const input = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^mailto:/i, '');
  if (!input) return [];

  const normalized = normalizeStudentLoginEmail(input);
  const out = [];
  const push = (v) => {
    if (v && !out.includes(v)) out.push(v);
  };

  push(normalized);
  push(input);
  if (!input.includes('@') && normalized) {
    push(input); // bare id already in DB
  }
  if (input.endsWith(`@${STUDENT_LOGIN_EMAIL_DOMAIN}`)) {
    push(input.split('@')[0]);
  }

  return out;
}

/**
 * Pick email from a CSV row: email, or student id columns when email blank.
 */
export function resolveStudentEmailFromCsvRow(row = {}) {
  const direct = normalizeStudentLoginEmail(row.email);
  if (direct) return direct;

  const idKeys = [
    'studentid',
    'student_id',
    'admission',
    'admissionno',
    'admissionnumber',
    'admission_no',
    'roll',
    'rollno',
    'rollnumber',
    'id',
    'userid',
    'loginid',
    'username',
    '',
    '__empty',
  ];

  for (const key of idKeys) {
    if (row[key] != null && String(row[key]).trim()) {
      const normalized = normalizeStudentLoginEmail(row[key]);
      if (normalized) return normalized;
    }
  }

  // Some sheets put the id in an unnamed / second column already mapped oddly
  for (const [key, val] of Object.entries(row)) {
    if (key === 'email' || key === 'name' || key === 'password') continue;
    if (key.includes('class') || key.includes('section') || key.includes('phone')) continue;
    const s = String(val || '').trim();
    if (/^\d{3,8}$/.test(s)) {
      return normalizeStudentLoginEmail(s);
    }
  }

  return '';
}
