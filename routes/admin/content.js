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

    const { getAdminSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../../utils/schoolProgram.js');
    const programCtx = {
      ...(await getAdminSchoolProgramContext(adminId)),
      surface,
    };

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({ success: true, data: [] });
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
