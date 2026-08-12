/**
 * Learning Path subject list: merge BIO/Biology and IIT-track siblings (catalog only).
 */
import { normalizeSchoolBoard } from '../constants/boards.js';
import {
  extractPlainSubjectNameForContent,
  subjectGroupKey,
} from './resolveSubjectContentIds.js';

export function isIitLearningPathSubject(subject = {}) {
  const cat = String(subject.productCategory || '')
    .trim()
    .toUpperCase();
  if (cat && cat !== 'GENERAL' && cat !== 'NONE' && cat !== 'ALL') return true;
  const board = normalizeSchoolBoard(subject.board || '');
  if (board === 'IIT') return true;
  const name = String(subject.name || '');
  if (/\b(iit|neet|jee)\b/i.test(name)) return true;
  return false;
}

/** Display label for LP cards (BIO → Biology, Chemistry_8 → Chemistry). */
export function learningPathDisplayName(name) {
  const plain = extractPlainSubjectNameForContent(name || '').trim();
  if (!plain) return String(name || '').trim() || 'Subject';
  const lower = plain.toLowerCase().replace(/\b(iit|neet|jee)\b/g, '').replace(/\s+/g, ' ').trim();
  const aliases = {
    bio: 'Biology',
    biology: 'Biology',
    chem: 'Chemistry',
    chemistry: 'Chemistry',
    phy: 'Physics',
    physics: 'Physics',
    math: 'Mathematics',
    maths: 'Mathematics',
    mathematics: 'Mathematics',
    eng: 'English',
    english: 'English',
    sci: 'Science',
    science: 'Science',
  };
  if (aliases[lower]) return aliases[lower];
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function groupKeyForLearningPath(subject) {
  const key = subjectGroupKey(subject?.name || '');
  return key.replace(/_iit$/, '') || normalizeSchoolBoard(subject?.board || '') || 'subject';
}

function preferSubject(a, b) {
  const score = (s) => {
    let n = 0;
    n += Number(s.contentCount || 0) * 10;
    const name = String(s.name || '');
    if (!/_\d+$/.test(name.split('__deleted__')[0])) n += 5;
    if (name.length > String(b?.name || '').length) n += 1;
    if (/^(biology|chemistry|physics|mathematics|english|science)$/i.test(
      extractPlainSubjectNameForContent(name),
    )) {
      n += 3;
    }
    n += Number(s.teacherCount || 0);
    return n;
  };
  return score(a) >= score(b) ? a : b;
}

/**
 * Merge alias / IIT-track siblings for Learning Paths browse (catalog subjects only).
 * @param {Array<object>} subjects
 * @returns {Array<object>}
 */
export function prepareLearningPathSubjects(subjects) {
  const list = Array.isArray(subjects) ? subjects.filter(Boolean) : [];
  const byKey = new Map();

  for (const row of list) {
    const rowIsIit = isIitLearningPathSubject(row);
    const key = groupKeyForLearningPath(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...row,
        name: learningPathDisplayName(row.name),
        description: row.description || `Content for ${learningPathDisplayName(row.name)}`,
        mergedSubjectIds: [String(row._id || row.id || '')].filter(Boolean),
        hasIitTrack: rowIsIit,
      });
      continue;
    }

    const winner =
      isIitLearningPathSubject(existing) && !rowIsIit
        ? row
        : !isIitLearningPathSubject(existing) && rowIsIit
          ? existing
          : preferSubject(existing, {
              ...row,
              name: learningPathDisplayName(row.name),
            });
    const mergedIds = new Set([
      ...(existing.mergedSubjectIds || [String(existing._id || existing.id || '')]),
      String(row._id || row.id || ''),
      ...(row.mergedSubjectIds || []),
    ].filter(Boolean));

    const teachers = [
      ...(Array.isArray(existing.teachers) ? existing.teachers : []),
      ...(Array.isArray(row.teachers) ? row.teachers : []),
    ];
    const teacherIds = new Set();
    const uniqueTeachers = teachers.filter((t) => {
      const id = String(t?._id || t?.id || t?.email || '');
      if (!id || teacherIds.has(id)) return false;
      teacherIds.add(id);
      return true;
    });

    byKey.set(key, {
      ...winner,
      name: learningPathDisplayName(winner.name || row.name),
      description:
        winner.description ||
        row.description ||
        `Content for ${learningPathDisplayName(winner.name || row.name)}`,
      contentCount: Number(existing.contentCount || 0) + Number(row.contentCount || 0),
      teacherCount: uniqueTeachers.length || Math.max(
        Number(existing.teacherCount || 0),
        Number(row.teacherCount || 0),
      ),
      teachers: uniqueTeachers,
      mergedSubjectIds: Array.from(mergedIds),
      hasIitTrack: Boolean(existing.hasIitTrack || rowIsIit),
      videos: [...(existing.videos || []), ...(row.videos || [])],
      quizzes: [...(existing.quizzes || []), ...(row.quizzes || [])],
      assessments: [...(existing.assessments || []), ...(row.assessments || [])],
      totalContent:
        Number(existing.totalContent || 0) + Number(row.totalContent || 0) ||
        undefined,
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
  );
}
