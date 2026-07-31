/**
 * Resolve catalog Subject docs for individual (B2C trial) accounts.
 * School-linked users use Class.assignedSubjects / Teacher.subjects instead.
 *
 * Does NOT mutate the database — read-only resolution from signup preferences.
 */
import Subject from '../models/Subject.js';
import { boardsForSchoolContentScope } from '../constants/boards.js';
import { normalizeClassNumberLabel } from './studentClassContent.js';

const SUBJECT_ALIASES = {
  mathematics: ['maths', 'math', 'mathematics'],
  maths: ['maths', 'math', 'mathematics'],
  math: ['maths', 'math', 'mathematics'],
  science: ['science', 'evs', 'general science'],
  'social science': ['social science', 'social studies', 'sst', 'history', 'geography', 'civics'],
  english: ['english', 'english language'],
  hindi: ['hindi'],
  telugu: ['telugu'],
  physics: ['physics'],
  chemistry: ['chemistry'],
  biology: ['biology', 'life science'],
};

function plainSubjectName(name) {
  return String(name || '')
    .replace(/_\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function interestTokens(label) {
  const key = plainSubjectName(label);
  if (!key) return [];
  const aliases = SUBJECT_ALIASES[key];
  return aliases ? [...aliases] : [key];
}

export function subjectNameMatchesInterest(subjectName, interestedSubjects) {
  if (!Array.isArray(interestedSubjects) || interestedSubjects.length === 0) return true;
  const plain = plainSubjectName(subjectName);
  if (!plain) return false;
  return interestedSubjects.some((interest) => {
    const tokens = interestTokens(interest);
    return tokens.some((t) => plain === t || plain.includes(t) || t.includes(plain));
  });
}

/**
 * @param {object} account User or Teacher document with isIndividualAccount
 * @returns {Promise<object[]>} lean Subject docs
 */
export async function resolveIndividualCatalogSubjectDocs(account) {
  if (!account?.isIndividualAccount) return [];

  const classNum = normalizeClassNumberLabel(account.classNumber);
  const boardList = boardsForSchoolContentScope({
    board: account.board,
    curriculumBoard: account.curriculumBoard,
    isAsliPrepExclusive: account.isAsliPrepExclusive,
    iitCategories: account.iitCategories,
  });
  const boards = (boardList.length ? boardList : ['CBSE']).map((b) => String(b).toUpperCase());

  const query = {
    isActive: true,
    name: { $not: /__deleted__/ },
    board: { $in: boards },
  };

  if (classNum) {
    query.$and = [
      {
        $or: [
          { classNumber: classNum },
          { classNumber: `Class ${classNum}` },
          { classNumber: `Class ${classNum}`.toUpperCase() },
          { name: new RegExp(`_${classNum}$`) },
        ],
      },
    ];
  }

  let subjects = await Subject.find(query).sort({ name: 1 }).lean();

  // If board+class yielded nothing (e.g. catalog uses CBSE only), retry CBSE for that class
  if (subjects.length === 0 && classNum && !boards.includes('CBSE')) {
    subjects = await Subject.find({
      isActive: true,
      name: { $not: /__deleted__/ },
      board: 'CBSE',
      $or: [
        { classNumber: classNum },
        { classNumber: `Class ${classNum}` },
        { name: new RegExp(`_${classNum}$`) },
      ],
    })
      .sort({ name: 1 })
      .lean();
  }

  const interests = account.interestedSubjects || [];
  if (interests.length > 0) {
    const filtered = subjects.filter((s) => subjectNameMatchesInterest(s.name, interests));
    // Prefer interest filter when it matches; otherwise keep class catalog so trial users see content
    if (filtered.length > 0) subjects = filtered;
  }

  return subjects;
}

export async function resolveIndividualCatalogSubjectIds(account) {
  const docs = await resolveIndividualCatalogSubjectDocs(account);
  return docs.map((d) => d._id);
}
