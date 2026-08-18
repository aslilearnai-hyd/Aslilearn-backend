import express from 'express';
import mongoose from 'mongoose';
import Content from '../../models/Content.js';
import Class from '../../models/Class.js';
import {
  buildActiveSubjectIdSet,
  filterContentRowsForActiveCatalog,
  getActiveCatalogSubjectIds,
} from '../../utils/activeCatalog.js';
import { boardsForSchoolContentScope } from '../../constants/boards.js';
import { normalizeClassNumberLabel } from '../../utils/studentClassContent.js';

const router = express.Router();

router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, surface } = req.query;
    const adminId = req.adminId;

    const {
      getAdminSchoolProgramContext,
      applySchoolProgramContentFilters,
      isAllowedContentType,
      isEduOttSurface,
      resolveIitCategoriesForContentBrowse,
    } = await import('../../utils/schoolProgram.js');

    const baseCtx = await getAdminSchoolProgramContext(adminId);
    const hasTracks =
      Array.isArray(baseCtx.iitCategories) &&
      baseCtx.iitCategories.some((c) => String(c || '').trim());
    const iitCategoriesForAdmin = resolveIitCategoriesForContentBrowse(baseCtx);

    const programCtx = {
      ...baseCtx,
      iitCategories: iitCategoriesForAdmin,
      surface,
    };

    const eduOtt = isEduOttSurface(surface);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({
        success: true,
        data: [],
        message: eduOtt
          ? 'EduOTT IIT videos are available only for Asli Prep schools. Board content stays in Learning Paths.'
          : 'This content type is not available for your school program.',
        meta: {
          reason: 'not_asli_prep',
          isAsliPrepExclusive: Boolean(programCtx.isAsliPrepExclusive),
          iitCategories: programCtx.iitCategories || [],
          iitBrowseFallback: !hasTracks && programCtx.isAsliPrepExclusive,
        },
      });
    }

    if (eduOtt && !programCtx.isAsliPrepExclusive) {
      return res.json({
        success: true,
        data: [],
        message:
          'EduOTT IIT videos are available only for Asli Prep schools. Board content stays in Learning Paths.',
        meta: {
          reason: 'not_asli_prep',
          isAsliPrepExclusive: false,
          iitCategories: [],
        },
      });
    }

    const activeSubjectIds = await getActiveCatalogSubjectIds();
    const activeIdSet = buildActiveSubjectIdSet(activeSubjectIds);

    const query = {
      isActive: true,
      subject: { $in: activeSubjectIds },
    };
    let seedSubjectName = '';

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(String(subject))) {
      const sid = String(subject);
      const { resolveSubjectContentIds } = await import(
        '../../utils/resolveSubjectContentIds.js'
      );
      const boards = boardsForSchoolContentScope({
        board: programCtx.adminBoard || programCtx.curriculumBoard,
        curriculumBoard: programCtx.curriculumBoard,
        isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
        iitCategories: iitCategoriesForAdmin,
        excludeIitBoard: false,
      });

      let expandedIds = await resolveSubjectContentIds(sid, { boards });
      const Subject = (await import('../../models/Subject.js')).default;
      const subjDoc = await Subject.findById(sid).select('classNumber name').lean();
      seedSubjectName = subjDoc?.name || '';
      if (programCtx.isAsliPrepExclusive && iitCategoriesForAdmin.length && seedSubjectName) {
        const { mergeSameGroupIitCatalogSubjectIds } = await import(
          '../../utils/iitCatalogSubjects.js'
        );
        const classNum =
          normalizeClassNumberLabel(subjDoc?.classNumber || '') ||
          String(subjDoc?.name || '').match(/_(\d+)$/)?.[1] ||
          '';
        if (classNum) {
          expandedIds = await mergeSameGroupIitCatalogSubjectIds(
            expandedIds,
            classNum,
            seedSubjectName,
            { iitCategories: iitCategoriesForAdmin },
          );
        }
      }

      const filteredExpanded = (expandedIds || [])
        .map((id) => String(id))
        .filter((id) => activeIdSet.has(id) && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (!filteredExpanded.length) {
        return res.json({
          success: true,
          data: [],
          meta: {
            isAsliPrepExclusive: Boolean(programCtx.isAsliPrepExclusive),
            iitCategories: programCtx.iitCategories || [],
            iitBrowseFallback: !hasTracks && programCtx.isAsliPrepExclusive,
          },
        });
      }
      query.subject = { $in: filteredExpanded };
    }

    if (type && type !== 'all') {
      query.type = type;
    }

    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }

    let contents = await Content.find(query)
      .populate('subject', 'name isActive classNumber board stateName productCategory')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);
    contents = applySchoolProgramContentFilters(contents, programCtx);

    if (seedSubjectName) {
      const { contentRowMatchesSubjectGroup } = await import(
        '../../utils/resolveSubjectContentIds.js'
      );
      contents = contents.filter((row) => contentRowMatchesSubjectGroup(row, seedSubjectName));
    }

    // Prefer content for classes this school actually runs (still keep untagged class).
    if (adminId && mongoose.Types.ObjectId.isValid(String(adminId))) {
      const adminClasses = await Class.find({
        assignedAdmin: adminId,
        isActive: true,
      })
        .select('classNumber')
        .lean();
      const classSet = new Set(
        adminClasses
          .map((c) => normalizeClassNumberLabel(c.classNumber))
          .filter(Boolean),
      );
      if (classSet.size > 0) {
        contents = contents.filter((row) => {
          const cn = normalizeClassNumberLabel(
            row?.classNumber || row?.subject?.classNumber || '',
          );
          if (!cn) return true;
          return classSet.has(cn);
        });
      }
    }

    const { enrichContentDurations } = await import('../../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    const { dedupeLibraryContents } = await import('../../utils/dedupeLibraryContents.js');
    contents = dedupeLibraryContents(contents);

    res.json({
      success: true,
      data: contents,
      meta: {
        isAsliPrepExclusive: Boolean(programCtx.isAsliPrepExclusive),
        iitCategories: hasTracks ? baseCtx.iitCategories : iitCategoriesForAdmin,
        iitBrowseFallback: !hasTracks && programCtx.isAsliPrepExclusive,
        schoolTracksAssigned: hasTracks,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for admin:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

export default router;
