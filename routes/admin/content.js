import express from 'express';
import mongoose from 'mongoose';
import Content from '../../models/Content.js';
import {
  buildActiveSubjectIdSet,
  filterContentRowsForActiveCatalog,
  getActiveCatalogSubjectIds,
} from '../../utils/activeCatalog.js';

const router = express.Router();

router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, surface } = req.query;
    const adminId = req.adminId;

    console.log('📚 Fetching Asli Prep content for admin:', adminId);
    console.log('Query params:', { subject, type, topic, surface });
    console.log('📚 Fetching all content (board restrictions removed)');

    const { getAdminSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType, isEduOttSurface } =
      await import('../../utils/schoolProgram.js');
    const programCtx = {
      ...(await getAdminSchoolProgramContext(adminId)),
      surface,
    };

    const eduOtt = isEduOttSurface(surface);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({
        success: true,
        data: [],
        message: eduOtt
          ? 'EduOTT IIT videos are available only for Asli Prep schools with IIT EduOTT enabled. Board content stays in Learning Paths.'
          : 'This content type is not available for your school program.',
        meta: {
          reason: 'not_asli_prep',
          isAsliPrepExclusive: false,
          iitCategories: [],
        },
      });
    }

    if (
      eduOtt &&
      programCtx.isAsliPrepExclusive &&
      !(
        Array.isArray(programCtx.iitCategories) &&
        programCtx.iitCategories.some((c) => String(c || '').trim())
      )
    ) {
      return res.json({
        success: true,
        data: [],
        message:
          'IIT EduOTT is not enabled for this school yet. Ask Super Admin to assign Alpha/Beta/Gamma tracks on the school profile.',
        meta: {
          reason: 'iit_eduott_off',
          isAsliPrepExclusive: true,
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

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const sid = String(subject);
      if (activeIdSet.has(sid)) {
        query.subject = new mongoose.Types.ObjectId(sid);
      } else {
        return res.json({ success: true, data: [] });
      }
    }

    if (type && type !== 'all') {
      query.type = type;
    }

    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }

    console.log('📋 Content query:', JSON.stringify(query, null, 2));

    let contents = await Content.find(query)
      .populate('subject', 'name isActive classNumber board stateName productCategory')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);
    contents = applySchoolProgramContentFilters(contents, programCtx);

    console.log(`✅ Found ${contents.length} active catalog contents`);

    const { enrichContentDurations } = await import('../../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    const { dedupeLibraryContents } = await import('../../utils/dedupeLibraryContents.js');
    contents = dedupeLibraryContents(contents);

    res.json({
      success: true,
      data: contents,
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for admin:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

export default router;
