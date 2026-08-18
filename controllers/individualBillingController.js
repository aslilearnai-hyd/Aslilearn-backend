import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import {
  isRazorpayConfigured,
  createRazorpayOrder,
  verifyRazorpaySignature,
  getRazorpayKeyId,
  describeRazorpayConfig,
} from '../services/razorpayService.js';
import {
  publicPlanCatalog,
  resolveIndividualPlan,
  subscriptionExpiryDate,
  getIndividualPlanRates,
  saveIndividualPlanRates,
  buildPlanCatalog,
} from '../utils/individual-plans.js';
import { IIT_CATEGORIES } from '../constants/products.js';

function normalizeTrack(raw) {
  const v = String(raw || '').toUpperCase().trim();
  if (!v) return '';
  return IIT_CATEGORIES.includes(v) ? v : '';
}

async function loadIndividualAccount(req) {
  const role = String(req.user?.role || '').toLowerCase();
  const id = req.userId;
  if (role === 'teacher') {
    const teacher = await Teacher.findById(id);
    if (!teacher || !teacher.isIndividualAccount) return { ok: false, message: 'Individual teacher account not found.' };
    return { ok: true, role: 'teacher', doc: teacher };
  }
  const user = await User.findById(id);
  if (!user || !user.isIndividualAccount) return { ok: false, message: 'Individual student account not found.' };
  return { ok: true, role: 'student', doc: user };
}

export async function getBillingConfig(req, res) {
  try {
    const plans = await publicPlanCatalog();
    res.json({
      success: true,
      configured: isRazorpayConfigured(),
      keyId: isRazorpayConfigured() ? getRazorpayKeyId() : '',
      plans,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Could not load plans.' });
  }
}

export async function getIndividualPlanRatesAdmin(req, res) {
  try {
    const rates = await getIndividualPlanRates();
    const catalog = buildPlanCatalog(rates);
    res.json({ success: true, rates, preview: { student: catalog.student, teacher: catalog.teacher } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Could not load rates.' });
  }
}

export async function saveIndividualPlanRatesAdmin(req, res) {
  try {
    const rates = await saveIndividualPlanRates(req.body || {}, req.user?.email || req.userId || '');
    const catalog = buildPlanCatalog(rates);
    res.json({
      success: true,
      message: 'Individual plan rates saved. Checkout will use these prices.',
      rates,
      preview: { student: catalog.student, teacher: catalog.teacher },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Could not save rates.' });
  }
}

export async function createIndividualCheckoutOrder(req, res) {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Payments are not configured yet. Please try again later.',
      });
    }

    const loaded = await loadIndividualAccount(req);
    if (!loaded.ok) return res.status(403).json({ success: false, message: loaded.message });

    const packageType = req.body?.packageType;
    const period = req.body?.period;
    const plan = await resolveIndividualPlan({ role: loaded.role, packageType, period });
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Choose Boards, IIT, or both.' });
    }

    const classLabel = String(req.body?.classLabel || loaded.doc.classNumber || '').trim();
    const track = plan.packageType === 'board' ? '' : normalizeTrack(req.body?.track);
    if (plan.packageType !== 'board' && !track) {
      return res.status(400).json({
        success: false,
        message: 'Pick Alpha or Beta for the IIT package.',
      });
    }

    const receipt = `ind${String(loaded.doc._id).slice(-8)}${Date.now().toString(36)}`.slice(0, 40);
    const order = await createRazorpayOrder({
      amountPaise: plan.amountPaise,
      receipt,
      notes: {
        userId: String(loaded.doc._id),
        role: loaded.role,
        packageType: plan.packageType,
        period: plan.period,
        classLabel,
        track,
      },
      customer: {
        name: loaded.doc.fullName || loaded.doc.name,
        email: loaded.doc.email,
      },
    });

    return res.json({
      success: true,
      keyId: getRazorpayKeyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      plan,
      prefill: {
        name: loaded.doc.fullName || loaded.doc.name || '',
        email: loaded.doc.email || '',
        contact: loaded.doc.phone || loaded.doc.mobile || '',
      },
    });
  } catch (error) {
    const msg =
      error.response?.data?.error?.description ||
      error.response?.data?.message ||
      error.message ||
      'Could not start payment.';
    console.error('createIndividualCheckoutOrder:', msg, error.response?.data || error, describeRazorpayConfig());
    return res.status(500).json({
      success: false,
      message: 'Payment is temporarily unavailable. Please try again in a few minutes.',
    });
  }
}

export async function verifyIndividualCheckout(req, res) {
  try {
    const loaded = await loadIndividualAccount(req);
    if (!loaded.ok) return res.status(403).json({ success: false, message: loaded.message });

    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();
    const packageType = req.body?.packageType;
    const period = req.body?.period;
    const plan = await resolveIndividualPlan({ role: loaded.role, packageType, period });

    if (!orderId || !paymentId || !signature || !plan) {
      return res.status(400).json({ success: false, message: 'Payment details are incomplete.' });
    }

    if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, message: 'Payment signature could not be verified.' });
    }

    const track = plan.packageType === 'board' ? '' : normalizeTrack(req.body?.track);
    const classLabel = String(req.body?.classLabel || loaded.doc.classNumber || '').trim();
    const expiresAt = subscriptionExpiryDate(plan.period);
    const courses =
      plan.packageType === 'board'
        ? ['Board Exams']
        : plan.packageType === 'iit'
          ? ['IIT Foundation']
          : ['Board Exams', 'IIT Foundation'];

    loaded.doc.subscriptionStatus = 'active';
    loaded.doc.paidPackage = plan.packageType;
    loaded.doc.subscriptionPeriod = plan.period;
    loaded.doc.subscriptionExpiresAt = expiresAt;
    loaded.doc.razorpayOrderId = orderId;
    loaded.doc.razorpayPaymentId = paymentId;
    loaded.doc.trialPaidAt = new Date();
    loaded.doc.trialPaymentAmount = plan.amountInr;
    loaded.doc.trialPaymentMethod = 'razorpay';
    loaded.doc.trialPaymentReference = paymentId;
    if (classLabel) loaded.doc.classNumber = classLabel;
    loaded.doc.iitCategories = track ? [track] : [];
    loaded.doc.interestedCourses = courses;
    if (loaded.doc.schema?.paths?.isAsliPrepExclusive) {
      loaded.doc.isAsliPrepExclusive = Boolean(track);
    }
    await loaded.doc.save();

    return res.json({
      success: true,
      message: 'Payment successful. Your plan is now active.',
      subscriptionStatus: 'active',
      paidPackage: plan.packageType,
      subscriptionExpiresAt: expiresAt,
      redirect:
        loaded.role === 'teacher' ? '/teacher/dashboard' : '/dashboard',
    });
  } catch (error) {
    console.error('verifyIndividualCheckout:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not confirm payment.',
    });
  }
}
