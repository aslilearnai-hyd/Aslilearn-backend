import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Class from '../models/Class.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import { normalizePhoneTenDigits } from './schoolService.js';

const HEADER_ALIASES = {
  classnumb: 'classnumber',
  class: 'classnumber',
  sec: 'section',
  pwd: 'password',
};

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

function normalizeSection(raw, fallback = 'A') {
  const s = String(raw ?? '').trim();
  if (!s) return String(fallback || 'A').toUpperCase().slice(0, 1) || 'A';
  const upper = s.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return upper;
  const letter = upper.match(/\b([A-Z])\b/)?.[1];
  return letter || fallback || 'A';
}

/** Parse class number; optional section column overrides suffix parsing. */
export function parseClassAndSection(classValue, sectionColumn) {
  if (!classValue || String(classValue).trim() === '' || String(classValue).toLowerCase() === 'unassigned') {
    return { classNumber: null, section: normalizeSection(sectionColumn, 'A') };
  }

  const classStr = String(classValue).trim();
  let sectionFromClass = 'A';
  const sectionMatch = classStr.match(/[-_\s]?([A-Z])$/i);
  if (sectionMatch) {
    sectionFromClass = sectionMatch[1].toUpperCase();
  }

  const section = sectionColumn
    ? normalizeSection(sectionColumn, sectionFromClass)
    : sectionFromClass;

  let classNumber = classStr
    .replace(/^class\s*[-_]?\s*/i, '')
    .replace(/[-_\s]?[A-Z]$/i, '')
    .trim();

  if (!classNumber) {
    classNumber = classStr.replace(/[-_\s]?[A-Z]$/i, '').trim();
  }

  return { classNumber, section };
}

/** Find or create class + section for a school admin (manual add or CSV). */
export async function getOrCreateClassForAdmin(admin, adminUserId, classNumber, section) {
  if (!classNumber || String(classNumber).trim() === '' || classNumber === 'Unassigned') {
    return null;
  }

  const validAdminId = new mongoose.Types.ObjectId(String(adminUserId));
  const sectionNorm = normalizeSection(section, 'A');
  const classNum = String(classNumber).trim();

  let classDoc = await Class.findOne({
    classNumber: classNum,
    section: sectionNorm,
    assignedAdmin: validAdminId,
  });

  if (!classDoc) {
    classDoc = await Class.create({
      classNumber: classNum,
      section: sectionNorm,
      name: `Class ${classNum}-${sectionNorm}`,
      description: 'Auto-created for student',
      board: admin.board,
      school: admin.schoolName || '',
      assignedAdmin: validAdminId,
      isActive: true,
      assignedSubjects: [],
    });
  }

  return classDoc;
}

/**
 * Bulk import students from CSV/XLSX for a school admin.
 */
export async function processStudentCsvUpload(fileBuffer, originalName, adminId) {
  if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
    throw new Error('Invalid admin ID');
  }

  const admin = await User.findById(adminId).select('board schoolName role').lean();
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin not found');
  }

  if (!admin.board) {
    throw new Error(
      'Admin must have a board assigned before uploading students. Please update your school profile first.'
    );
  }

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

  if (!headers.includes('classnumber')) {
    throw new Error('Missing class header. Please include "classnumber" column');
  }

  if (!headers.includes('section')) {
    throw new Error('Missing section column. Please include "section" (e.g. A, B, C)');
  }

  const validAdminId = new mongoose.Types.ObjectId(String(adminId));
  const createdUsers = [];
  const updatedUsers = [];
  const errors = [];
  const createdClasses = new Map();

  const getOrCreateClass = async (classNumber, section) => {
    const classKey = `${classNumber}-${section}`;
    if (createdClasses.has(classKey)) {
      return createdClasses.get(classKey);
    }
    const classDoc = await getOrCreateClassForAdmin(admin, validAdminId, classNumber, section);
    if (classDoc) createdClasses.set(classKey, classDoc);
    return classDoc;
  };

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
      const plainPassword = String(row.password || '').trim();

      if (!name || !email) {
        errors.push(`Row ${i + 1}: name and email are required`);
        continue;
      }

      if (!plainPassword || plainPassword.length < 6) {
        errors.push(`Row ${i + 1}: password is required (min 6 characters)`);
        continue;
      }

      const classValue = row.classnumber || row.class || '';
      const { classNumber, section } = parseClassAndSection(classValue, row.section);

      let assignedClass = null;
      if (classNumber && classNumber !== 'Unassigned') {
        try {
          assignedClass = await getOrCreateClass(classNumber, section);
        } catch (classError) {
          errors.push(
            `Row ${i + 1}: Failed to create class ${classNumber}-${section}: ${classError.message}`
          );
          continue;
        }
        if (!assignedClass?._id) {
          errors.push(
            `Row ${i + 1}: Could not link student to class ${classNumber}-${section}`
          );
          continue;
        }
      }

      const resolvedClassNumber = assignedClass?.classNumber || classNumber || 'Unassigned';
      const resolvedSection = assignedClass?.section || section || '';
      const hashedPassword = await bcrypt.hash(plainPassword, 12);

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        const sameSchoolStudent =
          existingUser.role === 'student' &&
          existingUser.assignedAdmin &&
          String(existingUser.assignedAdmin) === String(validAdminId);

        if (sameSchoolStudent) {
          existingUser.fullName = name;
          existingUser.password = hashedPassword;
          existingUser.classNumber = resolvedClassNumber;
          existingUser.phone = normalizePhoneTenDigits(row.phone);
          existingUser.assignedClass = assignedClass?._id || existingUser.assignedClass || null;
          existingUser.board = admin.board;
          existingUser.schoolName = admin.schoolName || existingUser.schoolName || '';
          existingUser.isActive = true;
          await existingUser.save();
          updatedUsers.push({
            id: existingUser._id.toString(),
            name: existingUser.fullName,
            email: existingUser.email,
            classNumber: resolvedClassNumber,
            section: resolvedSection,
            assignedClass: assignedClass?._id ? String(assignedClass._id) : null,
            class: assignedClass
              ? `${resolvedClassNumber}-${resolvedSection}`
              : 'Unassigned',
            classLabel: assignedClass
              ? `${resolvedClassNumber}-${resolvedSection}`
              : resolvedClassNumber || 'Unassigned',
            updated: true,
          });
          continue;
        }

        let ownerHint = `a ${existingUser.role || 'user'} account`;
        if (existingUser.role === 'student' && existingUser.assignedAdmin) {
          const ownerAdmin = await User.findById(existingUser.assignedAdmin)
            .select('schoolName email')
            .lean();
          ownerHint = ownerAdmin?.schoolName
            ? `another school (${ownerAdmin.schoolName})`
            : `another school admin (${ownerAdmin?.email || existingUser.assignedAdmin})`;
        } else if (existingUser.schoolName) {
          ownerHint = `${existingUser.role} at ${existingUser.schoolName}`;
        }
        errors.push(
          `Row ${i + 1}: Email ${email} already exists on ${ownerHint}. ` +
            `Emails must be unique across the whole platform — use school-specific emails (e.g. 1139.ushodaya@student.com).`
        );
        continue;
      }

      const newUser = await User.create({
        fullName: name,
        email,
        classNumber: resolvedClassNumber,
        phone: normalizePhoneTenDigits(row.phone),
        password: hashedPassword,
        role: 'student',
        isActive: true,
        assignedAdmin: validAdminId,
        assignedClass: assignedClass?._id || null,
        board: admin.board,
        schoolName: admin.schoolName || '',
      });

      createdUsers.push({
        id: newUser._id.toString(),
        name: newUser.fullName,
        email: newUser.email,
        classNumber: resolvedClassNumber,
        section: resolvedSection,
        assignedClass: assignedClass?._id ? String(assignedClass._id) : null,
        class: assignedClass
          ? `${resolvedClassNumber}-${resolvedSection}`
          : 'Unassigned',
        classLabel: assignedClass
          ? `${resolvedClassNumber}-${resolvedSection}`
          : resolvedClassNumber || 'Unassigned',
      });
    } catch (error) {
      errors.push(`Row ${i + 1}: ${error.message}`);
    }
  }

  const classesCreated = createdClasses.size;
  const touched = createdUsers.length + updatedUsers.length;
  let message = `Created ${createdUsers.length} student(s)`;
  if (updatedUsers.length) message += `, updated ${updatedUsers.length} existing`;
  message += '.';
  if (classesCreated > 0) {
    message += ` Created or linked ${classesCreated} class section(s).`;
  }
  if (errors.length > 0) {
    message += ` ${errors.length} error(s).`;
  }

  return {
    ok: touched > 0,
    message,
    createdUsers,
    updatedUsers,
    classesCreated,
    errors: errors.length > 0 ? errors : undefined,
  };
}
