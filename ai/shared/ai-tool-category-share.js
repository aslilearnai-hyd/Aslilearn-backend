import AiToolCategoryShare from '../../models/AiToolCategoryShare.js';
import { lockBoardKey } from '../../utils/board-label.js';
import {
  buildClassLabelMongoFilter,
  buildSubjectMongoFilter,
  mergeMongoFilters,
  normalizeClassId,
  normalizeMatchText,
} from './ai-tool-data-match.js';
import { applyProductCategoryMongoFilter } from './ai-tool-topic-taxonomy.js';
import { normalizeIitCategoryLoose } from '../../constants/products.js';

const CACHE_TTL_MS = 60_000;
const MAX_CHAIN_DEPTH = 4;

let cache = { at: 0, rows: [] };

/** Same rules as topic categories: '' = General, null = "no category filter". */
function normalizeCategory(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw || /^(NONE|GENERAL|__GENERAL__)$/i.test(raw)) return '';
  return normalizeIitCategoryLoose(raw) || '';
}

function boardKey(value) {
  return lockBoardKey(value) || normalizeMatchText(value).toUpperCase();
}

function classKey(value) {
  return normalizeClassId(value).toLowerCase();
}

function subjectKey(value) {
  return normalizeMatchText(value).toLowerCase();
}

export function invalidateAiToolCategoryShareCache() {
  cache = { at: 0, rows: [] };
}

async function loadShares() {
  if (cache.rows.length && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await AiToolCategoryShare.find({ isActive: true })
      .select('board classLabel subject targetCategory sourceCategory')
      .lean();
    cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn('[ai-tool-category-share] load failed:', String(err?.message || err).slice(0, 200));
    return cache.rows;
  }
}

/**
 * Shares that apply to a lookup. Subject-specific rules win over class-wide ones.
 * When `subject` is omitted (admin browsing), every share for the class is returned.
 */
async function matchingShares({ board, classLabel, subject, productCategory }) {
  const target = normalizeCategory(productCategory);
  if (target === null) return [];

  const rows = await loadShares();
  if (!rows.length) return [];

  const bKey = boardKey(board);
  const cKey = classKey(classLabel);
  const sKey = subjectKey(subject);

  return rows.filter((row) => {
    if (normalizeCategory(row.targetCategory) !== target) return false;
    if (bKey && boardKey(row.board) !== bKey) return false;
    if (cKey && classKey(row.classLabel) !== cKey) return false;
    if (sKey && row.subject && subjectKey(row.subject) !== sKey) return false;
    return true;
  });
}

/**
 * Delivery path: swap the requested category for the one that actually owns the
 * content. Needs class + subject, which every tool lookup provides.
 */
export async function resolveSharedProductCategory({
  board,
  classLabel,
  subject,
  productCategory,
}) {
  const target = normalizeCategory(productCategory);
  if (target === null) return productCategory;

  let current = target;
  const seen = new Set([current]);

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    const shares = await matchingShares({
      board,
      classLabel,
      subject,
      productCategory: current,
    });
    if (!shares.length) break;

    // Subject-specific share beats a class-wide one.
    const exact = shares.find((row) => row.subject) || shares[0];
    const next = normalizeCategory(exact.sourceCategory) ?? '';
    if (next === current || seen.has(next)) break;
    seen.add(next);
    current = next;
  }

  return current;
}

/**
 * Admin/browse path: read the category's own rows plus any category it borrows
 * from, scoped to the exact class/subject each share covers.
 */
export async function buildProductCategoryReadFilter({
  board,
  classLabel,
  subject,
  productCategory,
}) {
  const base = applyProductCategoryMongoFilter({}, productCategory);
  const shares = await matchingShares({ board, classLabel, subject, productCategory });
  if (!shares.length) return base;

  const clauses = [base];
  for (const share of shares) {
    let clause = applyProductCategoryMongoFilter({}, share.sourceCategory);
    const classClause = buildClassLabelMongoFilter(share.classLabel, share.board || board);
    if (classClause && Object.keys(classClause).length) {
      clause = mergeMongoFilters(clause, classClause);
    }
    if (share.subject) {
      const subjectClause = buildSubjectMongoFilter(share.subject, share.board || board);
      if (subjectClause && Object.keys(subjectClause).length) {
        clause = mergeMongoFilters(clause, subjectClause);
      }
    }
    clauses.push(clause);
  }

  return { $or: clauses };
}

/** UI banner data: what the selected category currently borrows. */
export async function describeCategoryShares({ board, classLabel, subject, productCategory }) {
  const shares = await matchingShares({ board, classLabel, subject, productCategory });
  return shares.map((row) => ({
    board: row.board,
    classLabel: row.classLabel,
    subject: row.subject || '',
    targetCategory: normalizeCategory(row.targetCategory) ?? '',
    sourceCategory: normalizeCategory(row.sourceCategory) ?? '',
  }));
}

export { normalizeCategory as normalizeShareCategory };
