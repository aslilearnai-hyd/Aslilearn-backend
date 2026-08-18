import mongoose from 'mongoose';
import Subject from '../models/Subject.js';

/** Plain name without __deleted__ or _6 suffix (school content resolution only). */
export function extractPlainSubjectNameForContent(name) {
  const base = String(name || '').split('__deleted__')[0].trim();
  const match = base.match(/^(.+?)_\d+$/);
  return match ? match[1].trim() : base;
}

/** Group key for deduping BIO / Biology / Maths / Mathematics / Math IIT. */
const SUBJECT_GROUP_ALIASES = {
  bio: 'biology',
  bioiology: 'biology',
  biology: 'biology',
  biolo: 'biology',

  maths: 'maths',
  math: 'maths',
  mathematics: 'maths',
  mat: 'maths',
  mth: 'maths',

  english: 'english',
  eng: 'english',
  engl: 'english',

  hindi: 'hindi',
  hin: 'hindi',

  sanskrit: 'sanskrit',
  sans: 'sanskrit',

  chem: 'chemistry',
  chemistry: 'chemistry',
  che: 'chemistry',

  physics: 'physics',
  phy: 'physics',
  phys: 'physics',

  science: 'science',
  sci: 'science',
  evs: 'science',

  sst: 'social',
  social: 'social',
  'social science': 'social',
  'social studies': 'social',
  soc: 'social',
  history: 'social',
  geography: 'social',
  civics: 'social',
  economics: 'social',

  computer: 'computer',
  computers: 'computer',
  'computer science': 'computer',
  cs: 'computer',
  it: 'computer',
  ict: 'computer',
  comp: 'computer',
  'com t': 'computer',
  'com p': 'computer',

  robotics: 'robotics',
  robot: 'robotics',
  robots: 'robotics',
  robo: 'robotics',
};

/** Normalize raw label for alias lookup: "Mat- IIT", "Maths / Mathematics". */
export function normalizeSubjectLabel(name) {
  return extractPlainSubjectNameForContent(name)
    .toLowerCase()
    .replace(/[/_.]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyAliasMap(tokenOrPhrase) {
  const key = String(tokenOrPhrase || '').trim();
  if (!key) return '';
  if (SUBJECT_GROUP_ALIASES[key]) return SUBJECT_GROUP_ALIASES[key];
  const first = key.split(/\s+/)[0];
  if (first && SUBJECT_GROUP_ALIASES[first]) return SUBJECT_GROUP_ALIASES[first];
  return key;
}

/** Subject bucket for exam grading / adaptive learning (exam doc + question). */
export function resolveExamQuestionSubjectKey(question = {}, examDoc = null) {
  const fromQ = question?.subject;
  const fromExam = examDoc?.subject;
  const raw = fromQ && String(fromQ).trim() ? fromQ : fromExam;
  const key = subjectGroupKey(raw || 'general');
  return key || 'general';
}

/**
 * Group key for deduping alternate spellings.
 * IIT/NEET variants get a `_iit` suffix so Maths ≠ Maths IIT when both exist.
 */
export function subjectGroupKey(name) {
  let plain = normalizeSubjectLabel(name);
  if (!plain) return '';

  const hasIit = /\b(iit|neet)\b/.test(plain);
  plain = plain
    .replace(/\b(iit|neet)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const base = applyAliasMap(plain) || plain;
  return hasIit ? `${base}_iit` : base;
}

/** True when two labels refer to the same subject group. */
export function subjectsMatchByAlias(a, b) {
  const ka = subjectGroupKey(a);
  const kb = subjectGroupKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return normalizeSubjectLabel(a) === normalizeSubjectLabel(b);
}

/** Board + IIT siblings share a Learning Path card (maths === maths_iit). */
export function learningPathSubjectGroup(name) {
  return String(subjectGroupKey(name) || '').replace(/_iit$/, '');
}

/**
 * Keep a content row on a subject page only when its subject family matches.
 * Untagged rows stay (legacy board files); Biology IIT is dropped from Maths.
 */
export function contentRowMatchesSubjectGroup(content, seedName) {
  const seedKey = learningPathSubjectGroup(seedName);
  if (!seedKey) return true;
  const subject = content?.subject;
  const raw =
    (subject && typeof subject === 'object' && subject.name) ||
    content?.subjectName ||
    '';
  if (!String(raw).trim()) return true;
  const rowKey = learningPathSubjectGroup(raw);
  if (!rowKey) return true;
  return rowKey === seedKey;
}

/**
 * Score how well a candidate subject name matches a wanted timetable cell.
 * Higher is better; 0 = no match.
 */
export function subjectAliasMatchScore(candidateName, wantedName) {
  const want = String(wantedName || '').trim();
  const cand = String(candidateName || '').trim();
  if (!want || !cand) return 0;
  if (cand.toLowerCase() === want.toLowerCase()) return 100;

  const wantPlain = extractPlainSubjectNameForContent(want).toLowerCase();
  const candPlain = extractPlainSubjectNameForContent(cand).toLowerCase();
  if (wantPlain && candPlain && wantPlain === candPlain) return 95;

  const wk = subjectGroupKey(want);
  const ck = subjectGroupKey(cand);
  if (wk && ck && wk === ck) return 90;

  const wb = wk.replace(/_iit$/, '');
  const cb = ck.replace(/_iit$/, '');
  if (wb && cb && wb === cb) return 45;

  return 0;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize options.board / options.boards into a list of uppercase board codes.
 * Empty list means do not filter siblings by board.
 */
function normalizeBoardFilter(options = {}) {
  const fromList = Array.isArray(options.boards)
    ? options.boards.map((b) => String(b || '').toUpperCase().trim()).filter(Boolean)
    : [];
  if (fromList.length) return [...new Set(fromList)];
  if (options.board) return [String(options.board).toUpperCase().trim()].filter(Boolean);
  return [];
}

/**
 * All plain-name spellings that belong to the same subject group
 * (e.g. maths / math / mathematics).
 */
export function subjectGroupAliasNames(nameOrKey) {
  const groupKey = subjectGroupKey(nameOrKey);
  const baseKey = String(groupKey || '').replace(/_iit$/, '');
  const names = new Set([groupKey, baseKey].filter(Boolean));
  for (const [alias, key] of Object.entries(SUBJECT_GROUP_ALIASES)) {
    if (key === baseKey) {
      names.add(alias);
      if (String(groupKey).endsWith('_iit')) {
        names.add(`${alias} iit`);
        names.add(`${alias}-iit`);
      }
    }
  }
  const plain = normalizeSubjectLabel(nameOrKey);
  if (plain) names.add(plain);
  return [...names].filter(Boolean);
}

/**
 * All subject ObjectIds that share the same subject group
 * (MATHS, Mathematics, MATHS_6, Mathematics_8, …).
 * Used to query Content linked to legacy / alternate subject spellings.
 * Pass `board` (string) or `boards` (string[]) to limit sibling lookup by school boards.
 */
export async function resolveSubjectContentIds(subjectId, options = {}) {
  if (!subjectId || !mongoose.Types.ObjectId.isValid(String(subjectId))) {
    return [];
  }

  const rootOid = new mongoose.Types.ObjectId(String(subjectId));
  const subject = await Subject.findById(rootOid).select('_id name board isActive').lean();
  if (!subject) {
    return [rootOid];
  }

  const plain = extractPlainSubjectNameForContent(subject.name);
  if (!plain) {
    return [rootOid];
  }

  const aliases = subjectGroupAliasNames(plain);
  const nameOr = [];
  for (const alias of aliases) {
    const esc = escapeRegex(alias);
    nameOr.push({ name: new RegExp(`^${esc}$`, 'i') });
    nameOr.push({ name: new RegExp(`^${esc}_\\d+$`, 'i') });
  }

  const nameQuery = {
    isActive: true,
    name: { $not: /__deleted__/ },
    $or: nameOr,
  };
  const boardList = normalizeBoardFilter(options);
  if (boardList.length === 1) {
    nameQuery.board = boardList[0];
  } else if (boardList.length > 1) {
    nameQuery.board = { $in: boardList };
  }

  const siblings = await Subject.find(nameQuery).select('_id').lean();
  const idSet = new Set([String(subject._id)]);
  for (const row of siblings) {
    idSet.add(String(row._id));
  }

  return [...idSet].map((id) => new mongoose.Types.ObjectId(id));
}

/** Union of resolveSubjectContentIds for many seed ids (deduped). */
export async function resolveSubjectContentIdsMany(subjectIds, options = {}) {
  const merged = new Map();
  for (const raw of subjectIds || []) {
    const resolved = await resolveSubjectContentIds(raw, options);
    for (const oid of resolved) {
      merged.set(oid.toString(), oid);
    }
  }
  return [...merged.values()];
}

/** True when requested subject (or any sibling) is in the allowed id list. */
export async function subjectIdInResolvedScope(subjectId, allowedObjectIds, options = {}) {
  if (!allowedObjectIds?.length) return false;
  const resolved = await resolveSubjectContentIds(subjectId, options);
  const allowed = new Set(allowedObjectIds.map((id) => String(id)));
  return resolved.some((id) => allowed.has(String(id)));
}

/** True when any sibling of subjectId appears in allowed library ids. */
export async function subjectIdAllowedWithSiblings(subjectId, librarySubjectIds, options = {}) {
  const expandedLibrary = await resolveSubjectContentIdsMany(librarySubjectIds, options);
  return subjectIdInResolvedScope(subjectId, expandedLibrary, options);
}
