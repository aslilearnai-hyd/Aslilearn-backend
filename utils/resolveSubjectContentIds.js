import mongoose from 'mongoose';
import Subject from '../models/Subject.js';

/** Plain name without __deleted__ or _6 suffix (school content resolution only). */
export function extractPlainSubjectNameForContent(name) {
  const base = String(name || '').split('__deleted__')[0].trim();
  const match = base.match(/^(.+?)_\d+$/);
  return match ? match[1].trim() : base;
}

/** Group key for deduping BIO / BIOIOGY / Biology_6 into one school subject row. */
const SUBJECT_GROUP_ALIASES = {
  bio: 'biology',
  bioiology: 'biology',
  biology: 'biology',
  maths: 'maths',
  math: 'maths',
  mathematics: 'maths',
  english: 'english',
  eng: 'english',
  hindi: 'hindi',
  sanskrit: 'sanskrit',
  chem: 'chemistry',
  chemistry: 'chemistry',
  physics: 'physics',
  phy: 'physics',
  science: 'science',
  sci: 'science',
  evs: 'science',
  sst: 'social',
  social: 'social',
  'social science': 'social',
  history: 'social',
  geography: 'social',
  civics: 'social',
  economics: 'social',
  computer: 'computer',
  computers: 'computer',
  cs: 'computer',
  it: 'computer',
};

/** Subject bucket for exam grading / adaptive learning (exam doc + question). */
export function resolveExamQuestionSubjectKey(question = {}, examDoc = null) {
  const fromQ = question?.subject;
  const fromExam = examDoc?.subject;
  const raw = fromQ && String(fromQ).trim() ? fromQ : fromExam;
  const key = subjectGroupKey(raw || 'general');
  return key || 'general';
}

export function subjectGroupKey(name) {
  const plain = extractPlainSubjectNameForContent(name).toLowerCase().trim();
  return SUBJECT_GROUP_ALIASES[plain] || plain;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * All subject ObjectIds that share the same plain name (MATHS, MATHS_6, MATHS_7).
 * Used to query Content linked to legacy suffixed subjects during migration.
 */
export async function resolveSubjectContentIds(subjectId, options = {}) {
  const { board } = options;
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

  const plainEscaped = escapeRegex(plain);
  const nameQuery = {
    isActive: true,
    name: { $not: /__deleted__/ },
    $or: [{ name: plain }, { name: new RegExp(`^${plainEscaped}_\\d+$`, 'i') }],
  };
  if (board) {
    nameQuery.board = String(board).toUpperCase();
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
