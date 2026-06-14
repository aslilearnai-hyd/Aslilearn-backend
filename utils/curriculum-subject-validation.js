import { VALID_SUBJECTS } from '../services/hardcoded-content-service.js';

const IIT6_SUBJECTS = ['Physics', 'Chemistry', 'Maths', 'Biology'];

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
  const isIIT6 = isIIT6Class(classNumber);
  const classNum = isIIT6 ? 'IIT-6' : parseInt(String(classNumber), 10);
  const classDisplay = isIIT6 ? 'IIT-6' : `Class ${classNum}`;
  return { isIIT6, classNum, classDisplay };
}

/** True when board is IIT / Asli Prep track. */
export function isIitBoard(board) {
  const b = String(board || '').trim().toUpperCase();
  return b === 'IIT' || b.includes('IIT') || b.includes('ASLI PREP');
}

/**
 * Class label stored on AiToolGeneration rows (generation + lookups must align).
 * IIT Class 6 → "IIT-6"; CBSE Class 6 → "Class 6".
 */
export function resolveStoredClassLabel(className, board) {
  const cls = String(className || '').trim();
  if (!cls) return cls;
  if (cls === 'IIT-6' || cls === 'Class-6-IIT') return 'IIT-6';
  const num = cls.match(/\d+/)?.[0];
  if (isIitBoard(board) && num === '6') return 'IIT-6';
  if (num && (cls === num || !/^class\b/i.test(cls))) return `Class ${num}`;
  return cls;
}

/**
 * Mongo filter for dashboard content lookup — IIT students query IIT-6 but legacy rows use Class 6 + board IIT.
 */
export function classLabelFilterForDb(classLabel) {
  const normalized = String(classLabel || '').trim();
  if (normalized === 'IIT-6' || normalized === 'Class-6-IIT') {
    return {
      $or: [
        { classLabel: { $in: ['IIT-6', 'Class-6-IIT'] } },
        { classLabel: 'Class 6', board: /^IIT$/i },
        { classLabel: 'Class 6', 'metadata.board': /^IIT$/i },
      ],
    };
  }
  if (normalized.startsWith('Class ')) return { classLabel: normalized };
  const num = normalized.match(/\d+/)?.[0];
  if (num) return { classLabel: `Class ${num}` };
  return { classLabel: normalized };
}

export function resolveValidCurriculumSubject(subject, { classNumber } = {}) {
  const isIIT6 = isIIT6Class(classNumber);
  const validSubjectsList = isIIT6 ? IIT6_SUBJECTS : VALID_SUBJECTS;
  const subjectForLookup = normalizeCurriculumSubjectForValidation(subject);
  const normalizedSubject = validSubjectsList.find(
    (s) => s.toLowerCase() === subjectForLookup.toLowerCase(),
  );
  return { normalizedSubject, validSubjectsList, subjectForLookup };
}
