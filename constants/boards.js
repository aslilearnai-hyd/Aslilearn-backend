/** Built-in curriculum codes (non–Asli Prep stored `board` and `curriculumBoard`). */
export const BUILTIN_CURRICULUM_BOARDS = [
  'CBSE',
  'STATE',
  'SSC',
  'ICSE',
  'IB',
  'CAMBRIDGE',
];

/** Hub / product boards (not chosen as school curriculum dropdown alone). */
export const BUILTIN_HUB_BOARDS = ['ASLI_EXCLUSIVE_SCHOOLS', 'IIT'];

/** @deprecated Prefer BUILTIN_CURRICULUM_BOARDS — kept for older imports */
export const CURRICULUM_BOARDS = [...BUILTIN_CURRICULUM_BOARDS];

/** Built-in school board codes (admin / teacher / content / exams). */
export const VALID_SCHOOL_BOARDS = [
  ...BUILTIN_HUB_BOARDS,
  ...BUILTIN_CURRICULUM_BOARDS,
];

/** Seed metadata for Board collection upsert on boot. */
export const BUILTIN_BOARD_SEED = [
  {
    code: 'ASLI_EXCLUSIVE_SCHOOLS',
    name: 'Asli Exclusive Schools',
    description: 'Asli Prep exclusive hub — curriculum + IIT tracks',
    kind: 'curriculum',
  },
  {
    code: 'IIT',
    name: 'IIT',
    description: 'IIT materials, workbooks, and EduOTT videos (Alpha / Beta / Gamma tracks)',
    kind: 'iit',
  },
  {
    code: 'CBSE',
    name: 'CBSE',
    description: 'Central Board of Secondary Education',
    kind: 'curriculum',
  },
  {
    code: 'STATE',
    name: 'State Board (generic)',
    description: 'Legacy generic state board — prefer creating Telangana / AP / etc.',
    kind: 'state',
  },
  {
    code: 'SSC',
    name: 'SSC',
    description: 'Secondary School Certificate',
    kind: 'curriculum',
  },
  {
    code: 'ICSE',
    name: 'ICSE',
    description: 'Indian Certificate of Secondary Education',
    kind: 'curriculum',
  },
  {
    code: 'IB',
    name: 'IB',
    description: 'International Baccalaureate',
    kind: 'curriculum',
  },
  {
    code: 'CAMBRIDGE',
    name: 'Cambridge',
    description: 'Cambridge International',
    kind: 'curriculum',
  },
];

/** In-memory cache of active board codes from DB (refreshed by seed / CRUD). */
let dynamicBoardCodes = new Set();
let dynamicCurriculumCodes = new Set([...BUILTIN_CURRICULUM_BOARDS]);
let dynamicDisplayNames = new Map(
  BUILTIN_BOARD_SEED.map((b) => [b.code, b.name])
);

export function setDynamicBoardCache(boards = []) {
  const codes = new Set(VALID_SCHOOL_BOARDS);
  const curriculum = new Set(BUILTIN_CURRICULUM_BOARDS);
  const names = new Map(BUILTIN_BOARD_SEED.map((b) => [b.code, b.name]));

  for (const row of boards) {
    const code = String(row?.code || '')
      .toUpperCase()
      .trim();
    if (!code) continue;
    codes.add(code);
    const kind = String(row?.kind || '').toLowerCase();
    if (kind === 'curriculum' || kind === 'state') {
      curriculum.add(code);
    }
    if (row?.name) names.set(code, String(row.name).trim());
  }

  dynamicBoardCodes = codes;
  dynamicCurriculumCodes = curriculum;
  dynamicDisplayNames = names;
}

export function getBoardDisplayName(code) {
  const key = String(code || '')
    .toUpperCase()
    .trim();
  if (!key) return '';
  return dynamicDisplayNames.get(key) || key;
}

export function isValidSchoolBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  const u = String(code).toUpperCase().trim();
  if (VALID_SCHOOL_BOARDS.includes(u)) return true;
  return dynamicBoardCodes.has(u);
}

/**
 * Normalize board codes for Subject/Content storage.
 * UI may use "IIT/NEET" or "IIT NEET"; catalog board code is "IIT".
 */
export function canonicalizeSchoolBoard(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  const u = raw.toUpperCase();
  const compact = u.replace(/[\s/\\-_]+/g, '');
  if (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE')) {
    return 'IIT';
  }
  if (compact === 'ASLIEXCLUSIVESCHOOLS' || compact === 'ASLIEXCLUSIVE') {
    return 'ASLI_EXCLUSIVE_SCHOOLS';
  }
  return u;
}

/**
 * Curriculum / state boards assignable to schools (not IIT hub, not ASLI hub alone).
 */
export function isValidCurriculumBoard(code) {
  if (code === undefined || code === null || code === '') return false;
  const u = String(code).toUpperCase().trim();
  if (u === 'ASLI_EXCLUSIVE_SCHOOLS' || u === 'IIT') return false;
  if (BUILTIN_CURRICULUM_BOARDS.includes(u)) return true;
  return dynamicCurriculumCodes.has(u);
}

/** True if `code` is a curriculum/state board stored on User.board (not Asli Prep hub). */
export function isStoredCurriculumBoard(code) {
  return isValidCurriculumBoard(code);
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
  let u = String(code ?? '')
    .toUpperCase()
    .trim();
  if (u === 'CBSC') u = 'CBSE';
  return isValidSchoolBoard(u) ? u : 'ASLI_EXCLUSIVE_SCHOOLS';
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
  const fallback = String(u.board || a?.board || '')
    .toUpperCase()
    .trim();
  return isValidCurriculumBoard(fallback) ? fallback : fallback || '';
}

/**
 * Boards to use when resolving catalog subject siblings for a school.
 * Asli Prep: ASLI hub + curriculum/state. Schools with IIT tracks also get IIT.
 */
export function boardsForSchoolContentScope({
  board,
  curriculumBoard,
  isAsliPrepExclusive,
  iitCategories,
} = {}) {
  const boards = new Set();
  const storedRaw = String(board || '')
    .toUpperCase()
    .trim();
  const stored =
    storedRaw && isValidSchoolBoard(storedRaw)
      ? normalizeSchoolBoard(storedRaw)
      : '';
  const curriculum =
    curriculumBoard && isValidCurriculumBoard(curriculumBoard)
      ? String(curriculumBoard).toUpperCase().trim()
      : '';

  if (stored) boards.add(stored);
  if (curriculum) boards.add(curriculum);

  const exclusive =
    isAsliPrepExclusive === true || stored === 'ASLI_EXCLUSIVE_SCHOOLS';
  if (exclusive) {
    boards.add('ASLI_EXCLUSIVE_SCHOOLS');
    if (curriculum) boards.add(curriculum);
  }

  const hasIitTracks =
    Array.isArray(iitCategories) &&
    iitCategories.some((c) => String(c || '').trim());
  if (exclusive && hasIitTracks) {
    boards.add('IIT');
  }

  return [...boards];
}
