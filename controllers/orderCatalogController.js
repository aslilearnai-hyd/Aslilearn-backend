import OrderCatalogProduct, {
  DEFAULT_ORDER_CATALOG,
  formatCatalogProduct,
} from '../models/OrderCatalogProduct.js';
import OrderCatalogMeta from '../models/OrderCatalogMeta.js';

async function ensureDefaultCatalog() {
  const initialized = await OrderCatalogMeta.findOne({ key: 'default' }).lean();
  if (initialized) return;

  const count = await OrderCatalogProduct.countDocuments();
  if (count === 0) {
    await OrderCatalogProduct.insertMany(DEFAULT_ORDER_CATALOG);
  }
  await OrderCatalogMeta.findOneAndUpdate(
    { key: 'default' },
    { $set: { initialized: true } },
    { upsert: true },
  );
}

async function findCatalogProduct(catalogId) {
  const key = String(catalogId || '').trim();
  if (!key) return null;
  return OrderCatalogProduct.findOne({ catalogId: key });
}

export async function listOrderCatalog(req, res) {
  try {
    await ensureDefaultCatalog();
    const rows = await OrderCatalogProduct.find().sort({ createdAt: 1 }).lean();
    res.json({
      success: true,
      data: rows.map(formatCatalogProduct),
    });
  } catch (error) {
    console.error('List order catalog error:', error);
    res.status(500).json({ success: false, message: 'Failed to load product catalog' });
  }
}

export async function createOrderCatalogProduct(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    const classLabel = String(req.body.classLabel || '').trim();
    const price = Number(req.body.price);
    const catalogId =
      String(req.body.id || req.body.catalogId || '').trim() ||
      `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }
    if (!classLabel) {
      return res.status(400).json({ success: false, message: 'Class / bundle label is required' });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, message: 'Valid price is required' });
    }

    const existing = await OrderCatalogProduct.findOne({ catalogId });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Product already exists in catalog' });
    }

    const product = await OrderCatalogProduct.create({
      catalogId,
      name,
      classLabel,
      price,
      isCustom: Boolean(req.body.isCustom ?? catalogId.startsWith('custom-')),
    });

    res.status(201).json({
      success: true,
      message: 'Product added to catalog',
      data: formatCatalogProduct(product),
    });
  } catch (error) {
    console.error('Create order catalog product error:', error);
    res.status(500).json({ success: false, message: 'Failed to add catalog product' });
  }
}

export async function updateOrderCatalogProduct(req, res) {
  try {
    const product = await findCatalogProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Catalog product not found' });
    }

    const name = req.body.name !== undefined ? String(req.body.name).trim() : product.name;
    const classLabel =
      req.body.classLabel !== undefined ? String(req.body.classLabel).trim() : product.classLabel;
    const price = req.body.price !== undefined ? Number(req.body.price) : product.price;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }
    if (!classLabel) {
      return res.status(400).json({ success: false, message: 'Class / bundle label is required' });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, message: 'Valid price is required' });
    }

    product.name = name;
    product.classLabel = classLabel;
    product.price = price;
    await product.save();

    res.json({
      success: true,
      message: 'Catalog product updated',
      data: formatCatalogProduct(product),
    });
  } catch (error) {
    console.error('Update order catalog product error:', error);
    res.status(500).json({ success: false, message: 'Failed to update catalog product' });
  }
}

export async function deleteOrderCatalogProduct(req, res) {
  try {
    const product = await findCatalogProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Catalog product not found' });
    }

    await OrderCatalogProduct.deleteOne({ _id: product._id });
    res.json({ success: true, message: 'Catalog product deleted' });
  } catch (error) {
    console.error('Delete order catalog product error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete catalog product' });
  }
}
