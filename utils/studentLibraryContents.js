import mongoose from 'mongoose';
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import {
  filterToActiveCatalogSubjectIds,
  filterContentRowsForActiveCatalog,
  buildActiveSubjectIdSet,
} from './activeCatalog.js';
import { resolveSubjectContentIdsMany } from './resolveSubjectContentIds.js';
import { resolveStudentClassNumber, filterContentsForStudentClass } from './studentClassContent.js';
import {
  getStudentSchoolProgramContext,
  applySchoolProgramContentFilters,
} from './schoolProgram.js';

/** Class-assigned subject ids (same rules as GET /api/student/content). */
export async function resolveStudentSubjectIdsForLibrary(student, studentClassDoc) {
  const idStrToOid = new Map();
  const addId = (id) => {
    if (!id) return;
    const oid =
      id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
    idStrToOid.set(oid.toString(), oid);
  };

  if (student.assignedSubjects?.length) {
    for (const subj of student.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?.assignedSubjects?.length) {
    for (const subj of studentClassDoc.assignedSubjects) {
      addId(subj._id ? subj._id : subj);
    }
  }

  if (studentClassDoc?._id) {
    const linked = await Subject.find({
      isActive: true,
      name: { $not: /__deleted__/ },
      classIds: studentClassDoc._id,
    })
      .select('_id')
      .lean();
    for (const row of linked) addId(row._id);
  }

  return Array.from(idStrToOid.values());
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

/**
 * Load active library content for a student (mirrors student content list filters).
 * @param {string} userId
 * @param {object} student
 * @param {object|null} studentClassDoc
 * @param {string} [adminBoard]
 */
export async function loadStudentLibraryContents(userId, student, studentClassDoc, adminBoard) {
  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(student, studentClassDoc);
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const boardUpper = resolveStudentContentBoard(student, adminBoard);
  const contentSubjectIds = librarySubjectIds.length
    ? await resolveSubjectContentIdsMany(librarySubjectIds, { board: boardUpper })
    : [];

  const queryIds = contentSubjectIds.length ? contentSubjectIds : librarySubjectIds;
  const activeIdSet = buildActiveSubjectIdSet(queryIds);
  const studentClassNum = resolveStudentClassNumber(student, studentClassDoc) || '';

  let contents = queryIds.length
    ? await Content.find({
        subject: { $in: queryIds },
        isActive: true,
      })
        .populate('subject', 'name isActive board')
        .sort({ updatedAt: -1 })
        .limit(600)
        .lean()
    : [];

  contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

  const programCtx = await getStudentSchoolProgramContext(userId);
  contents = applySchoolProgramContentFilters(contents, programCtx);

  contents = filterContentsForStudentClass(
    contents,
    studentClassNum || null,
    queryIds
  );

  return {
    contents,
    librarySubjectIds,
    contentSubjectIds: queryIds,
    studentClassNum,
    boardUpper,
  };
}
