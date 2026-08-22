/**
 * Shared Mongo filters for AI Tool Data ↔ AI Tool Topics / curriculum cascade.
 * Keeps student/teacher content lookup aligned with /api/curriculum/* and ai_tool_topics.
 */

import { boardMongoMatch, lockBoardKey } from '../../utils/board-label.js';

export function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeClassId(classId) {
  const s = normalizeMatchText(classId);
  if (!s) return '';
  if (s === 'Class-6-IIT' || s === 'IIT-6') return 'Class 6';
  const match = s.match(/(\d+)/);
  if (match) return `Class ${match[1]}`;
  return s;
}

export function buildCaseInsensitiveExactFilter(value) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  return { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' };
}

/** Class label filter — same rules as curriculum + IIT legacy Class 6 rows. */
export function buildClassLabelMongoFilter(classLabel, board = '') {
  const normalized = normalizeClassId(classLabel);
  if (!normalized) return {};

  const boardKey = lockBoardKey(board);
  const isIitClass6 = boardKey === 'IIT/NEET' && normalized === 'Class 6';

  if (isIitClass6) {
    const iitBoardMatch = boardMongoMatch(board || 'IIT');
    return {
      $or: [
        { classLabel: { $in: ['IIT-6', 'Class-6-IIT'] } },
        { classLabel: 'Class 6', board: iitBoardMatch },
        { classLabel: 'Class 6', board: '' },
        { classLabel: 'Class 6', board: { $exists: false } },
      ],
    };
  }

  const digits = normalized.match(/\d+/)?.[0];
  if (!digits) return { classLabel: normalized };
  return {
    classLabel: { $in: [`Class ${digits}`, digits, `-${digits}`, normalized] },
  };
}

export function buildSubjectMongoFilter(subject, board = '') {
  const v = normalizeMatchText(subject);
  if (!v) return {};
  const lower = v.toLowerCase();
  if (lower === 'maths' || lower === 'mathematics' || lower === 'math') {
    // Case-insensitive — generations may be stored as Mathematics / Maths / MATHS
    return { subject: { $regex: '^(maths|mathematics|math)$', $options: 'i' } };
  }
  if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
    return { subject: { $regex: '^(social\\s*science|social\\s*studies|sst)$', $options: 'i' } };
  }
  // Non-IIT schools store Science; generators sometimes save Physics/Chemistry/Biology.
  const boardKey = lockBoardKey(board);
  const isScienceBranch =
    lower === 'science' ||
    lower === 'physics' ||
    lower === 'chemistry' ||
    lower === 'biology';
  if (isScienceBranch && boardKey !== 'IIT/NEET') {
    return {
      subject: { $regex: '^(science|physics|chemistry|biology)$', $options: 'i' },
    };
  }
  const exact = buildCaseInsensitiveExactFilter(v);
  return exact ? { subject: exact } : { subject: v };
}

/** Parse "Chapter 6 - Light" → { chapterNum, chapterLabel, title, full }. */
export function parseChapterPrefixedTopic(value) {
  const tn = normalizeMatchText(value);
  if (!tn) return null;
  const m = tn.match(/^chapter\s*[-–—.]?\s*(\d+)\s*[-–—:.]\s*(.+)$/i);
  if (!m?.[1] || !m?.[2]?.trim()) return null;
  const chapterNum = m[1];
  return {
    chapterNum,
    chapterLabel: `Chapter ${chapterNum}`,
    title: m[2].trim(),
    full: tn,
  };
}

/**
 * Strict topic filter for subtopic dropdowns — never matches bare "Chapter 6" or bare
 * "Light" when the user picked "Chapter 6 - Light" (prevents cross-chapter mixing).
 */
export function buildStrictTopicFieldMongoFilter(topic) {
  const tn = normalizeMatchText(topic);
  if (!tn) return { topic: '' };

  const clauses = [];
  const pushExact = (value) => {
    const filter = buildCaseInsensitiveExactFilter(value);
    if (filter) clauses.push({ topic: filter });
  };

  pushExact(tn);

  const parsed = parseChapterPrefixedTopic(tn);
  if (parsed) {
    const { chapterNum, title } = parsed;
    for (const candidate of [
      `Chapter ${chapterNum} - ${title}`,
      `Chapter-${chapterNum} - ${title}`,
      `Chapter ${chapterNum}: ${title}`,
      `${chapterNum}. ${title}`,
      `${chapterNum}) ${title}`,
    ]) {
      pushExact(candidate);
    }
  }

  if (clauses.length === 1) return clauses[0];
  if (!clauses.length) return { topic: '' };
  return { $or: clauses };
}

/** Topic variants (with/without "Label - " prefix from AI Tool Topics). */
export function buildTopicNameVariants(topic) {
  const tn = normalizeMatchText(topic);
  if (!tn) return [];
  const variants = new Set([tn]);

  const addChapterBareTitles = (value) => {
    const v = normalizeMatchText(value);
    if (!v) return;
    // "Chapter 5: Title" / "Chapter 5 - Title" / "Chapter-5 - Title"
    const chapterTitle = v.match(/^chapter\s*[-–—.]?\s*(\d+)\s*[-–—:.]\s*(.+)$/i);
    if (chapterTitle?.[2]) {
      const num = chapterTitle[1];
      const title = chapterTitle[2].trim();
      if (title) {
        variants.add(title);
        variants.add(`Chapter ${num} - ${title}`);
        variants.add(`Chapter ${num}: ${title}`);
        variants.add(`Chapter-${num} - ${title}`);
        variants.add(`Chapter ${num}`);
      }
    }
    // "5. Title" / "5) Title"
    const numbered = v.match(/^(\d+)[\.)]\s*(.+)$/);
    if (numbered?.[2]) {
      const title = numbered[2].trim();
      variants.add(title);
      variants.add(`Chapter ${numbered[1]} - ${title}`);
      variants.add(`Chapter ${numbered[1]}: ${title}`);
    }
  };

  const addDashParts = (value) => {
    const parts = String(value || '')
      .split(/\s+-\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      variants.add(part);
      addChapterBareTitles(part);
    }
    // Progressive right-hand suffixes: "A - B - C" → "B - C", "C"
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join(' - ');
      variants.add(suffix);
      addChapterBareTitles(suffix);
    }
  };

  addDashParts(tn);
  addChapterBareTitles(tn);

  // Taxonomy labels: "Science (NCERT) - Chapter 5: Life Processes"
  const withoutNcertLabel = tn.replace(/^.+?\(\s*ncert\s*\)\s*[-–—:]\s*/i, '').trim();
  if (withoutNcertLabel && withoutNcertLabel !== tn) {
    variants.add(withoutNcertLabel);
    addDashParts(withoutNcertLabel);
    addChapterBareTitles(withoutNcertLabel);
  }

  // AI Tool Topics often use "Chapter-5 - Title"; generations may store "Chapter 5 - Title".
  const chapterNormalized = tn.replace(
    /^(chapter)\s*[-–—.]?\s*(\d+)\b/i,
    (_, _c, num) => `Chapter ${num}`,
  );
  if (chapterNormalized && chapterNormalized !== tn) {
    variants.add(chapterNormalized);
    addDashParts(chapterNormalized);
    addChapterBareTitles(chapterNormalized);
  }
  const chapterHyphenated = tn.replace(
    /^(chapter)\s+(\d+)\b/i,
    (_, _c, num) => `Chapter-${num}`,
  );
  if (chapterHyphenated && chapterHyphenated !== tn) {
    variants.add(chapterHyphenated);
    addDashParts(chapterHyphenated);
    addChapterBareTitles(chapterHyphenated);
  }

  // "Book 1: Title - …" / "Book 1 Chapter 2 - …"
  const withoutBook = tn.replace(/^book\s*\d+\s*:\s*/i, '').trim();
  if (withoutBook && withoutBook !== tn) {
    variants.add(withoutBook);
    addDashParts(withoutBook);
    addChapterBareTitles(withoutBook);
  }
  const withoutBookChapter = tn.replace(/^book\s*\d+\s+/i, '').trim();
  if (withoutBookChapter && withoutBookChapter !== tn) {
    variants.add(withoutBookChapter);
    addDashParts(withoutBookChapter);
    addChapterBareTitles(withoutBookChapter);
  }

  // Strip "Chapter 5 -" / "Chapter-5 -" / "Chapter 5:" prefix → bare title
  const withoutChapter = tn
    .replace(/^chapter\s*[-–—.]?\s*\d+\s*[-–—:]\s*/i, '')
    .replace(/^chapter\s+\d+\s*[-:]\s*/i, '')
    .trim();
  if (withoutChapter && withoutChapter !== tn) {
    variants.add(withoutChapter);
    addChapterBareTitles(withoutChapter);
  }

  // "5. Title" / "5) Title"
  const numbered = tn.match(/^(\d+)[\.)]\s*(.+)$/);
  if (numbered?.[2]) {
    variants.add(numbered[2].trim());
    variants.add(`Chapter ${numbered[1]} - ${numbered[2].trim()}`);
    variants.add(`Chapter-${numbered[1]} - ${numbered[2].trim()}`);
  }

  return [...variants].map((v) => normalizeMatchText(v)).filter(Boolean);
}

/** Subtopic variants — numbered prefixes, chapter crumbs, dash suffixes. */
export function buildSubtopicNameVariants(subtopic) {
  const st = normalizeMatchText(subtopic);
  if (!st) return [];
  const variants = new Set([st]);

  const parts = st.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) variants.add(part);
  for (let i = 1; i < parts.length; i++) {
    variants.add(parts.slice(i).join(' - '));
  }

  // NCERT-style: "5.1 What Are Life Processes?" / "5.1.2 Title" / "5. Title"
  const sectionNum = st.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
  if (sectionNum?.[2]) {
    const num = sectionNum[1];
    const title = sectionNum[2].trim();
    variants.add(num);
    variants.add(title);
    variants.add(`${num} ${title}`);
    variants.add(`${num}. ${title}`);
  }

  const withoutNumber = st
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/^chapter\s+\d+\s*[-:]\s*/i, '')
    .trim();
  if (withoutNumber && withoutNumber !== st) variants.add(withoutNumber);

  // Trailing "?" is common in NCERT headings but may be omitted in stored rows
  for (const v of [...variants]) {
    const noQ = String(v || '').replace(/\?+$/g, '').trim();
    if (noQ && noQ !== v) variants.add(noQ);
  }

  return [...variants].map((v) => normalizeMatchText(v)).filter(Boolean);
}

function looseNormalize(value) {
  // Keep letters/numbers from ANY script (Latin, Devanagari, Telugu, etc.).
  // The old /[^a-z0-9]+/ strip turned Hindi/Telugu topics into "" so
  // Reading Practice / Story Passage never matched ग्रीष्म ऋतु-style titles.
  return String(value || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function looseIncludesEitherWay(a, b) {
  const x = looseNormalize(a);
  const y = looseNormalize(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** Mongo filter for AiToolGeneration.topic (or topicName on topics collection). */
export function buildTopicFieldMongoFilter(topic) {
  const variants = buildTopicNameVariants(topic);
  if (!variants.length) return { topic: '' };
  const clauses = variants
    .map((v) => {
      const exact = buildCaseInsensitiveExactFilter(v);
      return exact ? { topic: exact } : null;
    })
    .filter(Boolean);
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

export function buildSubtopicFieldMongoFilter(subtopic) {
  const variants = buildSubtopicNameVariants(subtopic);
  if (!variants.length) return { subtopic: '' };
  const clauses = variants
    .map((v) => {
      const exact = buildCaseInsensitiveExactFilter(v);
      return exact ? { subtopic: exact } : null;
    })
    .filter(Boolean);
  if (clauses.length === 1) return clauses[0];
  if (!clauses.length) return { subtopic: normalizeMatchText(subtopic) };
  return { $or: clauses };
}

/** Strict board scope (same as curriculum API). */
export function buildBoardMongoFilter(board) {
  const b = normalizeMatchText(board);
  if (!b) return {};
  return { board: boardMongoMatch(b) };
}

/**
 * Hierarchy browse board filter. IIT/NEET also includes empty-board Class 6 rows —
 * those are common for legacy / teacher saves and delivery already soft-matches them.
 */
export function buildHierarchyBoardMongoFilter(
  board,
  { boardField = 'board', classField = 'classLabel' } = {},
) {
  const raw = normalizeMatchText(board);
  if (!raw) return { [boardField]: '' };
  const locked = lockBoardKey(raw);
  const boardMatch = boardMongoMatch(raw);
  if (locked !== 'IIT/NEET') {
    return { [boardField]: boardMatch };
  }
  return {
    $or: [
      { [boardField]: boardMatch },
      {
        $and: [
          {
            $or: [
              { [boardField]: '' },
              { [boardField]: null },
              { [boardField]: { $exists: false } },
            ],
          },
          {
            [classField]: {
              $in: ['Class 6', 'IIT-6', 'Class-6-IIT', '6'],
            },
          },
        ],
      },
    ],
  };
}

export function mergeMongoFilters(...parts) {
  const clauses = parts.filter((p) => p && typeof p === 'object' && Object.keys(p).length > 0);
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/** Merge classLabel constraints onto a base Mongo filter (handles IIT-6 $or safely). */
export function applyClassLabelMongoFilter(baseFilter, classLabel, board = '') {
  const classClause = buildClassLabelMongoFilter(classLabel, board);
  if (!classClause || !Object.keys(classClause).length) {
    const normalized = normalizeClassId(classLabel);
    if (normalized) baseFilter.classLabel = normalized;
    return baseFilter;
  }
  return mergeMongoFilters(baseFilter, classClause);
}

/** Scope filter: board + class + subject (no topic/subtopic/tool). */
export function buildAiToolDataScopeFilter({ classLabel, subject, board }) {
  const normalizedClass = normalizeClassId(classLabel);
  const isIitClass6 =
    lockBoardKey(board) === 'IIT/NEET' && normalizedClass === 'Class 6';

  // IIT Class 6: classLabel filter already encodes board (incl. empty-board legacy rows).
  // Do not also AND a top-level board regex — that made empty-board Class 6 rows impossible.
  if (isIitClass6) {
    return mergeMongoFilters(
      buildClassLabelMongoFilter(classLabel, board),
      buildSubjectMongoFilter(subject, board),
    );
  }

  return mergeMongoFilters(
    buildBoardMongoFilter(board),
    buildClassLabelMongoFilter(classLabel, board),
    buildSubjectMongoFilter(subject, board),
  );
}

export function topicTextMatches(stored, queried) {
  const variants = buildTopicNameVariants(queried);
  const storedLoose = looseNormalize(stored);
  const queriedLoose = looseNormalize(queried);
  // Indic / empty-after-strip: fall back to NFC exact compare
  if (!storedLoose && !queriedLoose) {
    return normalizeMatchText(stored) === normalizeMatchText(queried);
  }
  if (!storedLoose) return !normalizeMatchText(queried);
  if (queriedLoose && (storedLoose === queriedLoose || storedLoose.includes(queriedLoose) || queriedLoose.includes(storedLoose))) {
    return true;
  }
  return variants.some((v) => {
    const q = looseNormalize(v);
    if (!q) {
      const vn = normalizeMatchText(v);
      const sn = normalizeMatchText(stored);
      return Boolean(vn) && (sn === vn || sn.includes(vn) || vn.includes(sn));
    }
    return storedLoose === q || storedLoose.includes(q) || q.includes(storedLoose);
  });
}

export function subtopicTextMatches(stored, queried) {
  const variants = buildSubtopicNameVariants(queried);
  const storedNorm = looseNormalize(stored);
  const queriedLoose = looseNormalize(queried);
  if (!storedNorm && !queriedLoose) {
    return normalizeMatchText(stored) === normalizeMatchText(queried);
  }
  if (!storedNorm) return !normalizeMatchText(queried);
  if (queriedLoose && (storedNorm === queriedLoose || storedNorm.includes(queriedLoose) || queriedLoose.includes(storedNorm))) {
    return true;
  }
  return variants.some((v) => {
    const q = looseNormalize(v);
    if (!q) {
      const vn = normalizeMatchText(v);
      const sn = normalizeMatchText(stored);
      return Boolean(vn) && (sn === vn || sn.includes(vn) || vn.includes(sn));
    }
    return storedNorm === q || storedNorm.includes(q) || q.includes(storedNorm);
  });
}

export function resolveLookupBoard(board, classLabel) {
  const b = normalizeMatchText(board);
  if (b) return b;
  if (normalizeClassId(classLabel) === 'Class 6') return 'IIT';
  return '';
}
