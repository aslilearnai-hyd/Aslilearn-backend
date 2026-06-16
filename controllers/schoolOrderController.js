import mongoose from 'mongoose';
import SchoolOrder, { formatOrder } from '../models/SchoolOrder.js';

async function findSchoolOrder(id) {
  const key = String(id || '').trim();
  if (!key || key === 'undefined' || key === 'null') return null;

  if (mongoose.Types.ObjectId.isValid(key)) {
    const byId = await SchoolOrder.findById(key);
    if (byId) return byId;
  }

  return SchoolOrder.findOne({ orderNumber: key });
}

async function nextOrderNumber() {
  const count = await SchoolOrder.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  const year = new Date().getFullYear();
  return `ORD-${year}-${seq}`;
}

function normalizePayload(body, status, userId) {
  const financial = body.financial || {};
  const payload = {
    schoolId: String(body.schoolId || ''),
    adminId: String(body.adminId || ''),
    schoolName: String(body.schoolName || '').trim(),
    brand: String(body.brand || '').trim(),
    academicYear: String(body.academicYear || '2026-27'),
    products: Array.isArray(body.products) ? body.products : [],
    financial: {
      orderType: financial.orderType || '',
      category: financial.category || '',
      paymentTerms: financial.paymentTerms || '',
      paymentDueDate: financial.paymentDueDate || '',
      notes: financial.notes || '',
      documentName: financial.documentName || null,
      documentUrl: financial.documentUrl || null,
      itemDiscount: Number(financial.itemDiscount) || 0,
      specialDiscount: Number(financial.specialDiscount) || 0,
      advanceReceived: Number(financial.advanceReceived) || 0,
    },
    computed: {
      subtotal: Number(body.computed?.subtotal) || 0,
      gst: Number(body.computed?.gst) || 0,
      grandTotal: Number(body.computed?.grandTotal) || 0,
      balance: Number(body.computed?.balance) || 0,
    },
    status,
  };
  if (userId !== undefined) {
    payload.createdBy = userId || null;
  }
  return payload;
}

export async function createSchoolOrder(req, res) {
  try {
    const status = req.path.includes('/draft') ? 'draft' : 'confirmed';
    const userId =
      req.user?._id?.toString?.() ||
      req.user?.id?.toString?.() ||
      req.user?.email ||
      null;
    const payload = normalizePayload(req.body, status, userId);

    if (!payload.schoolName) {
      return res.status(400).json({ success: false, message: 'School name is required' });
    }
    if (!payload.products.length) {
      return res.status(400).json({ success: false, message: 'At least one product is required' });
    }

    payload.orderNumber = await nextOrderNumber();

    const order = await SchoolOrder.create(payload);
    res.status(201).json({
      success: true,
      message: status === 'draft' ? 'Draft saved successfully' : 'Order confirmed successfully',
      data: formatOrder(order),
    });
  } catch (error) {
    console.error('Create school order error:', error);
    res.status(500).json({ success: false, message: 'Failed to save order' });
  }
}

export async function listSchoolOrders(req, res) {
  try {
    const status = req.query.status;
    const filter = {};
    if (status === 'draft' || status === 'confirmed') {
      filter.status = status;
    }

    const orders = await SchoolOrder.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      success: true,
      data: orders.map(formatOrder),
    });
  } catch (error) {
    console.error('List school orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
}

export async function getSchoolOrderById(req, res) {
  try {
    const order = await findSchoolOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, data: formatOrder(order) });
  } catch (error) {
    console.error('Get school order error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
}

export async function updateSchoolOrder(req, res) {
  try {
    const order = await findSchoolOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const status =
      req.body.status === 'draft' || req.body.status === 'confirmed'
        ? req.body.status
        : order.status;
    const payload = normalizePayload(req.body, status);

    if (!payload.schoolName) {
      return res.status(400).json({ success: false, message: 'School name is required' });
    }
    if (!payload.products.length) {
      return res.status(400).json({ success: false, message: 'At least one product is required' });
    }

    Object.assign(order, payload);
    await order.save();

    res.json({
      success: true,
      message: status === 'draft' ? 'Draft updated successfully' : 'Order updated successfully',
      data: formatOrder(order),
    });
  } catch (error) {
    console.error('Update school order error:', error);
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
}

export async function deleteSchoolOrder(req, res) {
  try {
    const order = await findSchoolOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    await SchoolOrder.findByIdAndDelete(order._id);
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete school order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
}

export async function uploadSchoolOrderDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const url = `/uploads/orders/documents/${req.file.filename}`;
    res.json({
      success: true,
      data: { url, name: req.file.originalname },
    });
  } catch (error) {
    console.error('Upload order document error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
}
