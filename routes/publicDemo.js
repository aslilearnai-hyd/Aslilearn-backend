import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import DemoLead from '../models/DemoLead.js';

const router = express.Router();

const demoLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: 'Too many demo requests. Please try again later.',
    }),
});

function requireString(obj, key, min = 1, max = 500) {
  const v = String(obj?.[key] ?? '').trim();
  if (v.length < min || v.length > max) return null;
  return v;
}

router.post('/demo-leads', demoLeadLimiter, async (req, res) => {
  try {
    const role = String(req.body?.role || '').trim();
    if (!['school_admin', 'teacher', 'student_parent'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    const email = requireString(req.body, 'email', 5, 120);
    const phone = requireString(req.body, 'phone', 8, 30);
    if (!email || !phone) {
      return res.status(400).json({ success: false, message: 'Email and phone are required' });
    }

    if (role === 'school_admin') {
      if (!requireString(req.body, 'schoolName', 2, 120) || !requireString(req.body, 'contactName', 2, 80)) {
        return res.status(400).json({ success: false, message: 'School name and contact name are required' });
      }
    }
    if (role === 'teacher') {
      if (!requireString(req.body, 'teacherName', 2, 80) || !requireString(req.body, 'schoolName', 2, 120)) {
        return res.status(400).json({ success: false, message: 'Teacher name and school name are required' });
      }
    }
    if (role === 'student_parent') {
      if (!requireString(req.body, 'studentName', 2, 80) || !requireString(req.body, 'parentName', 2, 80)) {
        return res.status(400).json({ success: false, message: 'Student and parent names are required' });
      }
    }

    const leadId = `DL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const doc = await DemoLead.create({
      leadId,
      role,
      payload: req.body || {},
      sourcePage: String(req.body?.sourcePage || '/book-a-demo').slice(0, 200),
      campaign: String(req.body?.campaign || '').slice(0, 500),
    });

    console.log('[DEMO_LEAD]', { leadId: doc.leadId, role: doc.role });

    return res.status(201).json({
      success: true,
      message: 'Demo request received',
      data: { leadId: doc.leadId, id: doc._id },
    });
  } catch (err) {
    console.error('demo-leads error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save demo request' });
  }
});

export default router;
