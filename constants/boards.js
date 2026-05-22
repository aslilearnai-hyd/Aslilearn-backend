/** Curriculum alignment (non–Asli Prep stored `board` and `curriculumBoard`). */
export const CURRICULUM_BOARDS = ['CBSE', 'STATE', 'SSC', 'ICSE', 'IB', 'CAMBRIDGE'];

/** Canonical school board codes (admin / teacher / content / exams). */
export const VALID_SCHOOL_BOARDS = ['ASLI_EXCLUSIVE_SCHOOLS', ...CURRICULUM_BOARDS];

export function isValidSchoolBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  return VALID_SCHOOL_BOARDS.includes(String(code).toUpperCase().trim());
}

export function isValidCurriculumBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  return CURRICULUM_BOARDS.includes(String(code).toUpperCase().trim());
}

/** True if `code` is a curriculum board stored on User.board (not Asli Prep). */
export function isStoredCurriculumBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  return CURRICULUM_BOARDS.includes(String(code).toUpperCase().trim());
}

/**
 * Stored User.board: ASLI_EXCLUSIVE_SCHOOLS when Asli Prep; otherwise curriculum code.
 */
export function resolveAdminStoredBoard(isAsliPrepExclusive, curriculumBoard) {
  const c = String(curriculumBoard || '').toUpperCase().trim();
  const curriculum = isValidCurriculumBoard(c) ? c : 'CBSE';
  return isAsliPrepExclusive ? 'ASLI_EXCLUSIVE_SCHOOLS' : curriculum;
}

/** Uppercase board if valid, otherwise ASLI_EXCLUSIVE_SCHOOLS */
export function normalizeSchoolBoard(code) {
  let u = String(code ?? '').toUpperCase().trim();
  if (u === 'CBSC') u = 'CBSE';
  return VALID_SCHOOL_BOARDS.includes(u) ? u : 'ASLI_EXCLUSIVE_SCHOOLS';
}

/**
 * Human-facing curriculum board (CBSE, STATE, …) for profiles and school detail.
 * Prefers curriculumBoard; falls back to assigned admin when student row is stale.
 */
export function resolveUserDisplayBoard(user, assignedAdmin) {
  const u = user && typeof user === 'object' ? user : {};
  const a =
    assignedAdmin && typeof assignedAdmin === 'object' ? assignedAdmin : null;

  if (u.curriculumBoard && isValidCurriculumBoard(u.curriculumBoard)) {
    return String(u.curriculumBoard).toUpperCase().trim();
  }
  if (isStoredCurriculumBoard(u.board)) {
    return String(u.board).toUpperCase().trim();
  }
  if (a?.curriculumBoard && isValidCurriculumBoard(a.curriculumBoard)) {
    return String(a.curriculumBoard).toUpperCase().trim();
  }
  if (isStoredCurriculumBoard(a?.board)) {
    return String(a.board).toUpperCase().trim();
  }
  if (String(u.board || '').toUpperCase() === 'ASLI_EXCLUSIVE_SCHOOLS') {
    return (
      (a?.curriculumBoard && isValidCurriculumBoard(a.curriculumBoard)
        ? String(a.curriculumBoard).toUpperCase().trim()
        : null) || 'CBSE'
    );
  }
  const fallback = String(u.board || a?.board || '').toUpperCase().trim();
  return isValidCurriculumBoard(fallback) ? fallback : fallback || '';
}
