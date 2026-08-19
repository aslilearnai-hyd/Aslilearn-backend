import Content from '../models/Content.js';
import { boardsForSchoolContentScope } from '../constants/boards.js';
import { getExplicitTeacherSubjectObjectIds } from './teacherSubjectScope.js';
import { resolveSubjectContentIdsMany } from './resolveSubjectContentIds.js';
import {
  applySchoolProgramContentFilters,
  isIitTrackVideo,
} from './schoolProgram.js';

/**
 * Count catalog videos a teacher can actually open:
 * Learning Paths (board) + EduOTT (IIT), after school-program filters.
 */
export async function countTeacherLearningAndIitVideos(teacher, programCtx, extraClassNumbers = []) {
  const empty = { total: 0, learningPath: 0, iit: 0 };
  if (!teacher) return empty;

  let librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
  if (librarySubjectIds.length === 0) {
    const { getEffectiveTeacherSubjectObjectIds } = await import('./teacherSubjectScope.js');
    librarySubjectIds = await getEffectiveTeacherSubjectObjectIds(teacher);
  }
  if (librarySubjectIds.length === 0 && teacher.isIndividualAccount) {
    const { resolveIndividualCatalogSubjectIds } = await import('./individualCatalogSubjects.js');
    librarySubjectIds = await resolveIndividualCatalogSubjectIds(teacher);
  }

  const { normalizeClassNumberLabel } = await import('./studentClassContent.js');
  const classNums = [];
  for (const raw of extraClassNumbers || []) {
    const cn = normalizeClassNumberLabel(raw) || String(raw || '').trim();
    if (cn) classNums.push(cn);
  }
  for (const s of teacher.subjects || []) {
    const cn =
      normalizeClassNumberLabel(s?.classNumber) ||
      String(s?.name || '').match(/_(\d+)$/)?.[1] ||
      '';
    if (cn) classNums.push(cn);
  }

  if (
    programCtx?.isAsliPrepExclusive &&
    Array.isArray(programCtx.iitCategories) &&
    programCtx.iitCategories.some((c) => String(c || '').trim())
  ) {
    const { mergeIitCatalogSubjectsForClasses } = await import('./iitCatalogSubjects.js');
    librarySubjectIds = await mergeIitCatalogSubjectsForClasses(librarySubjectIds, classNums, {
      iitCategories: programCtx.iitCategories,
    });
  }

  const {
    filterToActiveCatalogSubjectIds,
    buildActiveSubjectIdSet,
    filterContentRowsForActiveCatalog,
  } = await import('./activeCatalog.js');
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);
  if (!librarySubjectIds.length) return empty;

  const contentBoards = boardsForSchoolContentScope({
    board: programCtx?.adminBoard || teacher.board,
    curriculumBoard: programCtx?.curriculumBoard,
    isAsliPrepExclusive: programCtx?.isAsliPrepExclusive,
    iitCategories: programCtx?.iitCategories,
    excludeIitBoard: false,
  });
  const boardResolveOpts = contentBoards.length > 0 ? { boards: contentBoards } : {};
  const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, boardResolveOpts);
  if (!contentSubjectIds.length) return empty;

  const activeIdSet = buildActiveSubjectIdSet(contentSubjectIds);
  let contents = await Content.find({
    subject: { $in: contentSubjectIds },
    isActive: true,
    type: 'Video',
  })
    .populate('subject', 'name isActive board classNumber productCategory')
    .select('type board productCategory subject fileUrl title')
    .lean();

  contents = filterContentRowsForActiveCatalog(contents, activeIdSet);
  contents = applySchoolProgramContentFilters(contents, {
    ...programCtx,
    surface: undefined,
  });

  if (teacher.isIndividualAccount) {
    const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
      './studentClassContent.js'
    );
    const classNum = resolveStudentClassNumber(teacher, null);
    if (classNum) {
      contents = filterContentsForStudentClass(contents, classNum, librarySubjectIds);
    }
  }

  const { dedupeLibraryContents } = await import('./dedupeLibraryContents.js');
  contents = dedupeLibraryContents(contents);

  const iit = contents.filter((row) => isIitTrackVideo(row));
  const learningPath = contents.filter((row) => !isIitTrackVideo(row));
  return {
    total: contents.length,
    learningPath: learningPath.length,
    iit: iit.length,
  };
}
