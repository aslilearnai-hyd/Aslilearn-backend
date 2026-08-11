import ProductCategory from '../models/ProductCategory.js';
import {
  PRODUCT_IIT,
  ensureDefaultProductCategories,
  invalidateProductCategoryCache,
  listProductCategories,
  normalizeCategoryCode,
  formatIitCategoryLabel,
} from '../constants/products.js';

/** GET /api/super-admin/product-categories */
export async function getProductCategories(req, res) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const product = String(req.query.product || '').toUpperCase().trim();
    const rows = await listProductCategories({ includeInactive, product: product || null });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: String(r._id),
        code: r.code,
        label: r.label || formatIitCategoryLabel(r.code),
        product: r.product || PRODUCT_IIT,
        description: r.description || '',
        isActive: r.isActive !== false,
        isBuiltIn: Boolean(r.isBuiltIn),
        sortOrder: r.sortOrder ?? 100,
      })),
    });
  } catch (error) {
    console.error('getProductCategories:', error);
    res.status(500).json({ success: false, message: 'Failed to load product categories' });
  }
}

/** Public-ish list for forms (active only) — same auth as super-admin router. */
export async function getActiveProductCategoryCodesHandler(req, res) {
  try {
    const product = String(req.query.product || PRODUCT_IIT).toUpperCase().trim();
    const rows = await listProductCategories({ includeInactive: false, product });
    res.json({
      success: true,
      data: {
        product,
        categories: rows.map((r) => ({
          code: r.code,
          label: r.label || formatIitCategoryLabel(r.code),
        })),
        codes: rows.map((r) => r.code),
      },
    });
  } catch (error) {
    console.error('getActiveProductCategoryCodesHandler:', error);
    res.status(500).json({ success: false, message: 'Failed to load categories' });
  }
}

/** POST /api/super-admin/product-categories */
export async function createProductCategory(req, res) {
  try {
    await ensureDefaultProductCategories();
    const label = String(req.body.label || '').trim();
    let code = normalizeCategoryCode(req.body.code || label);
    const description = String(req.body.description || '').trim();

    if (!label) {
      return res.status(400).json({ success: false, message: 'Label is required' });
    }
    if (!code || code.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Code must be at least 2 characters (letters, numbers, underscore)',
      });
    }

    const existing = await ProductCategory.findOne({ code });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Category code ${code} already exists`,
      });
    }

    const maxSort = await ProductCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    const row = await ProductCategory.create({
      code,
      label,
      product: PRODUCT_IIT,
      description,
      isActive: true,
      isBuiltIn: false,
      sortOrder: (maxSort?.sortOrder || 10) + 1,
    });

    invalidateProductCategoryCache();

    res.status(201).json({
      success: true,
      message: `Category ${label} created`,
      data: {
        id: String(row._id),
        code: row.code,
        label: row.label,
        product: row.product,
        description: row.description,
        isActive: row.isActive,
        isBuiltIn: row.isBuiltIn,
        sortOrder: row.sortOrder,
      },
    });
  } catch (error) {
    console.error('createProductCategory:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Category code already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create category' });
  }
}

/** PUT /api/super-admin/product-categories/:id */
export async function updateProductCategory(req, res) {
  try {
    const row = await ProductCategory.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (req.body.label !== undefined) {
      const label = String(req.body.label || '').trim();
      if (!label) {
        return res.status(400).json({ success: false, message: 'Label cannot be empty' });
      }
      row.label = label;
    }
    if (req.body.description !== undefined) {
      row.description = String(req.body.description || '').trim();
    }
    if (req.body.isActive !== undefined) {
      row.isActive = Boolean(req.body.isActive);
    }
    if (req.body.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder))) {
      row.sortOrder = Number(req.body.sortOrder);
    }
    // Codes are immutable once created (referenced by subjects/books/schools).
    await row.save();
    invalidateProductCategoryCache();

    res.json({
      success: true,
      message: 'Category updated',
      data: {
        id: String(row._id),
        code: row.code,
        label: row.label,
        product: row.product,
        description: row.description,
        isActive: row.isActive,
        isBuiltIn: row.isBuiltIn,
        sortOrder: row.sortOrder,
      },
    });
  } catch (error) {
    console.error('updateProductCategory:', error);
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
}

/** DELETE /api/super-admin/product-categories/:id — permanent delete.
 *  Active built-in Alpha/Beta/Gamma/Delta cannot be removed.
 *  Soft-deactivated leftovers (and all custom tracks) are removed from the DB.
 */
export async function deleteProductCategory(req, res) {
  try {
    const row = await ProductCategory.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    if (row.isBuiltIn && row.isActive !== false) {
      return res.status(400).json({
        success: false,
        message: 'Built-in categories (Alpha / Beta / Gamma / Delta) cannot be deleted.',
      });
    }
    const label = row.label || row.code;
    await ProductCategory.deleteOne({ _id: row._id });
    invalidateProductCategoryCache();
    res.json({ success: true, message: `${label} deleted` });
  } catch (error) {
    console.error('deleteProductCategory:', error);
    res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
}
