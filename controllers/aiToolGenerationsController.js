import mongoose from 'mongoose';
import AiToolGeneration from '../models/AiToolGeneration.js';

function previewFromContent(text, n = 220) {
  if (!text || typeof text !== 'string') return '';
  const plain = text.replace(/[#*_`[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length <= n ? plain : `${plain.slice(0, n)}…`;
}

/**
 * Lazy hierarchy: which distinct field comes next based on which query keys are present.
 * Keys must be added in order: toolName → classLabel → subject → topic → subtopic
 */
export const listAiToolChildren = async (req, res) => {
  try {
    const q = req.query;

    if (!('toolName' in q)) {
      const agg = await AiToolGeneration.aggregate([
        { $group: { _id: '$toolName', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return res.json({
        success: true,
        data: {
          nextLevel: 'classLabel',
          items: agg.map((a) => ({ value: a._id, count: a.count })),
        },
      });
    }

    const { toolName } = q;
    const match = { toolName };

    if (!('classLabel' in q)) {
      const agg = await AiToolGeneration.aggregate([
        { $match: match },
        { $group: { _id: '$classLabel', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return res.json({
        success: true,
        data: {
          nextLevel: 'subject',
          items: agg.map((a) => ({ value: a._id ?? '', count: a.count })),
        },
      });
    }
    match.classLabel = q.classLabel ?? '';

    if (!('subject' in q)) {
      const agg = await AiToolGeneration.aggregate([
        { $match: match },
        { $group: { _id: '$subject', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return res.json({
        success: true,
        data: {
          nextLevel: 'topic',
          items: agg.map((a) => ({ value: a._id ?? '', count: a.count })),
        },
      });
    }
    match.subject = q.subject ?? '';

    if (!('topic' in q)) {
      const agg = await AiToolGeneration.aggregate([
        { $match: match },
        { $group: { _id: '$topic', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return res.json({
        success: true,
        data: {
          nextLevel: 'subtopic',
          items: agg.map((a) => ({ value: a._id ?? '', count: a.count })),
        },
      });
    }
    match.topic = q.topic ?? '';

    if (!('subtopic' in q)) {
      const agg = await AiToolGeneration.aggregate([
        { $match: match },
        { $group: { _id: '$subtopic', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return res.json({
        success: true,
        data: {
          nextLevel: 'subtopic',
          items: agg.map((a) => ({ value: a._id ?? '', count: a.count })),
        },
      });
    }

    match.subtopic = q.subtopic ?? '';

    return res.json({
      success: true,
      data: {
        nextLevel: 'leaf',
        leaf: true,
        matchSummary: match,
      },
    });
  } catch (error) {
    console.error('listAiToolChildren error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listAiToolRecords = async (req, res) => {
  try {
    const { toolName, classLabel, subject, topic, subtopic, page = '1', limit = '25' } = req.query;
    if (!toolName || !('classLabel' in req.query) || !('subject' in req.query) || !('topic' in req.query) || !('subtopic' in req.query)) {
      return res.status(400).json({
        success: false,
        message: 'toolName, classLabel, subject, topic, and subtopic are required (use empty string if none).',
      });
    }

    const match = {
      toolName,
      classLabel: classLabel ?? '',
      subject: subject ?? '',
      topic: topic ?? '',
      subtopic: subtopic ?? '',
    };

    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (p - 1) * lim;

    const [total, docs] = await Promise.all([
      AiToolGeneration.countDocuments(match),
      AiToolGeneration.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .select('toolName toolDisplayName classLabel subject topic subtopic createdAt teacherId metadata content')
        .lean(),
    ]);

    const items = docs.map((d) => ({
      _id: d._id,
      toolName: d.toolName,
      toolDisplayName: d.toolDisplayName,
      classLabel: d.classLabel,
      subject: d.subject,
      topic: d.topic,
      subtopic: d.subtopic,
      createdAt: d.createdAt,
      teacherId: d.teacherId,
      preview: previewFromContent(d.content || ''),
    }));

    res.json({
      success: true,
      data: {
        match,
        page: p,
        limit: lim,
        total,
        items,
      },
    });
  } catch (error) {
    console.error('listAiToolRecords error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await AiToolGeneration.findById(id).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.json({ success: true, data: doc });
  } catch (error) {
    console.error('getAiToolGenerationById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, message: 'content is required' });
    }

    const update = {
      content: content.trim(),
      generatedContent: content.trim(),
    };
    const doc = await AiToolGeneration.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.json({ success: true, data: doc });
  } catch (error) {
    console.error('updateAiToolGenerationById error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAiToolGenerationById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await AiToolGeneration.findByIdAndDelete(id).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.json({ success: true, message: 'Record deleted' });
  } catch (error) {
    console.error('deleteAiToolGenerationById error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * For PDF: returns nested sections with full content (may be large).
 * Query: optional toolName, classLabel, subject, topic, subtopic — narrow the export.
 */
export const exportAiToolGenerationsBundle = async (req, res) => {
  try {
    const match = {};
    if (req.query.toolName) match.toolName = req.query.toolName;
    if ('classLabel' in req.query) match.classLabel = req.query.classLabel ?? '';
    if ('subject' in req.query) match.subject = req.query.subject ?? '';
    if ('topic' in req.query) match.topic = req.query.topic ?? '';
    if ('subtopic' in req.query) match.subtopic = req.query.subtopic ?? '';

    const max = Math.min(5000, Math.max(1, parseInt(req.query.maxDocs || '2000', 10) || 2000));
    const docs = await AiToolGeneration.find(
      Object.keys(match).length ? match : {},
    )
      .sort({ toolName: 1, classLabel: 1, subject: 1, topic: 1, subtopic: 1, createdAt: -1 })
      .limit(max)
      .lean();

    if (docs.length >= max) {
      return res.json({
        success: true,
        data: { truncated: true, maxDocs: max, records: docs, warning: `Export limited to ${max} documents.` },
      });
    }

    res.json({
      success: true,
      data: { truncated: false, records: docs },
    });
  } catch (error) {
    console.error('exportAiToolGenerationsBundle error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAiToolGenerationsMeta = async (req, res) => {
  try {
    const [total, distinctTopicsCount] = await Promise.all([
      AiToolGeneration.countDocuments(),
      AiToolGeneration.aggregate([
        {
          $match: {
            topic: { $type: 'string', $ne: '' },
          },
        },
        { $group: { _id: '$topic' } },
        { $count: 'count' },
      ]),
    ]);

    const topicsCount = distinctTopicsCount[0]?.count || 0;
    res.json({ success: true, data: { total, topicsCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
