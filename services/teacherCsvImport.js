import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Subject from '../models/Subject.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import { isValidSchoolBoard, normalizeSchoolBoard } from '../constants/boards.js';
import { normalizePhoneTenDigits } from './schoolService.js';

const SCALAR_HEADER_KEYS = new Set([
  'name',
  'email',
  'password',
  'phone',
  'department',
  'departmer',
  'dept',
  'qualifications',
  'qualificatic',
  'qualification',
  'subjects',
  'subject',
]);

const HEADER_ALIASES = {
  departmer: 'department',
  dept: 'department',
  qualificatic: 'qualifications',
  qualification: 'qualifications',
};

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(cleanCsvCell(current));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(cleanCsvCell(current));
  return result;
}

export function normalizeCsvHeader(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^"|"$/g, '');
  return HEADER_ALIASES[s] || s;
}

/** Normalize phone from CSV (handles Excel scientific notation). */
export function normalizePhoneFromCsv(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  let s = String(raw).trim();
  if (/e[+-]?\d+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }
  return normalizePhoneTenDigits(s);
}

/**
 * Collect subject names from a row: "subjects" column (comma-separated) plus extra columns
 * (e.g. Mathematics in F, Physics in G with no header).
 */
export function collectSubjectNamesFromRow(headers, values) {
  const subjects = new Set();

  headers.forEach((rawHeader, idx) => {
    const h = normalizeCsvHeader(rawHeader);
    const val = String(values[idx] ?? '').trim();
    if (!val) return;

    if (h === 'subjects' || h === 'subject') {
      val.split(/[,;|]/).forEach((part) => {
        const t = part.trim();
        if (t) subjects.add(t);
      });
      return;
    }

    if (!SCALAR_HEADER_KEYS.has(h)) {
      subjects.add(val);
    }
  });

  return [...subjects];
}

/**
 * Find active subject by name + board, or create it for the school admin's board.
 */
export async function findOrCreateSubjectForBoard(subjectName, board, department = '') {
  const baseName = String(subjectName || '').trim();
  if (!baseName) return { subject: null, created: false };

  const boardNorm = normalizeSchoolBoard(board);
  const displayName = baseName.split('__deleted__')[0].trim();

  let subject = await Subject.findOne({
    board: boardNorm,
    isActive: true,
    name: { $regex: new RegExp(`^${escapeRegex(displayName)}$`, 'i') },
  });

  if (subject) {
    return { subject, created: false };
  }

  subject = await Subject.create({
    name: displayName,
    board: boardNorm,
    isActive: true,
    createdBy: 'super-admin',
    department: String(department || '').trim() || undefined,
  });

  return { subject, created: true };
}

/**
 * Process teacher CSV/XLSX buffer for a school admin.
 */
export async function processTeacherCsvUpload(fileBuffer, originalName, adminId) {
  if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
    throw new Error('Invalid admin ID');
  }

  const admin = await User.findById(adminId).select('board curriculumBoard schoolName role').lean();
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin not found');
  }

  const board =
    admin.board && isValidSchoolBoard(String(admin.board).toUpperCase())
      ? normalizeSchoolBoard(admin.board)
      : admin.curriculumBoard
        ? normalizeSchoolBoard(admin.curriculumBoard)
        : 'ASLI_EXCLUSIVE_SCHOOLS';

  let csvData;
  try {
    ({ csv: csvData } = spreadsheetBufferToCsv(fileBuffer, originalName));
  } catch (err) {
    throw new Error(`Failed to read uploaded file: ${err.message}`);
  }

  const lines = csvData.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error('File must have at least a header row and one data row');
  }

  const headers = parseCSVLine(lines[0]).map((h) => normalizeCsvHeader(h));
  const missingHeaders = ['name', 'email', 'password'].filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
  }

  const validAdminId = new mongoose.Types.ObjectId(String(adminId));
  const createdTeachers = [];
  const createdSubjects = [];
  const existingSubjects = [];
  const errors = [];
  const seenSubjectNames = new Set();

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]).map((v) => String(v).trim().replace(/^"|"$/g, ''));

      if (values.every((v) => !v)) continue;

      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? '';
      });

      const name = String(row.name || '').trim();
      const email = String(row.email || '')
        .trim()
        .toLowerCase();

      if (!name || !email) {
        errors.push(`Row ${i + 1}: name and email are required`);
        continue;
      }

      const password = String(row.password || '').trim();
      if (!password || password.length < 6) {
        errors.push(`Row ${i + 1}: password is required (minimum 6 characters)`);
        continue;
      }

      const existingTeacher = await Teacher.findOne({ email });
      if (existingTeacher) {
        errors.push(`Row ${i + 1}: Teacher with email ${email} already exists`);
        continue;
      }

      const subjectNames = collectSubjectNamesFromRow(headers, values);
      const subjectIds = [];
      const department = String(row.department || '').trim();

      for (const subjectName of subjectNames) {
        const key = `${board}::${subjectName.toLowerCase()}`;
        try {
          const { subject, created } = await findOrCreateSubjectForBoard(
            subjectName,
            board,
            department
          );
          if (!subject) continue;
          subjectIds.push(subject._id);
          if (created && !seenSubjectNames.has(key)) {
            seenSubjectNames.add(key);
            createdSubjects.push({ name: subject.name, id: subject._id.toString() });
          } else if (!created && !seenSubjectNames.has(key)) {
            seenSubjectNames.add(key);
            existingSubjects.push({ name: subject.name, id: subject._id.toString() });
          }
        } catch (subErr) {
          errors.push(`Row ${i + 1}: Subject "${subjectName}" — ${subErr.message}`);
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const newTeacher = new Teacher({
        fullName: name,
        email,
        phone: normalizePhoneFromCsv(row.phone),
        department,
        qualifications: String(row.qualifications || '').trim(),
        subjects: subjectIds,
        password: hashedPassword,
        isActive: true,
        adminId: validAdminId,
        board,
        school: admin.schoolName || '',
        role: 'teacher',
      });

      await newTeacher.save();
      createdTeachers.push({
        id: newTeacher._id.toString(),
        name: newTeacher.fullName,
        email: newTeacher.email,
        department: newTeacher.department,
        subjects: subjectIds.length,
        subjectNames: subjectNames,
      });
    } catch (error) {
      errors.push(`Row ${i + 1}: ${error.message}`);
    }
  }

  let message = `Created ${createdTeachers.length} teacher(s).`;
  if (createdSubjects.length > 0) {
    message += ` Created ${createdSubjects.length} new subject(s) on Subject Management.`;
  }
  if (existingSubjects.length > 0) {
    message += ` Linked ${existingSubjects.length} existing subject(s).`;
  }
  if (errors.length > 0) {
    message += ` ${errors.length} error(s).`;
  }

  return {
    message,
    createdTeachers,
    createdSubjects,
    existingSubjects,
    errors: errors.length > 0 ? errors : undefined,
  };
}
