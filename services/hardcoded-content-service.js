// Hardcoded Content Service - Reads pre-generated content from Asli hardcoding folder
// Supports Class 6 (CSV), Class 7-10 (JSON tree), AMENITY, AMENITY-2 (IIT-6)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Base paths ────────────────────────────────────────────────────────────────
const HARDCODED_ROOT = path.join(__dirname, '../Asli hardcoding');

// ─── Constants ─────────────────────────────────────────────────────────────────
const IIT_CLASS_NAME = 'IIT-6';
const IIT_SUBJECTS = ['Physics', 'Chemistry', 'Maths', 'Biology'];

// Valid subjects exposed to the frontend (canonical names)
export const VALID_SUBJECTS = ['English', 'Hindi', 'Maths', 'Science', 'Social Science'];

// Folder name → canonical subject name  (used when listing subjects from disk)
const FOLDER_TO_SUBJECT = {
  'english': 'English',
  'hindi': 'Hindi',
  'maths': 'Maths',
  'mathematics': 'Maths',
  'science': 'Science',
  'social': 'Social Science',
  'social science': 'Social Science',
  'evs': 'EVS',
};

// Canonical subject → possible folder names on disk (tried in order)
const SUBJECT_TO_FOLDERS = {
  'English': ['English'],
  'Hindi': ['Hindi'],
  'Maths': ['Maths', 'Mathematics'],
  'Science': ['Science'],
  'Social Science': ['Social Science', 'Social'],
  'EVS': ['EVS'],
};

// ─── Tool → content-type-folder mapping (for Class 7-10 JSON tree) ─────────
// Each tool maps to one or more folder name fragments (case-insensitive match)
const TOOL_FOLDER_PATTERNS = {
  'worksheet-mcq-generator':        ['MCQs', 'MCQ'],
  'exam-question-paper-generator':  null, // special: combine multiple
  'homework-creator':               null, // special: combine multiple
  'lesson-planner':                 ['Lesson Planner'],
  'daily-class-plan-maker':         ['Lesson Planner'],
  'concept-mastery-helper':         ['CMH'],
  'flashcard-generator':            ['FlashCards', 'Flashcards', 'Flash Cards'],
  'short-notes-summaries-maker':    ['Summary and Short Notes', 'Short Notes and Summaries', 'Summaries and Short notes', 'Summaries and Short Notes'],
  'chapter-summary-creator':        ['Summary and Short Notes', 'Short Notes and Summaries', 'Summaries and Short notes', 'Summaries and Short Notes'],
  'activity-project-generator':     ['Activity & Project Generator', 'Activity and Project Generator'],
  // Story & Passage Creator folders have slightly different names across
  // subjects and classes (e.g. "Passage Related Questions", "Passages",
  // "Passage Questions", or even Hindi names). Keep this list generous and
  // rely on the case‑insensitive/contains matching in findFolder.
  'story-passage-creator':          [
    'Passage Related Questions',
    'Passage related questions',
    'Passages',
    'Passage Questions',
    'Passage',
    'गद्यांश',
    'गद्यांश आधारित प्रश्न'
  ],
  'short-answer':                   ['Short Answer Questions'],
  'long-answer':                    ['Long Answer Questions'],
  'fill-in-blanks':                 ['Fill in the Blanks', 'Fill in the blanks'],
  'true-false':                     ['True or False'],
  'match-following':                ['Match the Following', 'match the following'],
  'smart-study-guide-generator':    ['MCQs'],
  'concept-breakdown-explainer':    ['MCQs'],
  'personalized-revision-planner':  ['Lesson Planner'],
  'smart-qa-practice-generator':    ['MCQs'],
  'key-points-formula-extractor':   ['Short Answer Questions'],
  'quick-assignment-builder':       ['MCQs'],
  'very-short-answer':              ['Very Short Answer Questions'],
};

// File suffix for difficulty-based tools  (difficulty → filename prefix)
// e.g.  easy → easy_mcq.json, medium_lp.json, hard_saq.json
const TOOL_FILE_SUFFIX = {
  'worksheet-mcq-generator':        'mcq',
  'lesson-planner':                 null, // picks lp or sns
  'daily-class-plan-maker':         null,
  'concept-mastery-helper':         null, // single file (*_cmh.json)
  'flashcard-generator':            null, // single file (*_fcm.json)
  'short-notes-summaries-maker':    'sns',
  'chapter-summary-creator':        'sns',
  'activity-project-generator':     'a&g',
  'story-passage-creator':          null, // single file
  'short-answer':                   'saq',
  'long-answer':                    'laq',
  'fill-in-blanks':                 null,
  'true-false':                     null,
  'match-following':                null,
  'smart-study-guide-generator':    'mcq',
  'concept-breakdown-explainer':    'mcq',
  'personalized-revision-planner':  null,
  'smart-qa-practice-generator':    'mcq',
  'key-points-formula-extractor':   'saq',
  'quick-assignment-builder':       'mcq',
  'very-short-answer':              'vsaq',
};

// ─── File system helpers ───────────────────────────────────────────────────────

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readJSONFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return null;
  }
}

async function readCSVFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => { row[header] = values[index] || ''; });
      data.push(row);
    }
    return { headers, data };
  } catch (error) {
    console.error(`Error reading CSV file ${filePath}:`, error.message);
    return null;
  }
}

/** Case-insensitive directory entry finder. Returns the actual name on disk or null. */
async function findFolder(parentPath, targetNames) {
  if (!Array.isArray(targetNames)) targetNames = [targetNames];
  try {
    const entries = await fs.readdir(parentPath, { withFileTypes: true });
    for (const target of targetNames) {
      const tLower = target.toLowerCase();
      const match = entries.find(e => e.isDirectory() && e.name.toLowerCase() === tLower);
      if (match) return match.name;
    }
    // Partial / contains match (handles "Summary and Short Notes" vs "Summaries and Short notes")
    for (const target of targetNames) {
      const tLower = target.toLowerCase();
      const match = entries.find(e =>
        e.isDirectory() && (e.name.toLowerCase().includes(tLower) || tLower.includes(e.name.toLowerCase()))
      );
      if (match) return match.name;
    }
  } catch { /* ignore */ }
  return null;
}

/** Get all sub-directories of a path */
async function getSubDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

function classBasePath(classNumber) {
  return path.join(HARDCODED_ROOT, `Class ${classNumber}`);
}

/** Resolve the actual subject folder path on disk for a canonical subject name */
async function resolveSubjectPath(classNum, subject) {
  const base = classBasePath(classNum);
  const candidates = SUBJECT_TO_FOLDERS[subject] || [subject];
  for (const candidate of candidates) {
    const p = path.join(base, candidate);
    if (await exists(p)) return p;
  }
  return null;
}

// ─── Normalize helpers ─────────────────────────────────────────────────────────

function normStr(s) {
  if (!s) return '';
  return s.trim().toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F]+/g, ' ')
    .trim();
}

/** Check if a folder name looks like a numbered chapter: "1.Learning Together", "3 Dreams" */
function isNumberedChapter(name) {
  return /^\d+[\.\-\s]/.test(name.trim());
}

/** Extract chapter number and clean name from folder name like "1.Learning Together" */
function parseChapterFolder(name) {
  const m = name.trim().match(/^(\d+)[\.\-\s]+(.+)$/);
  if (m) return { num: parseInt(m[1], 10), name: m[2].trim(), raw: name.trim() };
  return { num: 0, name: name.trim(), raw: name.trim() };
}

// ─── Core: discover all chapters for a subject (Class 7-10) ────────────────
// The folder tree may have:
//   Subject/Chapter/...                            (simple)
//   Subject/Book/Chapter/...                       (English → Beehive, Hindi → Kritika)
//   Subject/SubSubject/Chapter/...                 (Science → Physics/Chemistry/Biology)
//   Subject/(flat) mix of chapters + books         (Social in Class 8 has flat chapters)
// We walk one or two levels deep and collect every numbered-chapter folder.

async function discoverChapters(subjectPath) {
  const chapters = []; // { num, name, raw, bookOrBranch, fullPath }
  const topEntries = await getSubDirs(subjectPath);
  
  // Folders to skip — content-type folders, writing templates, and misc
  const SKIP = new Set([
    'amenity', 'junk', 'new folder',
    // Content-type folders (should NOT be treated as books/sub-subjects)
    'cmh', 'mcqs', 'mcq', 'flashcards', 'flash cards',
    'lesson planner', 'lesson planners',
    'summary and short notes', 'short notes and summaries', 'summaries and short notes', 'summaries and short notes',
    'activity & project generator', 'activity and project generator',
    'short answer questions', 'long answer questions', 'very short answer questions',
    'passage related questions', 'passages',
    'fill in the blanks', 'true or false', 'match the following',
    // Writing template folders (present in English/Hindi)
    'diary writing', 'essay writing', 'letter writing',
    'diary writing(poem)', 'essay writing(poem)', 'letter writing(poem)',
  ]);

  for (const entry of topEntries) {
    if (SKIP.has(entry.toLowerCase())) continue;

    if (isNumberedChapter(entry)) {
      // Direct chapter under subject
      const parsed = parseChapterFolder(entry);
      chapters.push({
        ...parsed,
        bookOrBranch: null,
        fullPath: path.join(subjectPath, entry),
      });
    } else {
      // Could be a book or sub-subject (Physics, Beehive, Our Pasts - II, etc.)
      const subPath = path.join(subjectPath, entry);
      const subEntries = await getSubDirs(subPath);

      let foundChapters = false;
      for (const sub of subEntries) {
        if (SKIP.has(sub.toLowerCase())) continue;
        if (isNumberedChapter(sub)) {
          const parsed = parseChapterFolder(sub);
          chapters.push({
            ...parsed,
            bookOrBranch: entry,
            fullPath: path.join(subPath, sub),
          });
          foundChapters = true;
        } else {
          // Go one more level for double-nested (e.g. FirstFlight/FirstFlight/1.A letter)
          const subSubPath = path.join(subPath, sub);
          const subSubEntries = await getSubDirs(subSubPath);
          for (const ssub of subSubEntries) {
            if (SKIP.has(ssub.toLowerCase())) continue;
            if (isNumberedChapter(ssub)) {
              const parsed = parseChapterFolder(ssub);
              chapters.push({
                ...parsed,
                bookOrBranch: entry + ' > ' + sub,
                fullPath: path.join(subSubPath, ssub),
              });
              foundChapters = true;
            }
          }
        }
      }

      // If no numbered chapters found inside, this might itself be a standalone topic
      // (skip it – we only return numbered chapters)
    }
  }

  // Sort by book/branch, then by chapter number
  chapters.sort((a, b) => {
    const ba = a.bookOrBranch || '';
    const bb = b.bookOrBranch || '';
    if (ba !== bb) return ba.localeCompare(bb);
    return a.num - b.num;
  });

  return chapters;
}

// ─── Core: find a specific chapter folder by topic name ────────────────────
// Returns the chapter object { fullPath, bookOrBranch, ... } or null

async function findChapterByTopic(subjectPath, topic) {
  if (!topic) return null;
  const chapters = await discoverChapters(subjectPath);
  if (chapters.length === 0) return null;

  const topicNorm = normStr(topic);
  
  // 1. Exact match on chapter name
  let match = chapters.find(c => normStr(c.name) === topicNorm);
  if (match) return match;

  // 2. Exact match on raw folder name
  match = chapters.find(c => normStr(c.raw) === topicNorm);
  if (match) return match;

  // 3. Contains match (either direction)
  match = chapters.find(c => {
    const cn = normStr(c.name);
    return cn.includes(topicNorm) || topicNorm.includes(cn);
  });
  if (match) return match;

  // 4. Contains match on raw folder name
  match = chapters.find(c => {
    const rn = normStr(c.raw);
    return rn.includes(topicNorm) || topicNorm.includes(rn);
  });
  if (match) return match;

  return null;
}

// ─── Core: find content file inside a chapter folder ───────────────────────

/** Given a chapter path, find the correct content JSON file for a tool + difficulty */
async function findContentInChapter(chapterPath, toolType, difficulty = 'medium') {
  const folderPatterns = TOOL_FOLDER_PATTERNS[toolType];
  
  // Special tools that combine multiple types
  if (toolType === 'exam-question-paper-generator') {
    return await buildCombinedExam(chapterPath, difficulty);
  }
  if (toolType === 'homework-creator') {
    return await buildCombinedHomework(chapterPath, difficulty);
  }

  if (!folderPatterns) return null;

  // Find the content-type folder (case-insensitive)
  const actualFolder = await findFolder(chapterPath, folderPatterns);
  let contentFolderPath;

  if (!actualFolder) {
    console.log(`❌ Content folder not found for ${toolType} in ${chapterPath}. Tried: ${folderPatterns.join(', ')}`);

    // Fallback for Activity & Project Generator:
    // Some older Class 7‑10 folders may not have the exact
    // "Activity and Project Generator" folder name, but still
    // contain *a&g.json files directly under the chapter.
    if (toolType === 'activity-project-generator') {
      try {
        const filesAtRoot = await getFilesInDir(chapterPath);
        const aAndG = filesAtRoot.find(f =>
          f.toLowerCase().includes('_a&g.json') || f.toLowerCase().endsWith('a&g.json')
        );
        if (aAndG) {
          console.log(`✅ Fallback: using A&G file at chapter root: ${path.join(chapterPath, aAndG)}`);
          return path.join(chapterPath, aAndG);
        }
      } catch {
        // ignore and let standard null handling continue
      }
    }

    return null;
  } else {
    contentFolderPath = path.join(chapterPath, actualFolder);
  }
  const fileSuffix = TOOL_FILE_SUFFIX[toolType];

  // For single-file tools (CMH, FlashCards, Passage, Lesson Planner, etc.)
  if (!fileSuffix) {
    let files = await getFilesInDir(contentFolderPath);

    // Standard case: JSON directly inside the content folder
    let jsonFile = files.find(f => f.toLowerCase().endsWith('.json'));
    if (jsonFile) return path.join(contentFolderPath, jsonFile);

    // Some Class 7-10 subjects (e.g. English) store lesson-planner JSON
    // in sub-folders per piece (e.g. "Lesson Planner/1_1.The day the river spoke/easy_lp.json").
    // If there are no files directly in the content folder and this is a
    // lesson-planner or daily-class-plan-maker request, look one level deeper
    // and pick the first matching JSON we find.
    if ((toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker')) {
      const subDirs = await getSubDirs(contentFolderPath);
      for (const sub of subDirs) {
        const subPath = path.join(contentFolderPath, sub);
        const subFiles = await getFilesInDir(subPath);
        const subJson = subFiles.find(f => f.toLowerCase().endsWith('.json'));
        if (subJson) {
          console.log(`✅ Fallback: using nested lesson-planner file: ${path.join(subPath, subJson)}`);
          return path.join(subPath, subJson);
        }
      }
    }

    return null;
  }

  // For difficulty-based tools: try {difficulty}_{suffix}.json
  const diff = (difficulty || 'medium').toLowerCase();
  const preferredName = `${diff}_${fileSuffix}.json`;
  
  const files = await getFilesInDir(contentFolderPath);
  
  // 1. Exact match
  let found = files.find(f => f.toLowerCase() === preferredName);
  if (found) return path.join(contentFolderPath, found);

  // 2. Any file containing the suffix
  found = files.find(f => f.toLowerCase().includes(`_${fileSuffix}.json`) || f.toLowerCase().includes(`_${fileSuffix}`));
  if (found) return path.join(contentFolderPath, found);

  // 2b. For some subjects (e.g. Class 7 English), difficulty-based
  // SNS/MCQ/SAQ/LAQ files are stored inside subtopic folders under the
  // content folder. If no matching file is found at the root, look one
  // level deeper and try again there.
  if (!found) {
    const subDirs = await getSubDirs(contentFolderPath);
    for (const sub of subDirs) {
      const subPath = path.join(contentFolderPath, sub);
      const subFiles = await getFilesInDir(subPath);

      // Exact difficulty file in subfolder
      let subFound = subFiles.find(f => f.toLowerCase() === preferredName);
      if (subFound) return path.join(subPath, subFound);

      // Any *_suffix.json in subfolder
      subFound = subFiles.find(f =>
        f.toLowerCase().includes(`_${fileSuffix}.json`) || f.toLowerCase().includes(`_${fileSuffix}`),
      );
      if (subFound) return path.join(subPath, subFound);
    }
  }

  // 3. Lesson planner fallback: try _lp.json then _sns.json
  if (toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker') {
    found = files.find(f => f.toLowerCase().startsWith(diff) && f.toLowerCase().endsWith('.json'));
    if (found) return path.join(contentFolderPath, found);
    // Any json
    found = files.find(f => f.toLowerCase().endsWith('.json'));
    if (found) return path.join(contentFolderPath, found);
  }

  // 4. Fallback: any JSON file
  found = files.find(f => f.toLowerCase().endsWith('.json'));
  if (found) return path.join(contentFolderPath, found);

  return null;
}

async function getFilesInDir(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch { return []; }
}

// ─── Combined content builders (exam, homework, worksheet) ─────────────────

async function buildCombinedExam(chapterPath, difficulty = 'medium') {
  const diff = (difficulty || 'medium').toLowerCase();
  const sections = [];
  let totalQuestions = 0, totalMarks = 0, estimatedTime = 0;
  let qCounter = 1;

  const types = [
    { folders: ['MCQs', 'MCQ'], type: 'Multiple Choice Questions', marks: 1, time: 1 },
    { folders: ['Very Short Answer Questions'], type: 'Very Short Answer Questions', marks: 2, time: 2 },
    { folders: ['Short Answer Questions'], type: 'Short Answer Questions', marks: 3, time: 5 },
    { folders: ['Long Answer Questions'], type: 'Long Answer Questions', marks: 5, time: 10 },
  ];

  for (const { folders, type, marks, time } of types) {
    const actualFolder = await findFolder(chapterPath, folders);
    if (!actualFolder) continue;
    const folderPath = path.join(chapterPath, actualFolder);

    // First, look for JSON files directly inside the folder
    const rootFiles = await getFilesInDir(folderPath);
    let jsonPaths = rootFiles
      .filter(f => f.toLowerCase().endsWith('.json'))
      .map(f => path.join(folderPath, f));

    // If there are no JSON files at the root (common for Class 7 English where
    // questions are stored in subtopic folders like "1_3.Three Days to see"),
    // look one level deeper and collect JSON files from each subfolder.
    if (jsonPaths.length === 0) {
      const subDirs = await getSubDirs(folderPath);
      for (const sub of subDirs) {
        const subPath = path.join(folderPath, sub);
        const subFiles = await getFilesInDir(subPath);
        const subJsons = subFiles
          .filter(f => f.toLowerCase().endsWith('.json'))
          .map(f => path.join(subPath, f));
        jsonPaths.push(...subJsons);
      }
    }

    if (jsonPaths.length === 0) continue;

    // Filter by difficulty where possible
    let difficultyFiles = jsonPaths.filter(p =>
      path.basename(p).toLowerCase().startsWith(diff)
    );
    if (difficultyFiles.length === 0) difficultyFiles = jsonPaths;

    let sectionQuestions = [];
    for (const filePath of difficultyFiles) {
      const data = await readJSONFile(filePath);
      if (!data || !Array.isArray(data.questions)) continue;

      const qs = data.questions.map(q => ({
        ...q,
        question_number: qCounter++,
        question_type: type,
        marks: q.marks || marks,
        estimated_time: time,
      }));
      sectionQuestions.push(...qs);
    }

    if (sectionQuestions.length === 0) continue;

    const sectionMarks = sectionQuestions.reduce((s, q) => s + (q.marks || marks), 0);
    const sectionTime = sectionQuestions.length * time;

    sections.push({
      type,
      questions: sectionQuestions,
      count: sectionQuestions.length,
      total_marks: sectionMarks,
      estimated_time: sectionTime,
    });
    totalQuestions += sectionQuestions.length;
    totalMarks += sectionMarks;
    estimatedTime += sectionTime;
  }

  if (totalQuestions === 0) return null;
  return { __isCombinedExam: true, data: { content_type: 'Exam Paper', sections, total_questions: totalQuestions, total_marks: totalMarks, estimated_time: estimatedTime } };
}

async function buildCombinedHomework(chapterPath, difficulty = 'medium') {
  const diff = (difficulty || 'medium').toLowerCase();
  const sections = [];
  let totalQuestions = 0;
  let qCounter = 1;

  const types = [
    { folders: ['MCQs', 'MCQ'], type: 'MCQs' },
    { folders: ['Very Short Answer Questions'], type: 'Very Short Answer Questions' },
    { folders: ['Short Answer Questions'], type: 'Short Answer Questions' },
    { folders: ['Long Answer Questions'], type: 'Long Answer Questions' },
  ];

  for (const { folders, type } of types) {
    const actualFolder = await findFolder(chapterPath, folders);
    if (!actualFolder) continue;
    const folderPath = path.join(chapterPath, actualFolder);

    // First look for JSON files directly inside the folder
    const rootFiles = await getFilesInDir(folderPath);
    let jsonPaths = rootFiles
      .filter(f => f.toLowerCase().endsWith('.json'))
      .map(f => path.join(folderPath, f));

    // If none are found at the root (e.g. Class 7 English stores questions
    // inside subtopic folders), look one level deeper and collect JSONs.
    if (jsonPaths.length === 0) {
      const subDirs = await getSubDirs(folderPath);
      for (const sub of subDirs) {
        const subPath = path.join(folderPath, sub);
        const subFiles = await getFilesInDir(subPath);
        const subJsons = subFiles
          .filter(f => f.toLowerCase().endsWith('.json'))
          .map(f => path.join(subPath, f));
        jsonPaths.push(...subJsons);
      }
    }

    if (jsonPaths.length === 0) continue;

    // Filter by difficulty where possible
    let difficultyFiles = jsonPaths.filter(p =>
      path.basename(p).toLowerCase().startsWith(diff)
    );
    if (difficultyFiles.length === 0) difficultyFiles = jsonPaths;

    let sectionQuestions = [];
    for (const filePath of difficultyFiles) {
      const data = await readJSONFile(filePath);
      if (!data || !Array.isArray(data.questions)) continue;

      const qs = data.questions.map(q => ({
        ...q,
        question_number: qCounter++,
        question_type: type,
      }));

      sectionQuestions.push(...qs);
    }

    if (sectionQuestions.length === 0) continue;

    sections.push({ type, questions: sectionQuestions, count: sectionQuestions.length });
    totalQuestions += sectionQuestions.length;
  }

  if (totalQuestions === 0) return null;
  return { __isCombinedHomework: true, data: { content_type: 'Homework', sections, total_questions: totalQuestions } };
}

async function buildCombinedWorksheet(chapterPath, difficulty = 'medium') {
  const diff = (difficulty || 'medium').toLowerCase();
  const sections = [];
  let totalQuestions = 0;
  let qCounter = 1;

  const types = [
    { folders: ['MCQs', 'MCQ'], type: 'Multiple Choice Questions' },
    { folders: ['Fill in the Blanks', 'Fill in the blanks'], type: 'Fill in the Blanks' },
  ];

  for (const { folders, type } of types) {
    const actualFolder = await findFolder(chapterPath, folders);
    if (!actualFolder) continue;
    const folderPath = path.join(chapterPath, actualFolder);
    let files = await getFilesInDir(folderPath);

    // Class 7 English stores MCQs in sub‑folders per piece (e.g. "MCQs/1_1.The day the river spoke").
    // If there are no files directly under the MCQs folder, look one level deeper
    // and merge all *_mcq.json files for this chapter and difficulty.
    const subDirs = files.length === 0 ? await getSubDirs(folderPath) : [];

    // Helper to accumulate questions from a given directory path
    const collectFromDir = async (dirPath) => {
      const dirFiles = await getFilesInDir(dirPath);
      let fileName = dirFiles.find(f => f.toLowerCase().startsWith(diff) && f.endsWith('.json'));
      if (!fileName) fileName = dirFiles.find(f => f.endsWith('.json'));
      if (!fileName) return;

      const data = await readJSONFile(path.join(dirPath, fileName));
      if (!data || !Array.isArray(data.questions)) return;

      const sectionQuestions = data.questions.map(q => ({
        ...q,
        question_number: qCounter++,
        question_type: type,
      }));

      if (sectionQuestions.length > 0) {
        sections.push({ type, questions: sectionQuestions, count: sectionQuestions.length });
        totalQuestions += sectionQuestions.length;
      }
    };

    if (files.length > 0) {
      // Standard case: questions JSON directly inside the content folder
      await collectFromDir(folderPath);
    } else if (subDirs.length > 0) {
      // Nested case: aggregate questions from each sub‑chapter folder
      for (const sub of subDirs) {
        const subPath = path.join(folderPath, sub);
        await collectFromDir(subPath);
      }
    }
  }

  if (totalQuestions === 0) return null;
  return { __isCombinedWorksheet: true, data: { content_type: 'Worksheet', sections, total_questions: totalQuestions } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMENITY / AMENITY-2 (IIT-6) — kept mostly unchanged
// ═══════════════════════════════════════════════════════════════════════════════

function getAmenityBasePath() { return path.join(HARDCODED_ROOT, 'AMENITY'); }
function getAmenity2BasePath() { return path.join(HARDCODED_ROOT, 'AMENITY-2'); }

const AMENITY_SUBJECT_MAPPINGS = {
  'English': 'English', 'Hindi': 'Hindi',
  'Mathematics': 'Mathematics', 'Maths': 'Mathematics',
  'Science': 'Science', 'Social Science': 'Social Science',
};

const AMENITY_TOOL_PREFIXES = {
  'concept-mastery-helper': 'cmh',
  'flashcard-generator': 'fcm',
  'short-notes-summaries-maker': 'sns',
};

const AMENITY_SUBJECT_CODES = {
  'Hindi': 'h', 'Mathematics': 'm', 'Science': 's', 'Social Science': 'ss', 'English': 'e',
};

async function getAmenityContent(subject, topic, toolType) {
  const prefix = AMENITY_TOOL_PREFIXES[toolType];
  if (!prefix) return null;

  const amenitySubject = AMENITY_SUBJECT_MAPPINGS[subject] || subject;
  const amenityBase = getAmenityBasePath();

  // Derive unit number from topic
  const unitMatch = (topic || '').match(/unit[\s-]?(\d+)/i);
  let unitNum = unitMatch ? unitMatch[1] : null;

  // If topic is a chapter name, try to map it to a unit number
  if (!unitNum) {
    // Try from planner matching or default to 1
    unitNum = '1';
  }

  // Handle Hindi Unit-1 typo
  let unitFolderName = `Unit-${unitNum}`;
  if (amenitySubject === 'Hindi' && unitNum === '1') {
    unitFolderName = 'Uniit-1';
  }

  if (amenitySubject === 'English') {
    // English: AMENITY/English/Unit-X/TopicFolder/cmh_eu1-1.json
    const unitPath = path.join(amenityBase, amenitySubject, unitFolderName);
    if (!await exists(unitPath)) return null;
    const topicFolders = await getSubDirs(unitPath);
    for (const folder of topicFolders) {
      const folderPath = path.join(unitPath, folder);
      const files = await getFilesInDir(folderPath);
      const matchingFile = files.find(f =>
        f.startsWith(prefix) && f.includes(`eu${unitNum}`) && f.endsWith('.json')
      );
      if (matchingFile) return path.join(folderPath, matchingFile);
    }
    return null;
  }

  // Other subjects: files directly in Unit folder
  const subjectCode = AMENITY_SUBJECT_CODES[amenitySubject] || amenitySubject[0].toLowerCase();
  const fileName = `${prefix}_${subjectCode}u${unitNum}.json`;
  const filePath = path.join(amenityBase, amenitySubject, unitFolderName, fileName);
  if (await exists(filePath)) return filePath;
  return null;
}

// IIT-6 (AMENITY-2) helpers
async function getIIT6Content(subject, topic, toolType) {
  const normalizedSubject = IIT_SUBJECTS.find(s => s.toLowerCase() === subject.toLowerCase());
  if (!normalizedSubject || !topic) return null;

  const topicPath = path.join(getAmenity2BasePath(), normalizedSubject, topic);
  if (!await exists(topicPath)) return null;

  // Special combined tools
  if (toolType === 'homework-creator') return await buildCombinedHomework(topicPath);
  if (toolType === 'worksheet-mcq-generator') return await buildCombinedWorksheet(topicPath);
  if (toolType === 'exam-question-paper-generator') return await buildCombinedExam(topicPath);

  const suffixMap = {
    'concept-mastery-helper': '_cmh.json',
    'flashcard-generator': '_fcm.json',
    'short-notes-summaries-maker': '_sns.json',
  };
  const suffix = suffixMap[toolType];
  if (!suffix) return null;

  const files = await getFilesInDir(topicPath);
  const matchingFile = files.find(f => f.toLowerCase().endsWith(suffix.toLowerCase()));
  return matchingFile ? path.join(topicPath, matchingFile) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Class 6 CSV logic (backward compat)
// ═══════════════════════════════════════════════════════════════════════════════

const CLASS6_TOOL_MAPPINGS = {
  'lesson-planner': { folder: null, filePattern: 'planner.json', format: 'json' },
  'daily-class-plan-maker': { folder: null, filePattern: 'planner.json', format: 'json' },
  'activity-project-generator': { folder: null, filePattern: 'projects.csv', format: 'csv' },
  'story-passage-creator': { folder: null, filePattern: 'passages.csv', format: 'csv' },
  'worksheet-mcq-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'exam-question-paper-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'homework-creator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'fill-in-blanks': { folder: 'Fill in the blanks', filePattern: null, format: 'csv' },
  'short-answer': { folder: 'short answers', filePattern: null, format: 'csv' },
  'long-answer': { folder: 'long answer', filePattern: null, format: 'csv' },
  'match-following': { folder: 'match the following', filePattern: null, format: 'csv' },
  'true-false': { folder: 'true or false', filePattern: null, format: 'csv' },
  'smart-study-guide-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'concept-breakdown-explainer': { folder: 'mcq', filePattern: null, format: 'csv' },
  'personalized-revision-planner': { folder: null, filePattern: 'planner.json', format: 'json' },
  'smart-qa-practice-generator': { folder: 'mcq', filePattern: null, format: 'csv' },
  'chapter-summary-creator': { folder: null, filePattern: 'planner.json', format: 'json' },
  'key-points-formula-extractor': { folder: 'short answers', filePattern: null, format: 'csv' },
  'quick-assignment-builder': { folder: 'mcq', filePattern: null, format: 'csv' },
};

/** Resolve topic → CSV code (C1, C2, P1, etc.) via planner.json for Class 6 */
async function getTopicCodeClass6(classNum, subject, topic) {
  const subjectPath = await resolveSubjectPath(classNum, subject);
  if (!subjectPath) return null;

  // If topic already looks like C1, P2, etc.
  if (/^[CP]\d+$/i.test(topic)) return topic.toUpperCase();

  // Unit format
  const unitMatch = topic.match(/unit[\s-]?(\d+)/i);
  if (unitMatch) return `C${unitMatch[1]}`;

  // Try to find in planner.json
  const plannerPath = path.join(subjectPath, 'planner.json');
  if (await exists(plannerPath)) {
    const planner = await readJSONFile(plannerPath);
    if (planner) {
      const lessons = planner.lessons || planner.lesson_plans || [];
      for (let i = 0; i < lessons.length; i++) {
        const ln = normStr(lessons[i].lesson_name || '');
        const tn = normStr(topic);
        if (ln === tn || ln.includes(tn) || tn.includes(ln)) {
          return `C${i + 1}`;
        }
      }
    }
  }
  return null;
}

async function getClass6Content(classNum, subject, topic, toolType, params = {}) {
  const mapping = CLASS6_TOOL_MAPPINGS[toolType];
  if (!mapping) return null;

  const subjectPath = await resolveSubjectPath(classNum, subject);
  if (!subjectPath) return null;

  // Direct-file tools (planner.json, projects.csv, passages.csv)
  if (!mapping.folder) {
    let fileName = mapping.filePattern;
    // Hindi project.csv fallback
    if (toolType === 'activity-project-generator' && subject === 'Hindi') {
      if (await exists(path.join(subjectPath, 'project.csv'))) fileName = 'project.csv';
    }
    const filePath = path.join(subjectPath, fileName);
    if (!await exists(filePath)) return null;
    return mapping.format === 'json' ? await readJSONFile(filePath) : await readCSVFile(filePath);
  }

  // Folder-based tools (MCQ, Fill in blanks, etc.)
  if (!topic) return null;
  const topicCode = await getTopicCodeClass6(classNum, subject, topic);
  if (!topicCode) return null;

  const difficulty = (params.difficulty || params.questionDifficulty || 'medium').toLowerCase();
  
  // Find folder (case-insensitive)
  const actualFolder = await findFolder(subjectPath, [mapping.folder]);
  if (!actualFolder) return null;

  const fileName = `${topicCode.toLowerCase()} ${difficulty}.csv`;
  const filePath = path.join(subjectPath, actualFolder, fileName);
  if (!await exists(filePath)) return null;
  return await readCSVFile(filePath);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get available subjects for a class
 */
export async function getSubjectsForClass(classNumber) {
  if (classNumber === IIT_CLASS_NAME) {
    const base = getAmenity2BasePath();
    const dirs = await getSubDirs(base);
    const subjects = dirs.filter(d => IIT_SUBJECTS.map(s => s.toLowerCase()).includes(d.toLowerCase()));
    return subjects.length > 0 ? subjects.sort() : IIT_SUBJECTS;
  }

  const classNum = parseInt(classNumber);
  if (isNaN(classNum) || classNum < 5 || classNum > 10) return [];

  const base = classBasePath(classNum);
  if (!await exists(base)) return [];

  const dirs = await getSubDirs(base);
  const subjects = [];

  for (const dir of dirs) {
    const canonical = FOLDER_TO_SUBJECT[dir.toLowerCase()];
    if (canonical && !subjects.includes(canonical)) {
      subjects.push(canonical);
    }
  }

  return subjects.sort();
}

/**
 * Get chapters/topics for a subject
 */
export async function getChaptersForSubject(classNumber, subject) {
  // IIT-6
  if (classNumber === IIT_CLASS_NAME) {
    const normalizedSubject = IIT_SUBJECTS.find(s => s.toLowerCase() === subject.toLowerCase());
    if (!normalizedSubject) return [];
    const subjectPath = path.join(getAmenity2BasePath(), normalizedSubject);
    if (!await exists(subjectPath)) return [];
    const dirs = await getSubDirs(subjectPath);
    return dirs
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((dir, i) => ({
        chapterNumber: i + 1,
        chapterCode: dir,
        chapterName: dir,
        duration: null,
        subjectArea: null,
      }));
  }

  const classNum = parseInt(classNumber);
  if (isNaN(classNum) || classNum < 5 || classNum > 10) return [];

  // Normalize subject
  const normalizedSubject = VALID_SUBJECTS.find(s => s.toLowerCase() === subject.toLowerCase()) || subject;

  // ─── Class 7-10: JSON tree structure ──────────────────────────────────
  if (classNum >= 7) {
    const subjectPath = await resolveSubjectPath(classNum, normalizedSubject);
    if (!subjectPath) {
      console.log(`❌ Subject folder not found for Class ${classNum}, ${normalizedSubject}`);
      return [];
    }

    const chapters = await discoverChapters(subjectPath);
    console.log(`✅ Found ${chapters.length} chapters for Class ${classNum} ${normalizedSubject}`);

    return chapters.map((ch) => ({
      chapterNumber: ch.num || 0,
      chapterCode: ch.raw,
      chapterName: ch.bookOrBranch ? `${ch.name} (${ch.bookOrBranch})` : ch.name,
      duration: null,
      subjectArea: ch.bookOrBranch || null,
    }));
  }

  // ─── Class 5-6: CSV structure + planner.json ─────────────────────────
  const subjectPath = await resolveSubjectPath(classNum, normalizedSubject);
  if (!subjectPath) return [];

  const chapters = [];
  const chapterMap = new Map();

  // 1. From planner.json
  const plannerPath = path.join(subjectPath, 'planner.json');
  if (await exists(plannerPath)) {
    const planner = await readJSONFile(plannerPath);
    if (planner) {
      const lessons = planner.lessons || planner.lesson_plans || [];
      lessons.forEach((lesson, index) => {
        const code = `C${index + 1}`;
        const ch = {
          chapterNumber: index + 1,
          chapterCode: code,
          chapterName: lesson.lesson_name || `Chapter ${index + 1}`,
          duration: lesson.duration || null,
          subjectArea: lesson.subject_area || null,
        };
        chapters.push(ch);
        chapterMap.set(code, ch);
      });
    }
  }

  // 2. From CSV folder filenames (c1 easy.csv, p1 medium.csv)
  const dirs = await getSubDirs(subjectPath);
  for (const dir of dirs) {
    const folderPath = path.join(subjectPath, dir);
    const files = await getFilesInDir(folderPath);
    for (const file of files) {
      const m = file.match(/^([cp])(\d+)(\s|\.|$)/i);
      if (m) {
        const type = m[1].toUpperCase();
        const num = parseInt(m[2], 10);
        const code = `${type}${num}`;
        if (!chapterMap.has(code)) {
          const ch = {
            chapterNumber: num,
            chapterCode: code,
            chapterName: type === 'C' ? `Chapter ${num}` : `Poem ${num}`,
            duration: null,
            subjectArea: null,
          };
          chapters.push(ch);
          chapterMap.set(code, ch);
        }
      }
    }
  }

  // 3. From AMENITY folder units
  const amenityBase = getAmenityBasePath();
  const amenitySubject = AMENITY_SUBJECT_MAPPINGS[normalizedSubject] || normalizedSubject;
  const amenitySubjectPath = path.join(amenityBase, amenitySubject);
  if (await exists(amenitySubjectPath)) {
    const unitDirs = await getSubDirs(amenitySubjectPath);
    for (const ud of unitDirs) {
      const unitMatch = ud.match(/unit[\s-]?(\d+)/i);
      if (unitMatch) {
        const num = parseInt(unitMatch[1], 10);
        const code = `C${num}`;
        if (!chapterMap.has(code)) {
          const ch = {
            chapterNumber: num,
            chapterCode: code,
            chapterName: `Unit ${num}`,
            duration: null,
            subjectArea: null,
          };
          chapters.push(ch);
          chapterMap.set(code, ch);
        }
      }
    }
  }

  // Sort
  chapters.sort((a, b) => {
    const at = a.chapterCode.charAt(0);
    const bt = b.chapterCode.charAt(0);
    if (at !== bt) return at.localeCompare(bt);
    return a.chapterNumber - b.chapterNumber;
  });

  return chapters;
}

/**
 * Get hardcoded content for a specific tool
 */
export async function getHardcodedContent(classNumber, subject, topic, toolType, params = {}) {
  try {
    // IIT-6
    if (classNumber === IIT_CLASS_NAME) {
      const result = await getIIT6Content(subject, topic, toolType);
      if (!result) return null;
      if (result.__isCombinedHomework || result.__isCombinedWorksheet || result.__isCombinedExam) return result.data;
      // It's a file path string
      if (typeof result === 'string') return await readJSONFile(result);
      return result;
    }

    const classNum = parseInt(classNumber);
    if (isNaN(classNum) || classNum < 5 || classNum > 10) return null;

    // Normalize subject
    const normalizedSubject = VALID_SUBJECTS.find(s => s.toLowerCase() === subject.toLowerCase()) || subject;

    // ─── Class 7-10: JSON tree ──────────────────────────────────────────
    if (classNum >= 7) {
      return await getClass7to10Content(classNum, normalizedSubject, topic, toolType, params);
    }

    // ─── Class 5-6: CSV ─────────────────────────────────────────────────
    // First check AMENITY tools
    const amenityTools = ['concept-mastery-helper', 'flashcard-generator', 'short-notes-summaries-maker'];
    if (amenityTools.includes(toolType)) {
      const filePath = await getAmenityContent(normalizedSubject, topic, toolType);
      if (filePath && await exists(filePath)) {
        return await readJSONFile(filePath);
      }
    }

    return await getClass6Content(classNum, normalizedSubject, topic, toolType, params);
  } catch (error) {
    console.error('Error getting hardcoded content:', error);
    return null;
  }
}

/**
 * Class 7-10 content fetcher using the JSON tree structure
 */
async function getClass7to10Content(classNum, subject, topic, toolType, params = {}) {
  const subjectPath = await resolveSubjectPath(classNum, subject);
  if (!subjectPath) {
    console.log(`❌ Subject folder not found for Class ${classNum}, ${subject}`);
    return null;
  }

  const difficulty = params.difficulty || params.questionDifficulty || 'medium';

  // For tools that don't need a topic (lesson-planner can work without one)
  // But for Class 7-10 every tool needs a chapter
  if (!topic) {
    // If no topic provided for lesson-planner, grab the first chapter
    const chapters = await discoverChapters(subjectPath);
    if (chapters.length === 0) return null;
    const firstChapter = chapters[0];
    console.log(`ℹ️ No topic provided, using first chapter: ${firstChapter.raw}`);
    return await getContentForChapterPath(firstChapter.fullPath, toolType, difficulty);
  }

  // Find the chapter folder matching the topic
  const chapter = await findChapterByTopic(subjectPath, topic);
  if (!chapter) {
    console.log(`❌ Chapter not found for topic "${topic}" in ${subjectPath}`);
    return null;
  }

  console.log(`✅ Matched topic "${topic}" to chapter folder: ${chapter.raw} at ${chapter.fullPath}`);
  return await getContentForChapterPath(chapter.fullPath, toolType, difficulty);
}

/** Given a chapter folder path, get the content for a tool */
async function getContentForChapterPath(chapterPath, toolType, difficulty = 'medium') {
  // Special combined tools
  if (toolType === 'worksheet-mcq-generator') {
    const combined = await buildCombinedWorksheet(chapterPath, difficulty);
    if (combined) return combined.data;
  }
  if (toolType === 'exam-question-paper-generator') {
    const combined = await buildCombinedExam(chapterPath, difficulty);
    if (combined) return combined.data;
  }
  if (toolType === 'homework-creator') {
    const combined = await buildCombinedHomework(chapterPath, difficulty);
    if (combined) return combined.data;
  }

  // Standard single-file tools
  const filePath = await findContentInChapter(chapterPath, toolType, difficulty);
  if (!filePath) {
    console.log(`❌ No content file found for ${toolType} in ${chapterPath}`);
    return null;
  }

  console.log(`✅ Found content file: ${filePath}`);
  let data = await readJSONFile(filePath);

  // Lesson planner files in some chapters have broken easy_lp.json (non-standard whitespace).
  // If primary file fails, try other LP files in a stable preference order.
  if (!data && (toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker')) {
    try {
      const lpFolder = await findFolder(chapterPath, TOOL_FOLDER_PATTERNS['lesson-planner']);
      if (lpFolder) {
        const lpPath = path.join(chapterPath, lpFolder);
        const files = (await getFilesInDir(lpPath)).filter((f) => f.toLowerCase().endsWith('.json'));
        const preferred = [
          'medium_lp.json',
          'hard_lp.json',
          'easy_lp.json',
        ];
        const ordered = [
          ...preferred.filter((n) => files.some((f) => f.toLowerCase() === n)),
          ...files.filter((f) => !preferred.includes(f.toLowerCase())).sort((a, b) => a.localeCompare(b)),
        ];

        for (const f of ordered) {
          const p = path.join(lpPath, f);
          const parsed = await readJSONFile(p);
          if (parsed) {
            console.log(`✅ Fallback lesson planner file used: ${p}`);
            data = parsed;
            break;
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ Lesson planner fallback failed in ${chapterPath}: ${e.message}`);
    }
  }

  return data;
}

/**
 * Check if hardcoded content exists
 */
export async function hasHardcodedContent(classNumber, subject, topic, toolType) {
  const content = await getHardcodedContent(classNumber, subject, topic, toolType);
  return content !== null;
}

/**
 * Get all available content types for a topic
 */
export async function getAvailableContentForTopic(classNumber, subject, topic) {
  try {
    const classNum = parseInt(classNumber);
    if (classNumber === IIT_CLASS_NAME || (classNum >= 7 && classNum <= 10)) {
      // For Class 7-10 and IIT-6, check which content-type folders exist inside the chapter
      const results = [];
      const toolsToCheck = [
        { toolType: 'worksheet-mcq-generator', name: 'MCQ Questions' },
        { toolType: 'lesson-planner', name: 'Lesson Planner' },
        { toolType: 'concept-mastery-helper', name: 'Concept Mastery Helper' },
        { toolType: 'flashcard-generator', name: 'Flashcards' },
        { toolType: 'short-notes-summaries-maker', name: 'Short Notes & Summaries' },
        { toolType: 'activity-project-generator', name: 'Projects & Activities' },
        { toolType: 'short-answer', name: 'Short Answer Questions' },
        { toolType: 'long-answer', name: 'Long Answer Questions' },
        { toolType: 'story-passage-creator', name: 'Story & Passage Creator' },
        // Combined tools that reuse question folders
        { toolType: 'homework-creator', name: 'Homework Creator' },
        { toolType: 'exam-question-paper-generator', name: 'Exam Question Paper Generator' },
      ];

      for (const tool of toolsToCheck) {
        const hasContent = await hasHardcodedContent(classNumber, subject, topic, tool.toolType);
        if (hasContent) {
          results.push({ toolType: tool.toolType, name: tool.name, available: true });
        }
      }
      return results;
    }

    // Class 5-6
    return [];
  } catch (error) {
    console.error('Error getting available content:', error);
    return [];
  }
}

export default {
  getHardcodedContent,
  hasHardcodedContent,
  getAvailableContentForTopic,
  getChaptersForSubject,
  getSubjectsForClass,
};
