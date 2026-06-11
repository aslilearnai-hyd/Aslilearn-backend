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

export function resolveValidCurriculumSubject(subject, { classNumber } = {}) {
  const isIIT6 = classNumber === 'IIT-6' || classNumber === 'Class-6-IIT';
  const validSubjectsList = isIIT6 ? IIT6_SUBJECTS : VALID_SUBJECTS;
  const subjectForLookup = normalizeCurriculumSubjectForValidation(subject);
  const normalizedSubject = validSubjectsList.find(
    (s) => s.toLowerCase() === subjectForLookup.toLowerCase(),
  );
  return { normalizedSubject, validSubjectsList, subjectForLookup };
}
