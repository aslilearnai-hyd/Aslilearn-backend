import express from 'express';
import { verifyToken, verifySuperAdmin } from '../middleware/auth.js';
import { getCalendarEvents, createCalendarEvent } from '../controllers/calendarController.js';

const router = express.Router();

router.get('/calendar/events', verifyToken, verifySuperAdmin, getCalendarEvents);
router.post('/calendar/events', verifyToken, verifySuperAdmin, createCalendarEvent);

router.get('/product-categories', async (req, res) => {
  try {
    const { listProductCategories, PRODUCT_IIT, formatIitCategoryLabel } = await import(
      '../constants/products.js'
    );
    const product = String(req.query.product || '').toUpperCase().trim();
    const rows = await listProductCategories({ includeInactive: false, product: product || null });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: String(r._id),
        code: r.code,
        label: r.label || formatIitCategoryLabel(r.code),
        product: r.product || PRODUCT_IIT,
        description: r.description || '',
        isActive: true,
        isBuiltIn: Boolean(r.isBuiltIn),
        sortOrder: r.sortOrder ?? 100,
      })),
    });
  } catch (error) {
    console.error('GET /api/product-categories:', error);
    res.status(500).json({ success: false, message: 'Failed to load product categories' });
  }
});

export default router;
