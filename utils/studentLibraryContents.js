import mongoose from 'mongoose';
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';
import User from '../models/User.js';
import { resolveUserDisplayBoard, boardsForSchoolContentScope } from '../constants/boards.js';
import {
  filterToActiveCatalogSubjectIds,
  filterContentRowsForActiveCatalog,
  buildActiveSubjectIdSet,
} from './activeCatalog.js';
import { resolveSubjectContentIdsMany } from './resolveSubjectContentIds.js';
import {
  normalizeClassNumberLabel,
  resolveStudentClassNumber,
  filterContentsForStudentClass,
} from './studentClassContent.js';
import {
  getStudentSchoolProgramContext,
  applySchoolProgramContentFilters,
  resolveIsAsliPrepExclusive,
} from './schoolProgram.js';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Subject IDs for a student library / learning paths.
 * Includes class assignedSubjects when present, plus the full school catalog for
 * that class number (so admins do not need "Assign Subjects to Class").
 */
export async function resolveStudentSubjectIdsForLibrary(student, studentClassDoc) {
  const idStrToOid = new Map();
  const addId = (id) => {
    if (!id) return;
    try {
      const oid =
        id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
      idStrToOid.set(oid.toString(), oid);
    } catch {
      /* ignore invalid ids */
    }
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

  // Auto-include Super Admin catalog subjects for this student's class number.
  const classNum = normalizeClassNumberLabel(
    resolveStudentClassNumber(student, studentClassDoc) ||
      studentClassDoc?.classNumber ||
      student?.classNumber ||
      student?.assignedClass?.classNumber ||
      '',
  );

  if (classNum) {
    let adminDoc = null;
    if (student?.assignedAdmin && typeof student.assignedAdmin === 'object') {
      adminDoc = student.assignedAdmin;
    } else if (student?.assignedAdmin) {
      adminDoc = await User.findById(student.assignedAdmin)
        .select('board curriculumBoard isAsliPrepExclusive iitCategories iitCategoriesByClass')
        .lean();
    }

    const isAsliPrepExclusive = resolveIsAsliPrepExclusive(student, adminDoc);
    const curriculumBoard =
      adminDoc?.curriculumBoard ||
      student?.curriculumBoard ||
      resolveUserDisplayBoard(student, adminDoc) ||
      'CBSE';
    const iitCategories = Array.isArray(adminDoc?.iitCategories) ? adminDoc.iitCategories : [];
    const boards = boardsForSchoolContentScope({
      board: adminDoc?.board || student?.board,
      curriculumBoard,
      isAsliPrepExclusive,
      iitCategories,
      excludeIitBoard: false,
    });

    const classQuery = {
      isActive: true,
      name: { $not: /__deleted__/ },
      $or: [
        { classNumber: classNum },
        { classNumber: `Class ${classNum}` },
        { classNumber: `Class ${classNum}`.toUpperCase() },
        { name: new RegExp(`_${escapeRegex(classNum)}$`) },
      ],
    };
    if (boards.length > 0) {
      classQuery.board = { $in: boards };
    }

    const catalogRows = await Subject.find(classQuery).select('_id').lean();
    for (const row of catalogRows) addId(row._id);
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
export async function loadStudentLibraryContents(userId, student, studentClassDoc, adminBoard, options = {}) {
  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(student, studentClassDoc);
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const programCtx = { ...await getStudentSchoolProgramContext(userId), surface: options.surface };
  const { resolveIitCategoriesForContentBrowse } = await import('./schoolProgram.js');
  const iitCategories = resolveIitCategoriesForContentBrowse(programCtx);
  programCtx.iitCategories = iitCategories;
  const studentClassNum = resolveStudentClassNumber(student, studentClassDoc) || '';

  if (programCtx.isAsliPrepExclusive && iitCategories.length) {
    const { mergeIitCatalogSubjectsIntoLibraryIds } = await import('./iitCatalogSubjects.js');
    librarySubjectIds = await mergeIitCatalogSubjectsIntoLibraryIds(
      librarySubjectIds,
      studentClassNum || student?.classNumber,
      { iitCategories },
    );
    librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);
  }

  const boardUpper = resolveStudentContentBoard(student, adminBoard);
  const { boardsForSchoolContentScope } = await import('../constants/boards.js');
  const schoolBoards = boardsForSchoolContentScope({
    board: adminBoard,
    curriculumBoard: programCtx.curriculumBoard || boardUpper,
    isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
    iitCategories,
    excludeIitBoard: false,
  });
  const siblingBoardOpts = schoolBoards.length
    ? { boards: schoolBoards }
    : { board: boardUpper };

  const contentSubjectIds = librarySubjectIds.length
    ? await resolveSubjectContentIdsMany(librarySubjectIds, siblingBoardOpts)
    : [];

  const queryIds = contentSubjectIds.length ? contentSubjectIds : librarySubjectIds;
  const activeIdSet = buildActiveSubjectIdSet(queryIds);

  let contents = queryIds.length
    ? await Content.find({
        subject: { $in: queryIds },
        isActive: true,
        ...(options.type ? { type: options.type } : {}),
      })
        .select(
          'title description type board productCategory subject classNumber topic chapter module date fileUrl fileUrls thumbnailUrl duration size isExclusive createdBy deadline isActive createdAt updatedAt',
        )
        .populate('subject', 'name isActive board classNumber productCategory')
        .sort({ updatedAt: -1 })
        .limit(options.allMatching ? 0 : 600)
        .lean()
    : [];

  contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

  contents = applySchoolProgramContentFilters(contents, programCtx);

  contents = filterContentsForStudentClass(
    contents,
    studentClassNum || null,
    librarySubjectIds,
  );

  return {
    contents,
    librarySubjectIds,
    contentSubjectIds: queryIds,
    studentClassNum,
    boardUpper,
    programCtx,
  };
}
