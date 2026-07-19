/** Commercial / curriculum product lines (separate from school board codes). */
export const PRODUCT_IIT = 'IIT';

export const PRODUCTS = [PRODUCT_IIT];

/** IIT track categories. Empty string on catalog rows = normal curriculum (non-IIT). */
export const IIT_CATEGORIES = ['ALPHA', 'BETA', 'GAMMA'];

/** Reserved UI slot for a future fourth IIT curriculum track (not assignable yet). */
export const IIT_FUTURE_CATEGORY_SLOT = {
  id: 'FUTURE',
  label: 'Future curriculum',
  enabled: false,
};

export const PRODUCT_CATEGORY_NONE = '';

export function normalizeIitCategory(value) {
  if (value === undefined || value === null || value === '') return PRODUCT_CATEGORY_NONE;
  const u = String(value).toUpperCase().trim();
  return IIT_CATEGORIES.includes(u) ? u : PRODUCT_CATEGORY_NONE;
}

export function isValidIitCategory(value) {
  if (value === undefined || value === null || value === '') return false;
  return IIT_CATEGORIES.includes(String(value).toUpperCase().trim());
}

/** Normalize a school/user assignment list; drops unknowns and duplicates. */
export function normalizeIitCategories(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const c = normalizeIitCategory(item);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function formatIitCategoryLabel(value) {
  const c = normalizeIitCategory(value);
  if (!c) return '';
  return c.charAt(0) + c.slice(1).toLowerCase();
}

/**
 * School may see a catalog row when productCategory is empty (general)
 * or matches one of the school's assigned IIT categories.
 */
export function schoolCanAccessProductCategory(schoolIitCategories, productCategory) {
  const cat = normalizeIitCategory(productCategory);
  if (!cat) return true;
  const allowed = normalizeIitCategories(schoolIitCategories);
  return allowed.includes(cat);
}
