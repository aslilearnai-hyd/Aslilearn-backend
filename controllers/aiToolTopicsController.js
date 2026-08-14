import mongoose from 'mongoose';
import AiToolTopic, { ensureAiToolTopicIndexes } from '../models/AiToolTopic.js';
import AiToolCategoryShare from '../models/AiToolCategoryShare.js';
import Board from '../models/Board.js';
import {
  boardMongoMatch,
  canonicalBoardLabel,
  normalizeBoardLabelForGrouping,
  resolveClassLabelForAiToolStorage,
} from '../utils/board-label.js';
import { canonicalizeSchoolBoard } from '../constants/boards.js';
import {
  buildAiToolTopicHierarchyTree,
  buildAiToolTopicTaxonomyFilter,
  normalizeTopicProductCategory,
} from '../utils/ai-tool-topic-taxonomy.js';
import {
  buildProductCategoryReadFilter,
  describeCategoryShares,
  invalidateAiToolCategoryShareCache,
} from '../utils/ai-tool-category-share.js';
import { mergeMongoFilters } from '../utils/ai-tool-data-match.js';
import { buildDisplayTopicName } from '../utils/ai-tool-topic-display.js';
import {
  orderedUniqueSubTopics,
  orderedUniqueTopics,
  resolveSortOrderStart,
} from '../utils/ai-tool-topic-order.js';
import {
  formatIitCategoryLabel,
  getActiveProductCategoryCodes,
  listProductCategories,
} from '../constants/products.js';

const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

let indexesEnsured = false;
async function ensureIndexesOnce() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  await ensureAiToolTopicIndexes();
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Category-aware filter. When the selected category borrows from another one
 * (AI Tool category shares), the source category's rows are unioned in.
 */
async function buildFilters(query) {
  const filter = buildAiToolTopicTaxonomyFilter({
    board: query.board,
    productCategory: undefined,
    classLabel: query.classLabel,
    subject: query.subject,
    topicName: query.topicName,
  });
  if (query.subTopic) filter.subTopic = normalizeText(query.subTopic);
  if (query.label) filter.label = normalizeText(query.label);

  if (query.productCategory === undefined) return filter;

  const categoryFilter = await buildProductCategoryReadFilter({
    board: query.board,
    classLabel: query.classLabel,
    subject: query.subject,
    productCategory: query.productCategory,
  });
  return mergeMongoFilters(filter, categoryFilter);
}

async function resolveProductCategoriesForBoard(board) {
  const boardCode = canonicalizeSchoolBoard(board);
  const filter = buildAiToolTopicTaxonomyFilter({ board });
  const fromRows = await AiToolTopic.distinct('productCategory', filter);
  const codesFromRows = [
    ...new Set(
      fromRows
        .map((c) => normalizeTopicProductCategory(c === undefined ? null : c ?? ''))
        .filter((c) => c !== null)
        .map((c) => c || ''),
    ),
  ];
  const boardDoc = boardCode
    ? await Board.findOne({ code: boardCode }).select('product').lean()
    : null;
  const linkedProduct = String(boardDoc?.product || '').toUpperCase().trim();
  const activeCodes = linkedProduct
    ? await getActiveProductCategoryCodes({ product: linkedProduct })
    : [];
  const catalog = await listProductCategories({
    includeInactive: false,
    product: linkedProduct || null,
  });
  const labelMap = Object.fromEntries(
    catalog.map((r) => [r.code, r.label || formatIitCategoryLabel(r.code)]),
  );

  const categories = [
    { code: '', label: 'General' },
    ...activeCodes.map((code) => ({
      code,
      label: labelMap[code] || formatIitCategoryLabel(code),
    })),
  ];

  // Include orphan codes still present on topic rows
  for (const code of codesFromRows) {
    if (!code) continue;
    if (!categories.some((c) => c.code === code)) {
      categories.push({ code, label: formatIitCategoryLabel(code) });
    }
  }

  return { categories, codesFromRows };
}

export async function listAiToolTopics(req, res) {
  try {
    await ensureIndexesOnce();
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '25', 10) || 25));
    const skip = (page - 1) * limit;
    const search = normalizeText(req.query.search);

    const filter = await buildFilters(req.query);
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
    await ensureIndexesOnce();
    const board = canonicalBoardLabel(normalizeText(req.body.board));
    const productCategory = normalizeTopicProductCategory(req.body.productCategory ?? '') ?? '';
    const classLabel = resolveClassLabelForAiToolStorage(normalizeText(req.body.classLabel), board);
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
    const topicFilter = { board, productCategory, classLabel, subject, topicName, isActive: true };
    const baseSortOrder = await resolveSortOrderStart(AiToolTopic, topicFilter, sortOrderRaw);

    const docs = subTopics.map((subTopic, index) => ({
      board,
      productCategory,
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
        message: 'This Board/Category/Class/Subject/Topic/Sub Topic mapping already exists.',
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to create AI tool topic.' });
  }
}

export async function updateAiToolTopic(req, res) {
  try {
    await ensureIndexesOnce();
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
        if (key === 'board') {
          update[key] = canonicalBoardLabel(raw);
        } else if (key === 'classLabel') {
          update[key] = resolveClassLabelForAiToolStorage(raw, update.board || existing.board);
        } else {
          update[key] = raw;
        }
      }
    }
    if (req.body.productCategory !== undefined) {
      update.productCategory = normalizeTopicProductCategory(req.body.productCategory) ?? '';
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
        message: 'This Board/Category/Class/Subject/Topic/Sub Topic mapping already exists.',
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

    let filter = buildAiToolTopicTaxonomyFilter({
      board,
      productCategory:
        req.body.productCategory !== undefined ? req.body.productCategory : undefined,
      classLabel,
      subject,
    });

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

const TOPIC_OPTIONS_SELECT =
  'board productCategory classLabel subject label topicName subTopic sortOrder createdAt';

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
    await ensureIndexesOnce();
    const board = normalizeText(req.query.board);
    const productCategoryParam = req.query.productCategory;

    if (!board) {
      const rawBoards = await AiToolTopic.distinct('board', { isActive: true });
      const boards = uniqueSortedValues(rawBoards.map((value) => normalizeBoardLabelForGrouping(value)));
      return res.json({ success: true, data: { boards, tree: null, productCategories: [] } });
    }

    const { categories } = await resolveProductCategoriesForBoard(board);

    // Board only (no productCategory query key) → category pills; tree after category chosen.
    if (!Object.prototype.hasOwnProperty.call(req.query, 'productCategory')) {
      return res.json({
        success: true,
        data: {
          productCategories: categories,
          tree: null,
        },
      });
    }

    const filter = await buildFilters({ board, productCategory: productCategoryParam });
    const rows = await queryTopicOptionRows(filter);
    const shares = await describeCategoryShares({
      board,
      productCategory: productCategoryParam,
    });

    return res.json({
      success: true,
      data: {
        productCategories: categories,
        tree: buildAiToolTopicHierarchyTree(rows),
        shares,
      },
    });
  } catch (error) {
    console.error('getAiToolTopicHierarchy error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI tool topic hierarchy.' });
  }
}

export async function listAiToolTopicOptions(req, res) {
  try {
    await ensureIndexesOnce();
    const filter = await buildFilters(req.query);
    const hasBoard = Boolean(normalizeText(req.query.board));
    const hasCategory = Object.prototype.hasOwnProperty.call(req.query, 'productCategory');
    const hasClass = Boolean(normalizeText(req.query.classLabel));
    const hasSubject = Boolean(normalizeText(req.query.subject));
    const hasTopic = Boolean(normalizeText(req.query.topicName));

    const emptyLists = {
      boards: [],
      productCategories: [],
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
          boards: uniqueSortedValues(rawBoards.map((value) => normalizeBoardLabelForGrouping(value))),
        },
      });
    }

    if (hasBoard && !hasCategory && !hasClass) {
      const { categories } = await resolveProductCategoriesForBoard(normalizeText(req.query.board));
      return res.json({
        success: true,
        data: {
          ...emptyLists,
          productCategories: categories,
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
        boards: hasBoard ? [] : uniqueSortedValues(rows.map((row) => normalizeBoardLabelForGrouping(row.board))),
        productCategories: [],
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

function serializeShare(row) {
  return {
    _id: row._id,
    board: row.board,
    classLabel: row.classLabel,
    subject: row.subject || '',
    targetCategory: row.targetCategory || '',
    sourceCategory: row.sourceCategory || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** GET /ai-tool-topics/category-shares?board=&classLabel=&subject=&sourceCategory= */
export async function listAiToolCategoryShares(req, res) {
  try {
    const filter = { isActive: true };
    const board = canonicalBoardLabel(normalizeText(req.query.board));
    if (board) filter.board = board;

    const classLabel = normalizeText(req.query.classLabel);
    if (classLabel) filter.classLabel = resolveClassLabelForAiToolStorage(classLabel, board);

    const subject = normalizeText(req.query.subject);
    if (subject) filter.subject = subject;

    if (req.query.sourceCategory !== undefined) {
      filter.sourceCategory = normalizeTopicProductCategory(req.query.sourceCategory) ?? '';
    }
    if (req.query.targetCategory !== undefined) {
      filter.targetCategory = normalizeTopicProductCategory(req.query.targetCategory) ?? '';
    }

    const rows = await AiToolCategoryShare.find(filter)
      .sort({ board: 1, classLabel: 1, subject: 1, targetCategory: 1 })
      .lean();

    return res.json({ success: true, data: rows.map(serializeShare) });
  } catch (error) {
    console.error('listAiToolCategoryShares error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch category shares.' });
  }
}

/**
 * POST /ai-tool-topics/category-shares
 * { board, classLabel, subject?, sourceCategory, targetCategories: [] }
 * Points each target category at the source category for that class/subject.
 */
export async function saveAiToolCategoryShares(req, res) {
  try {
    const board = canonicalBoardLabel(normalizeText(req.body.board));
    const classLabel = resolveClassLabelForAiToolStorage(normalizeText(req.body.classLabel), board);
    const subject = normalizeText(req.body.subject || '');
    const sourceCategory = normalizeTopicProductCategory(req.body.sourceCategory ?? '') ?? '';

    if (!board || !classLabel) {
      return res.status(400).json({
        success: false,
        message: 'board and classLabel are required.',
      });
    }

    const rawTargets = Array.isArray(req.body.targetCategories)
      ? req.body.targetCategories
      : req.body.targetCategory !== undefined
        ? [req.body.targetCategory]
        : [];

    const targets = [
      ...new Set(
        rawTargets
          .map((value) => normalizeTopicProductCategory(value) ?? '')
          .filter((code) => code && code !== sourceCategory),
      ),
    ];

    if (!targets.length) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one target category different from the source.',
      });
    }

    const actor = req.userId || req.user?.id || null;
    const saved = [];

    for (const targetCategory of targets) {
      const row = await AiToolCategoryShare.findOneAndUpdate(
        { board, classLabel, subject, targetCategory, isActive: true },
        {
          $set: {
            board,
            classLabel,
            subject,
            targetCategory,
            sourceCategory,
            isActive: true,
            updatedBy: actor,
          },
          $setOnInsert: { createdBy: actor },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();
      saved.push(serializeShare(row));
    }

    invalidateAiToolCategoryShareCache();

    return res.status(201).json({
      success: true,
      data: saved,
      message: `${saved.length} categor${saved.length === 1 ? 'y' : 'ies'} now use${
        saved.length === 1 ? 's' : ''
      } this content.`,
    });
  } catch (error) {
    console.error('saveAiToolCategoryShares error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This category already shares content for the selected class/subject.',
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to save category share.' });
  }
}

/** DELETE /ai-tool-topics/category-shares/:id */
export async function deleteAiToolCategoryShare(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid share id.' });
    }

    const updated = await AiToolCategoryShare.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: { isActive: false, updatedBy: req.userId || req.user?.id || null } },
      { new: true },
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Category share not found.' });
    }

    invalidateAiToolCategoryShareCache();
    return res.json({ success: true, message: 'Category share removed.' });
  } catch (error) {
    console.error('deleteAiToolCategoryShare error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove category share.' });
  }
}
