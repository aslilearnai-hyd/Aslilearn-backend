/**
 * Product category helpers — built-in Alpha/Beta/Gamma plus Super Admin custom codes.
 * Category list is cached from ProductCategory collection when available.
 */
import ProductCategory from '../models/ProductCategory.js';

export const PRODUCT_IIT = 'IIT';
export const PRODUCTS = [PRODUCT_IIT];

/** Default seeded tracks (always present). */
export const IIT_CATEGORIES = ['ALPHA', 'BETA', 'GAMMA', 'DELTA'];

export const PRODUCT_CATEGORY_NONE = '';

/** @type {string[] | null} */
let cachedActiveCodes = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

export function invalidateProductCategoryCache() {
  cachedActiveCodes = null;
  cacheLoadedAt = 0;
}

export async function ensureDefaultProductCategories() {
  const defaults = [
    { code: 'ALPHA', label: 'Alpha', sortOrder: 1, description: 'IIT Alpha curriculum track' },
    { code: 'BETA', label: 'Beta', sortOrder: 2, description: 'IIT Beta curriculum track' },
    { code: 'GAMMA', label: 'Gamma', sortOrder: 3, description: 'IIT Gamma curriculum track' },
    { code: 'DELTA', label: 'Delta', sortOrder: 4, description: 'IIT Delta curriculum track' },
  ];
  for (const row of defaults) {
    // Mongo forbids the same path in both $set and $setOnInsert (ConflictingUpdateOperators).
    await ProductCategory.findOneAndUpdate(
      { code: row.code },
      {
        $setOnInsert: {
          code: row.code,
          product: PRODUCT_IIT,
          isActive: true,
        },
        $set: {
          label: row.label,
          description: row.description,
          sortOrder: row.sortOrder,
          isBuiltIn: true,
        },
      },
      { upsert: true, new: true }
    );
  }
  invalidateProductCategoryCache();
}

export async function getActiveProductCategoryCodes({ force = false, product = PRODUCT_IIT } = {}) {
  const now = Date.now();
  if (
    !force &&
    cachedActiveCodes &&
    now - cacheLoadedAt < CACHE_TTL_MS
  ) {
    return cachedActiveCodes;
  }
  try {
    await ensureDefaultProductCategories();
    const query = { isActive: true };
    if (product) query.product = String(product).toUpperCase().trim();
    const rows = await ProductCategory.find(query)
      .sort({ sortOrder: 1, label: 1 })
      .select('code')
      .lean();
    const codes = rows.map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
    cachedActiveCodes = codes.length ? codes : [...IIT_CATEGORIES];
    cacheLoadedAt = now;
    return cachedActiveCodes;
  } catch {
    return [...IIT_CATEGORIES];
  }
}

export async function listProductCategories({ includeInactive = false, product = null } = {}) {
  try {
    await ensureDefaultProductCategories();
  } catch (err) {
    console.warn('ensureDefaultProductCategories failed:', err?.message || err);
  }
  const query = includeInactive ? {} : { isActive: true };
  if (product) {
    query.product = String(product).toUpperCase().trim();
  }
  return ProductCategory.find(query).sort({ sortOrder: 1, label: 1 }).lean();
}

export function normalizeCategoryCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export function normalizeIitCategory(value, allowedCodes = null) {
  if (value === undefined || value === null || value === '') return PRODUCT_CATEGORY_NONE;
  const u = normalizeCategoryCode(value);
  if (!u) return PRODUCT_CATEGORY_NONE;
  const allowed = Array.isArray(allowedCodes) && allowedCodes.length
    ? allowedCodes
    : cachedActiveCodes && cachedActiveCodes.length
      ? cachedActiveCodes
      : IIT_CATEGORIES;
  return allowed.includes(u) ? u : PRODUCT_CATEGORY_NONE;
}

/** Sync check used when cache may be cold — accepts any CODE-like string; DB validates on write. */
export function normalizeIitCategoryLoose(value) {
  if (value === undefined || value === null || value === '') return PRODUCT_CATEGORY_NONE;
  let u = normalizeCategoryCode(value) || PRODUCT_CATEGORY_NONE;
  if (!u) return PRODUCT_CATEGORY_NONE;
  // UI labels like "IIT Alpha" / "IIT_ALPHA" → ALPHA
  if (u.startsWith('IIT_')) u = u.slice(4);
  if (u === 'GENERAL' || u === 'NONE' || u === 'ALL') return PRODUCT_CATEGORY_NONE;
  return u;
}

export function isValidIitCategory(value, allowedCodes = null) {
  const c = normalizeIitCategory(value, allowedCodes);
  return Boolean(c);
}

export function normalizeIitCategories(list, allowedCodes = null) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const c = normalizeIitCategoryLoose(item);
    if (!c || seen.has(c)) continue;
    if (allowedCodes && allowedCodes.length && !allowedCodes.includes(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function formatIitCategoryLabel(value, labelMap = null) {
  const c = normalizeIitCategoryLoose(value);
  if (!c) return '';
  if (labelMap && labelMap[c]) return labelMap[c];
  return c
    .split('_')
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(' ');
}

export function schoolCanAccessProductCategory(schoolIitCategories, productCategory) {
  const cat = normalizeIitCategoryLoose(productCategory);
  if (!cat) return true;
  const allowed = normalizeIitCategories(schoolIitCategories);
  return allowed.includes(cat);
}

/** @deprecated — Delta is seeded as a built-in track; custom codes still work via Products. */
export const IIT_FUTURE_CATEGORY_SLOT = {
  id: 'DELTA',
  label: 'Delta',
  enabled: true,
};
