import AiToolTopic from '../models/AiToolTopic.js';
import { boardMongoMatch } from '../utils/board-label.js';
import {
  buildCaseInsensitiveExactFilter,
  buildClassLabelMongoFilter,
  normalizeMatchText,
} from '../utils/ai-tool-data-match.js';
import { orderedUniqueSubTopics } from '../utils/ai-tool-topic-order.js';

function normalizeText(value) {
  return normalizeMatchText(value);
}

function normalizeClassId(classId) {
  if (classId == null || classId === '') return '';
  const s = normalizeText(classId);
  if (s === 'Class-6-IIT') return 'IIT-6';
  if (s === 'IIT-6') return 'IIT-6';
  const match = s.match(/(\d+)/);
  if (match) return `Class ${match[1]}`;
  return s;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildClassLabelFilter(classLabel, board = '') {
  const filter = buildClassLabelMongoFilter(classLabel, board);
  if (filter.classLabel) return filter.classLabel;
  if (filter.$or) return filter;
  return null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function classNumberFromLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/** Class 6, 7, 8, 10 — not Class 10 before Class 6 (plain localeCompare). */
function uniqueSortedClassLabels(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => {
    const diff = classNumberFromLabel(a) - classNumberFromLabel(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  });
}

function chapterNumberFromTopicLabel(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const chapterMatch = s.match(/\b(?:chapter|ch\.?|unit)\s*[#:]?\s*(\d+)\b/i);
  if (chapterMatch) {
    const n = parseInt(chapterMatch[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  const leading = s.match(/^(\d+)\s*[.\):\-–]/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function uniqueSortedChapterTopics(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => {
    const aCh = chapterNumberFromTopicLabel(a);
    const bCh = chapterNumberFromTopicLabel(b);
    if (aCh != null && bCh != null && aCh !== bCh) return aCh - bCh;
    if (aCh != null && bCh == null) return -1;
    if (aCh == null && bCh != null) return 1;
    return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  });
}

function toOptionRows(values) {
  return values.map((value) => ({ id: value, name: value, label: value }));
}

function applyBoardFilter(filter, board) {
  const normalizedBoard = normalizeText(board);
  if (!normalizedBoard) return;
  // Enforce strict board scoping so each UI shows only selected board data.
  filter.board = boardMongoMatch(normalizedBoard);
}

/** GET /api/curriculum/classes */
export const listClasses = async (req, res) => {
  try {
    const board = normalizeText(req.query.board);
    const filter = { isActive: true };
    applyBoardFilter(filter, board);

    const rows = await AiToolTopic.find(filter).select('classLabel').lean();
    const classes = uniqueSortedClassLabels(rows.map((row) => normalizeText(row.classLabel)));
    return res.json({
      success: true,
      data: toOptionRows(classes),
      message: classes.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listClasses:', error);
    return res.status(500).json({ success: false, message: 'Failed to list classes' });
  }
};

/** GET /api/curriculum/subjects?classId=&board= */
export const listSubjects = async (req, res) => {
  try {
    const classLabel = normalizeClassId(req.query.classId);
    const board = normalizeText(req.query.board);
    if (!classLabel) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }

    const classFilter = buildClassLabelFilter(classLabel, board);
    const filter = { isActive: true, classLabel: classFilter || classLabel };
    applyBoardFilter(filter, board);

    const rows = await AiToolTopic.find(filter).select('subject').lean();
    const subjects = uniqueSorted(rows.map((row) => normalizeText(row.subject)));
    return res.json({
      success: true,
      data: toOptionRows(subjects),
      message: subjects.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listSubjects:', error);
    return res.status(500).json({ success: false, message: 'Failed to list subjects' });
  }
};

/** GET /api/curriculum/topics?classId=&subjectId=&board= */
export const listTopics = async (req, res) => {
  try {
    const classLabel = normalizeClassId(req.query.classId);
    const subject = normalizeText(req.query.subjectId);
    const board = normalizeText(req.query.board);
    if (!classLabel || !subject) {
      return res.status(400).json({
        success: false,
        message: 'classId and subjectId are required',
      });
    }

    const classFilter = buildClassLabelFilter(classLabel, board);
    const subjectFilter = buildCaseInsensitiveExactFilter(subject);
    const filter = {
      isActive: true,
      classLabel: classFilter || classLabel,
      subject: subjectFilter || subject,
    };
    applyBoardFilter(filter, board);

    const rows = await AiToolTopic.find(filter).select('topicName').lean();
    const topics = uniqueSortedChapterTopics(rows.map((row) => normalizeText(row.topicName)));
    return res.json({
      success: true,
      data: toOptionRows(topics),
      message: topics.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listTopics:', error);
    return res.status(500).json({ success: false, message: 'Failed to list topics' });
  }
};

/** GET /api/curriculum/subtopics?classId=&subjectId=&topicId=&board= */
export const listSubtopics = async (req, res) => {
  try {
    const classLabel = normalizeClassId(req.query.classId);
    const subject = normalizeText(req.query.subjectId);
    const topicName = normalizeText(req.query.topicId);
    const board = normalizeText(req.query.board);
    if (!classLabel || !subject || !topicName) {
      return res.status(400).json({
        success: false,
        message: 'classId, subjectId, and topicId are required',
      });
    }

    const classFilter = buildClassLabelFilter(classLabel, board);
    const subjectFilter = buildCaseInsensitiveExactFilter(subject);
    const topicFilter = buildCaseInsensitiveExactFilter(topicName);
    const filter = {
      isActive: true,
      classLabel: classFilter || classLabel,
      subject: subjectFilter || subject,
      topicName: topicFilter || topicName,
    };
    applyBoardFilter(filter, board);

    const rows = await AiToolTopic.find(filter).select('subTopic sortOrder createdAt').lean();
    const subTopics = orderedUniqueSubTopics(rows);
    return res.json({
      success: true,
      data: toOptionRows(subTopics),
      message: subTopics.length === 0 ? 'No data available' : undefined,
    });
  } catch (error) {
    console.error('listSubtopics:', error);
    return res.status(500).json({ success: false, message: 'Failed to list subtopics' });
  }
};
