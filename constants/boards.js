/** Canonical school board codes (admin / teacher / content / exams). */
export const VALID_SCHOOL_BOARDS = ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE'];

export function isValidSchoolBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  return VALID_SCHOOL_BOARDS.includes(String(code).toUpperCase().trim());
}

/** Uppercase board if valid, otherwise ASLI_EXCLUSIVE_SCHOOLS */
export function normalizeSchoolBoard(code) {
  const u = String(code ?? '').toUpperCase().trim();
  return VALID_SCHOOL_BOARDS.includes(u) ? u : 'ASLI_EXCLUSIVE_SCHOOLS';
}
