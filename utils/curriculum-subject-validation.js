import { VALID_SUBJECTS } from '../services/hardcoded-content-service.js';
import { lockBoardKey } from './board-label.js';

const IIT_TRACK_SUBJECTS = ['Physics', 'Chemistry', 'Maths', 'Biology'];

/** Curriculum dropdowns often use "Mathematics"; stored rows use "Maths". */
export function normalizeCurriculumSubjectForValidation(subject) {
  const s = String(subject || '').trim();
  if (!s) return s;
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    mathematics: 'Maths',
    math: 'Maths',
    maths: 'Maths',
    'social studies': 'Social Science',
    sst: 'Social Science',
  };
  return aliases[key] ?? s;
}

/** Match DB rows that stored legacy labels ("Mathematics", "Social Studies"). */
export function subjectFilterForDb(subjectNormalized) {
  const s = String(subjectNormalized || '').trim();
  if (s === 'Maths') {
    return { $in: ['Maths', 'Mathematics'] };
  }
  if (s === 'Social Science') {
    return { $in: ['Social Science', 'Social Studies'] };
  }
  return s;
}

export function isIIT6Class(classNumber) {
  const c = String(classNumber ?? '').trim();
  return c === 'IIT-6' || c === 'Class-6-IIT';
}

/** @deprecated alias — use isIIT6Class */
export function isIit6ClassNumber(classNumber) {
  return isIIT6Class(classNumber);
}

/** Normalized class label for AI tool lookups and API metadata. */
export function resolveClassDisplay(classNumber) {
  if (isIIT6Class(classNumber)) {
    return { isIIT6: false, classNum: 6, classDisplay: 'Class 6' };
  }
  const classNum = parseInt(String(classNumber), 10);
  const classDisplay = Number.isFinite(classNum) ? `Class ${classNum}` : String(classNumber || '');
  return { isIIT6: false, classNum, classDisplay };
}

export function usesIitTrackSubjects({ board } = {}) {
  return lockBoardKey(board) === 'IIT/NEET';
}

export function resolveValidCurriculumSubject(subject, { classNumber, board } = {}) {
  const validSubjectsList = usesIitTrackSubjects({ board, classNumber })
    ? IIT_TRACK_SUBJECTS
    : VALID_SUBJECTS;
  const subjectForLookup = normalizeCurriculumSubjectForValidation(subject);
  const normalizedSubject = validSubjectsList.find(
    (s) => s.toLowerCase() === subjectForLookup.toLowerCase(),
  );
  return { normalizedSubject, validSubjectsList, subjectForLookup };
}
