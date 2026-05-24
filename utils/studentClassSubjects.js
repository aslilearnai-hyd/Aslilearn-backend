/**
 * Shared student class + subject resolution (used by dashboard bootstrap and routes).
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Subject from '../models/Subject.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import { filterToActiveCatalogSubjectIds } from './activeCatalog.js';
import { resolveStudentSubjectIdsForLibrary } from './studentLibraryContents.js';
import { resolveStudentClassNumber, filterContentsForStudentClass } from './studentClassContent.js';

export async function resolveStudentClassDoc(student) {
  const Class = (await import('../models/Class.js')).default;
  if (student.assignedClass) {
    if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
      if (student.assignedClass.assignedSubjects !== undefined) {
        return student.assignedClass;
      }
      return Class.findById(student.assignedClass._id).populate('assignedSubjects');
    }
    return Class.findById(student.assignedClass).populate('assignedSubjects');
  }
  const aid = student.assignedAdmin?._id || student.assignedAdmin;
  if (student.classNumber && student.classNumber !== 'Unassigned' && aid) {
    return Class.findOne({
      classNumber: student.classNumber,
      assignedAdmin: aid,
      isActive: true,
    }).populate('assignedSubjects');
  }
  return null;
}

/** @param {import('../models/User.js').default} student */
export async function resolveStudentClassSubjects(student) {
  const studentClassDoc = await resolveStudentClassDoc(student);
  const adminBoard =
    student.assignedAdmin?.board ||
    (student.assignedAdmin
      ? (await User.findById(student.assignedAdmin).select('board').lean())?.board
      : null) ||
    student.board;

  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
    student,
    adminBoard,
    studentClassDoc,
  );
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const subjects =
    librarySubjectIds.length === 0
      ? []
      : await Subject.find({
          _id: { $in: librarySubjectIds },
          isActive: true,
          name: { $not: /__deleted__/ },
        })
          .sort({ name: 1 })
          .lean();

  return {
    subjects,
    librarySubjectIds,
    studentClassDoc,
    studentClassNumber: resolveStudentClassNumber(student, studentClassDoc),
    adminBoard,
    filterContentsForStudentClass,
  };
}

export function resolveStudentContentBoard(student, adminBoard) {
  const display = resolveUserDisplayBoard(student, student?.assignedAdmin);
  if (display && String(display).toUpperCase() !== 'ASLI_EXCLUSIVE_SCHOOLS') {
    return String(display).toUpperCase();
  }
  const raw = adminBoard ? String(adminBoard).toUpperCase() : '';
  if (raw && raw !== 'ASLI_EXCLUSIVE_SCHOOLS') return raw;
  return 'CBSE';
}
