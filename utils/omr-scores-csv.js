import { parse } from 'csv-parse/sync';
import { cleanCsvCell } from './csv-encoding.js';
import { spreadsheetBufferToCsv } from './spreadsheet-to-csv.js';

function normKey(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[%]/g, 'pct')
    .replace(/[^a-z0-9]+/g, '');
}

const HEADER_MAP = {
  candidateid: 'candidateId',
  candidatename: 'candidateName',
  father: 'fatherName',
  group: 'group',
  other: 'other',
  testno: 'testNo',
  test: 'testTitle',
  mathsr: 'mathsR',
  mathsw: 'mathsW',
  mathsl: 'mathsL',
  mathsmk: 'mathsMk',
  physicsr: 'physicsR',
  physicsw: 'physicsW',
  physicsl: 'physicsL',
  physicsmk: 'physicsMk',
  chemistryr: 'chemistryR',
  chemistryw: 'chemistryW',
  chemistryl: 'chemistryL',
  chemistrymk: 'chemistryMk',
  biologyr: 'biologyR',
  biologyw: 'biologyW',
  biologyl: 'biologyL',
  biologymk: 'biologyMk',
  totq: 'totalQuestions',
  attq: 'attempted',
  r: 'correct',
  w: 'wrong',
  l: 'left',
  rpct: 'rightPct',
  wpct: 'wrongPct',
  total: 'totalMarks',
  testrank: 'testRank',
  finalrank: 'finalRank',
  grouprank: 'groupRank',
  percentage: 'percentage',
};

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function subjectFrom(row, prefix) {
  return {
    r: num(row[`${prefix}R`]),
    w: num(row[`${prefix}W`]),
    l: num(row[`${prefix}L`]),
    marks: num(row[`${prefix}Mk`]),
  };
}

/** Parse "28-07-2026" style dates from OMR test titles. */
export function parseTestDateFromTitle(title) {
  const text = String(title || '');
  const m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (!m) return null;
  let d = Number(m[1]);
  let mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(utc.getTime()) ? null : utc;
}

function normalizeRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const mapped = HEADER_MAP[normKey(k)];
    if (!mapped) continue;
    out[mapped] = cleanCsvCell(v);
  }
  return out;
}

/**
 * Parse OMR Score List CSV/XLS/XLSX buffer into batch meta + row objects.
 */
export function parseOmrScoresBuffer(buffer, originalName = '') {
  let csvData;
  try {
    ({ csv: csvData } = spreadsheetBufferToCsv(buffer, originalName));
  } catch {
    csvData = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  }

  const parsed = parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const rows = [];
  const errors = [];
  let testNo = '';
  let testTitle = '';

  for (let i = 0; i < (parsed || []).length; i++) {
    const n = normalizeRow(parsed[i]);
    const candidateId = String(n.candidateId || '').trim();
    if (!candidateId) {
      errors.push({ row: i + 2, reason: 'Missing CANDIDATE ID' });
      continue;
    }
    if (!testNo && n.testNo) testNo = String(n.testNo).trim();
    if (!testTitle && n.testTitle) testTitle = String(n.testTitle).trim();

    rows.push({
      candidateId,
      candidateName: String(n.candidateName || '').trim(),
      fatherName: String(n.fatherName || '').trim(),
      group: String(n.group || '').trim(),
      other: String(n.other || '').trim(),
      maths: subjectFrom(n, 'maths'),
      physics: subjectFrom(n, 'physics'),
      chemistry: subjectFrom(n, 'chemistry'),
      biology: subjectFrom(n, 'biology'),
      totalQuestions: num(n.totalQuestions),
      attempted: num(n.attempted),
      correct: num(n.correct),
      wrong: num(n.wrong),
      left: num(n.left),
      rightPct: num(n.rightPct),
      wrongPct: num(n.wrongPct),
      totalMarks: num(n.totalMarks),
      percentage: num(n.percentage),
      testRank: n.testRank === '' || n.testRank == null ? null : num(n.testRank, null),
      finalRank: n.finalRank === '' || n.finalRank == null ? null : num(n.finalRank, null),
      groupRank: n.groupRank === '' || n.groupRank == null ? null : num(n.groupRank, null),
    });
  }

  // Dedupe by candidateId (keep last)
  const byId = new Map();
  for (const row of rows) byId.set(row.candidateId, row);
  const uniqueRows = [...byId.values()];

  return {
    testNo: testNo || '',
    testTitle: testTitle || originalName || 'OMR Results',
    testDate: parseTestDateFromTitle(testTitle),
    rows: uniqueRows,
    errors,
  };
}
