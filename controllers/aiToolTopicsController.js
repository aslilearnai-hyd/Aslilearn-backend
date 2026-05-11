import mongoose from 'mongoose';
import AiToolTopic from '../models/AiToolTopic.js';
import { boardMongoMatch, canonicalBoardLabel } from '../utils/board-label.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildDisplayTopicName(label, topicName) {
  const safeLabel = normalizeText(label);
  const safeTopicName = normalizeText(topicName);
  if (!safeLabel) return safeTopicName;
  const prefix = `${safeLabel} - `;
  return safeTopicName.startsWith(prefix) ? safeTopicName : `${prefix}${safeTopicName}`;
}

function buildFilters(query) {
  const filter = { isActive: true };
  if (query.board) filter.board = boardMongoMatch(normalizeText(query.board));
  if (query.classLabel) filter.classLabel = normalizeText(query.classLabel);
  if (query.subject) filter.subject = normalizeText(query.subject);
  if (query.topicName) filter.topicName = normalizeText(query.topicName);
  if (query.subTopic) filter.subTopic = normalizeText(query.subTopic);
  if (query.label) filter.label = normalizeText(query.label);
  return filter;
}

export async function listAiToolTopics(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '25', 10) || 25));
    const skip = (page - 1) * limit;
    const search = normalizeText(req.query.search);

    const filter = buildFilters(req.query);
    if (search) {
      filter.$or = [
        { board: { $regex: search, $options: 'i' } },
        { classLabel: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { label: { $regex: search, $options: 'i' } },
        { topicName: { $regex: search, $options: 'i' } },
        { subTopic: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      AiToolTopic.find(filter)
        .sort({
          board: 1,
          classLabel: 1,
          subject: 1,
          sortOrder: 1,
          label: 1,
          topicName: 1,
          subTopic: 1,
          _id: 1,
        })
        .collation({ locale: 'en', numericOrdering: true, strength: 2 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AiToolTopic.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { items, total, page, limit },
    });
  } catch (error) {
    console.error('listAiToolTopics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI tool topics.' });
  }
}

export async function createAiToolTopic(req, res) {
  try {
    const board = canonicalBoardLabel(normalizeText(req.body.board));
    const classLabel = normalizeText(req.body.classLabel);
    const subject = normalizeText(req.body.subject);
    const label = normalizeText(req.body.label || '');
    const topicInput = normalizeText(req.body.topicName);
    const topicName = buildDisplayTopicName(label, topicInput);
    const subTopic = normalizeText(req.body.subTopic);

    if (!board || !classLabel || !subject || !topicName || !subTopic) {
      return res.status(400).json({
        success: false,
        message: 'board, classLabel, subject, topicName and subTopic are required.',
      });
    }

    const createdBy = req.userId || req.user?.id || null;

    const sortOrderRaw = req.body.sortOrder;
    const sortOrder =
      sortOrderRaw != null && Number.isFinite(Number(sortOrderRaw)) ? Number(sortOrderRaw) : undefined;

    const item = await AiToolTopic.create({
      board,
      classLabel,
      subject,
      label,
      topicName,
      subTopic,
      sortOrder,
      createdBy,
      updatedBy: createdBy,
    });

    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('createAiToolTopic error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This Board/Class/Subject/Topic/Sub Topic mapping already exists.',
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to create AI tool topic.' });
  }
}

export async function updateAiToolTopic(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid topic id.' });
    }

    const existing = await AiToolTopic.findOne({ _id: id, isActive: true }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'AI tool topic not found.' });
    }

    const update = {};
    const editableKeys = ['board', 'classLabel', 'subject', 'label', 'topicName', 'subTopic'];
    for (const key of editableKeys) {
      if (req.body[key] !== undefined) {
        const raw = normalizeText(req.body[key]);
        update[key] = key === 'board' ? canonicalBoardLabel(raw) : raw;
      }
    }

    const finalLabel = update.label !== undefined ? update.label : normalizeText(existing.label || '');
    const finalTopicInput = update.topicName !== undefined ? update.topicName : normalizeText(existing.topicName || '');
    update.label = finalLabel;
    update.topicName = buildDisplayTopicName(finalLabel, finalTopicInput);
    update.updatedBy = req.userId || req.user?.id || null;

    const updated = await AiToolTopic.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: update },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'AI tool topic not found.' });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('updateAiToolTopic error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This Board/Class/Subject/Topic/Sub Topic mapping already exists.',
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to update AI tool topic.' });
  }
}

export async function deleteAiToolTopic(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid topic id.' });
    }

    const updated = await AiToolTopic.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: { isActive: false, updatedBy: req.userId || req.user?.id || null } },
      { new: true },
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'AI tool topic not found.' });
    }

    return res.json({ success: true, message: 'AI tool topic deleted successfully.' });
  } catch (error) {
    console.error('deleteAiToolTopic error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete AI tool topic.' });
  }
}

export async function bulkDeleteAiToolTopics(req, res) {
  try {
    const board = normalizeText(req.body.board);
    const classLabel = normalizeText(req.body.classLabel);
    const subject = normalizeText(req.body.subject);

    if (!board) {
      return res.status(400).json({ success: false, message: 'board is required.' });
    }
    if (!classLabel && !subject) {
      return res.status(400).json({
        success: false,
        message: 'Provide classLabel and/or subject for bulk delete.',
      });
    }

    const filter = { isActive: true, board: boardMongoMatch(board) };
    if (classLabel) filter.classLabel = classLabel;
    if (subject) filter.subject = subject;

    const result = await AiToolTopic.updateMany(
      filter,
      { $set: { isActive: false, updatedBy: req.userId || req.user?.id || null } },
    );

    return res.json({
      success: true,
      message: 'AI tool topics deleted successfully.',
      data: { matchedCount: result.matchedCount || 0, modifiedCount: result.modifiedCount || 0 },
    });
  } catch (error) {
    console.error('bulkDeleteAiToolTopics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk delete AI tool topics.' });
  }
}

export async function listAiToolTopicOptions(req, res) {
  try {
    const { board, classLabel, subject, topicName } = req.query;
    const filter = { isActive: true };
    if (board) filter.board = boardMongoMatch(normalizeText(board));
    if (classLabel) filter.classLabel = normalizeText(classLabel);
    if (subject) filter.subject = normalizeText(subject);
    if (topicName) filter.topicName = normalizeText(topicName);

    const rows = await AiToolTopic.find(filter)
      .select('board classLabel subject label topicName subTopic')
      .lean();

    const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => NATURAL_COLLATOR.compare(a, b));

    return res.json({
      success: true,
      data: {
        boards: unique(rows.map((r) => canonicalBoardLabel(r.board))),
        classes: unique(rows.map((r) => r.classLabel)),
        subjects: unique(rows.map((r) => r.subject)),
        labels: unique(rows.map((r) => r.label)),
        topics: unique(rows.map((r) => r.topicName)),
        subTopics: unique(rows.map((r) => r.subTopic)),
      },
    });
  } catch (error) {
    console.error('listAiToolTopicOptions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI tool topic options.' });
  }
}
