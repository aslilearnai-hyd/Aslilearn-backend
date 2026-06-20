import mongoose from 'mongoose';
import AiToolTopic from '../models/AiToolTopic.js';
import { boardMongoMatch, canonicalBoardLabel } from '../utils/board-label.js';
import {
  buildAiToolTopicHierarchyTree,
  buildAiToolTopicTaxonomyFilter,
} from '../utils/ai-tool-topic-taxonomy.js';
import { buildDisplayTopicName } from '../utils/ai-tool-topic-display.js';
import {
  orderedUniqueSubTopics,
  orderedUniqueTopics,
  resolveSortOrderStart,
} from '../utils/ai-tool-topic-order.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildFilters(query) {
  const filter = buildAiToolTopicTaxonomyFilter({
    board: query.board,
    classLabel: query.classLabel,
    subject: query.subject,
    topicName: query.topicName,
  });
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
      const searchClause = {
        $or: [
          { board: { $regex: search, $options: 'i' } },
          { classLabel: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { label: { $regex: search, $options: 'i' } },
          { topicName: { $regex: search, $options: 'i' } },
          { subTopic: { $regex: search, $options: 'i' } },
        ],
      };
      if (!filter.$and) filter.$and = [];
      filter.$and.push(searchClause);
    }

    const [items, total] = await Promise.all([
      AiToolTopic.find(filter)
        .sort({
          board: 1,
          classLabel: 1,
          subject: 1,
          sortOrder: 1,
          createdAt: 1,
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

    const subTopics = Array.isArray(req.body.subTopics)
      ? req.body.subTopics.map((s) => normalizeText(s)).filter(Boolean)
      : normalizeText(req.body.subTopic)
        ? [normalizeText(req.body.subTopic)]
        : [];

    if (!board || !classLabel || !subject || !topicName || subTopics.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'board, classLabel, subject, topicName and at least one subTopic are required.',
      });
    }

    const createdBy = req.userId || req.user?.id || null;
    const sortOrderRaw = req.body.sortOrder;
    const topicFilter = { board, classLabel, subject, topicName, isActive: true };
    const baseSortOrder = await resolveSortOrderStart(AiToolTopic, topicFilter, sortOrderRaw);

    const docs = subTopics.map((subTopic, index) => ({
      board,
      classLabel,
      subject,
      label,
      topicName,
      subTopic,
      sortOrder: baseSortOrder + index,
      createdBy,
      updatedBy: createdBy,
    }));

    if (docs.length === 1) {
      const item = await AiToolTopic.create(docs[0]);
      return res.status(201).json({ success: true, data: item, createdCount: 1 });
    }

    const created = [];
    const skipped = [];
    for (const doc of docs) {
      try {
        const item = await AiToolTopic.create(doc);
        created.push(item);
      } catch (err) {
        if (err?.code === 11000) {
          skipped.push(doc.subTopic);
        } else {
          throw err;
        }
      }
    }

    if (created.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'All sub-topics already exist for this topic mapping.',
        skipped,
      });
    }

    return res.status(201).json({
      success: true,
      data: created,
      createdCount: created.length,
      skippedCount: skipped.length,
      skipped,
      message: `Created ${created.length} sub-topic${created.length === 1 ? '' : 's'}.`,
    });
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

const TOPIC_OPTIONS_SELECT = 'board classLabel subject label topicName subTopic sortOrder createdAt';

function uniqueSortedValues(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => NATURAL_COLLATOR.compare(a, b));
}

async function queryTopicOptionRows(filter) {
  return AiToolTopic.find(filter)
    .select(TOPIC_OPTIONS_SELECT)
    .sort({ sortOrder: 1, createdAt: 1, _id: 1 })
    .lean();
}

export async function getAiToolTopicHierarchy(req, res) {
  try {
    const board = normalizeText(req.query.board);

    if (!board) {
      const rawBoards = await AiToolTopic.distinct('board', { isActive: true });
      const boards = uniqueSortedValues(rawBoards.map((value) => canonicalBoardLabel(value)));
      return res.json({ success: true, data: { boards, tree: null } });
    }

    const filter = buildAiToolTopicTaxonomyFilter({ board });
    const rows = await queryTopicOptionRows(filter);

    return res.json({
      success: true,
      data: {
        tree: buildAiToolTopicHierarchyTree(rows),
      },
    });
  } catch (error) {
    console.error('getAiToolTopicHierarchy error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI tool topic hierarchy.' });
  }
}

export async function listAiToolTopicOptions(req, res) {
  try {
    const filter = buildFilters(req.query);
    const hasBoard = Boolean(normalizeText(req.query.board));
    const hasClass = Boolean(normalizeText(req.query.classLabel));
    const hasSubject = Boolean(normalizeText(req.query.subject));
    const hasTopic = Boolean(normalizeText(req.query.topicName));

    const emptyLists = {
      boards: [],
      classes: [],
      subjects: [],
      labels: [],
      topics: [],
      subTopics: [],
    };

    if (!hasBoard && !hasClass && !hasSubject && !hasTopic) {
      const rawBoards = await AiToolTopic.distinct('board', { isActive: true });
      return res.json({
        success: true,
        data: {
          ...emptyLists,
          boards: uniqueSortedValues(rawBoards.map((value) => canonicalBoardLabel(value))),
        },
      });
    }

    if (hasBoard && !hasClass) {
      const classes = await AiToolTopic.distinct('classLabel', filter);
      return res.json({
        success: true,
        data: {
          ...emptyLists,
          classes: uniqueSortedValues(classes),
        },
      });
    }

    if (hasBoard && hasClass && !hasSubject) {
      const subjects = await AiToolTopic.distinct('subject', filter);
      return res.json({
        success: true,
        data: {
          ...emptyLists,
          subjects: uniqueSortedValues(subjects),
        },
      });
    }

    const rows = await queryTopicOptionRows(filter);

    return res.json({
      success: true,
      data: {
        boards: hasBoard ? [] : uniqueSortedValues(rows.map((row) => canonicalBoardLabel(row.board))),
        classes: hasClass ? [] : uniqueSortedValues(rows.map((row) => row.classLabel)),
        subjects: hasSubject ? [] : uniqueSortedValues(rows.map((row) => row.subject)),
        labels: uniqueSortedValues(rows.map((row) => row.label)),
        topics: hasTopic
          ? []
          : orderedUniqueTopics(rows, (row) => buildDisplayTopicName(row.label, row.topicName)),
        subTopics: orderedUniqueSubTopics(rows),
      },
    });
  } catch (error) {
    console.error('listAiToolTopicOptions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI tool topic options.' });
  }
}
