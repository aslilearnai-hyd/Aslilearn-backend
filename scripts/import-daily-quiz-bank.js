/**
 * Import AsliLearn Daily Quiz bank (Classes 6–10) from Excel into IQRankQuestion,
 * and ensure one daily IQRankQuiz shell per class for school + trial members.
 *
 * Usage (from backend/):
 *   node scripts/import-daily-quiz-bank.js
 *   node scripts/import-daily-quiz-bank.js --file "C:/path/to/file.xlsx"
 */

import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import { loadEnv } from '../bootstrap/env.js';
import Subject from '../models/Subject.js';
import IQRankQuestion from '../models/IQRankQuestion.js';
import IQRankQuiz from '../models/IQRankQuiz.js';
import {
  DAILY_QUIZ_BANK_SOURCE,
  DAILY_PICK_COUNT,
} from '../services/daily-quiz-service.js';

// Windows / some ISPs break mongodb+srv SRV lookups (querySrv ECONNREFUSED).
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  /* ignore */
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();

const DEFAULT_FILE = path.join(
  __dirname,
  '../data/AsliLearn_Daily_Quiz_Question_Bank_Expanded_5000_QA.xlsx'
);

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function normalizeClass(raw) {
  const m = String(raw || '').match(/(\d{1,2})/);
  return m ? m[1] : '';
}

function mapDifficulty(raw) {
  const d = String(raw || '').trim().toLowerCase();
  if (d === 'easy') return 'easy';
  if (d === 'hard' || d === 'expert') return d === 'expert' ? 'expert' : 'hard';
  return 'medium';
}

function letterToIndex(letter) {
  const L = String(letter || '').trim().toUpperCase();
  if (L === 'A') return 0;
  if (L === 'B') return 1;
  if (L === 'C') return 2;
  if (L === 'D') return 3;
  return -1;
}

async function ensureDailySubject() {
  let subject = await Subject.findOne({
    code: 'DAILY_QUIZ',
    board: 'ASLI_EXCLUSIVE_SCHOOLS',
  });
  if (subject) return subject;

  subject = await Subject.findOne({
    name: 'Daily Quiz',
    board: 'ASLI_EXCLUSIVE_SCHOOLS',
  });
  if (subject) {
    if (!subject.code) {
      subject.code = 'DAILY_QUIZ';
      await subject.save();
    }
    return subject;
  }

  subject = await Subject.create({
    name: 'Daily Quiz',
    code: 'DAILY_QUIZ',
    board: 'ASLI_EXCLUSIVE_SCHOOLS',
    description: 'Platform daily quiz question bank (IQ, reasoning, vocab, STEM)',
    createdBy: 'super-admin',
    isActive: true,
  });
  return subject;
}

async function ensureDailyQuizShell({ classNumber, subjectId }) {
  const title = `Daily Quiz · Class ${classNumber}`;
  const existing = await IQRankQuiz.findOne({
    classNumber: String(classNumber),
    questionBankSource: DAILY_QUIZ_BANK_SOURCE,
  });
  if (existing) {
    existing.title = title;
    existing.subject = subjectId;
    existing.activityType = 'daily';
    existing.scheduleType = 'daily';
    existing.audienceType = 'all_members';
    existing.audienceRoles = ['student'];
    existing.trialOnly = false;
    existing.promptOnLogin = false;
    existing.isActive = true;
    existing.dailyPickCount = DAILY_PICK_COUNT;
    existing.difficulty = 'medium';
    existing.totalQuestions = DAILY_PICK_COUNT;
    existing.description =
      'Every day you get 5 fresh questions for your class. School students and trial members both receive today’s set.';
    await existing.save();
    return existing;
  }

  return IQRankQuiz.create({
    title,
    description:
      'Every day you get 5 fresh questions for your class. School students and trial members both receive today’s set.',
    subject: subjectId,
    classNumber: String(classNumber),
    board: 'ASLI_EXCLUSIVE_SCHOOLS',
    difficulty: 'medium',
    questions: [],
    totalQuestions: DAILY_PICK_COUNT,
    isActive: true,
    activityType: 'daily',
    scheduleType: 'daily',
    audienceType: 'all_members',
    audienceRoles: ['student'],
    trialOnly: false,
    promptOnLogin: false,
    questionBankSource: DAILY_QUIZ_BANK_SOURCE,
    dailyPickCount: DAILY_PICK_COUNT,
    points: 100,
    durationMinutes: 10,
    generatedBy: 'super-admin',
  });
}

/** Separate trial login prompt quiz (same bank) so trial users see it after login. */
async function ensureTrialDailyPromptShell({ classNumber, subjectId }) {
  // Deprecated: all_members daily shells already cover trial + school.
  // Keep any old trial shells inactive so students do not see duplicates.
  await IQRankQuiz.updateMany(
    {
      classNumber: String(classNumber),
      questionBankSource: DAILY_QUIZ_BANK_SOURCE,
      trialOnly: true,
    },
    { $set: { isActive: false, promptOnLogin: false } }
  );
  return null;
}

async function main() {
  const filePath = path.resolve(argValue('--file') || DEFAULT_FILE);
  if (!fs.existsSync(filePath)) {
    console.error('Excel file not found:', filePath);
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI missing');
    process.exit(1);
  }

  console.log('Reading', filePath);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets['Question Bank'];
  if (!sheet) {
    console.error('Missing sheet: Question Bank');
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  console.log('Rows in Question Bank:', rows.length);

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    family: 4,
  });
  console.log('Mongo connected');

  const subject = await ensureDailySubject();
  console.log('Subject:', subject.name, String(subject._id));

  let upserted = 0;
  let skipped = 0;
  const classSet = new Set();

  for (const row of rows) {
    const sourceId = String(row.Q_ID || '').trim();
    const classNumber = normalizeClass(row.Class);
    const questionText = String(row.Question || '').trim();
    if (!sourceId || !classNumber || !questionText) {
      skipped += 1;
      continue;
    }
    if (!['6', '7', '8', '9', '10'].includes(classNumber)) {
      skipped += 1;
      continue;
    }
    if (String(row.Active || 'Yes').trim().toLowerCase() === 'no') {
      skipped += 1;
      continue;
    }

    const optionsRaw = [
      String(row.Option_A || '').trim(),
      String(row.Option_B || '').trim(),
      String(row.Option_C || '').trim(),
      String(row.Option_D || '').trim(),
    ];
    if (optionsRaw.some((o) => !o)) {
      skipped += 1;
      continue;
    }

    const correctIdx = letterToIndex(row.Correct_Answer);
    if (correctIdx < 0) {
      skipped += 1;
      continue;
    }

    const options = optionsRaw.map((text, i) => ({
      text,
      isCorrect: i === correctIdx,
    }));
    const correctAnswer = optionsRaw[correctIdx];
    const tags = String(row.Tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await IQRankQuestion.findOneAndUpdate(
      { sourceId },
      {
        $set: {
          sourceId,
          questionText,
          questionType: 'mcq',
          options,
          correctAnswer,
          explanation: String(row.Explanation || '').trim(),
          difficulty: mapDifficulty(row.Difficulty),
          subject: subject._id,
          classNumber,
          board: 'ASLI_EXCLUSIVE_SCHOOLS',
          category: String(row.Category || '').trim(),
          subcategory: String(row.Subcategory || '').trim(),
          tags,
          bankSource: DAILY_QUIZ_BANK_SOURCE,
          points: 1,
          isActive: true,
          generatedBy: 'super-admin',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;
    classSet.add(classNumber);
    if (upserted % 500 === 0) console.log('… upserted', upserted);
  }

  console.log('Questions upserted:', upserted, 'skipped:', skipped);

  for (const classNumber of [...classSet].sort((a, b) => Number(a) - Number(b))) {
    const shell = await ensureDailyQuizShell({ classNumber, subjectId: subject._id });
    await ensureTrialDailyPromptShell({ classNumber, subjectId: subject._id });
    console.log('Daily quiz shell class', classNumber, String(shell._id));
  }

  const bankCount = await IQRankQuestion.countDocuments({ bankSource: DAILY_QUIZ_BANK_SOURCE });
  console.log('Total bank questions in DB:', bankCount);
  await mongoose.disconnect();
  console.log('Done');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
