import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import RazorpayPaymentReceipt from '../models/RazorpayPaymentReceipt.js';
import {
  isRazorpayConfigured,
  createRazorpayOrder,
  verifyRazorpaySignature,
  getRazorpayKeyId,
  describeRazorpayConfig,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  validateRazorpayCheckoutEvidence,
} from '../services/razorpayService.js';
import {
  publicPlanCatalog,
  resolveIndividualPlan,
  subscriptionExpiryDate,
  getIndividualPlanRates,
  saveIndividualPlanRates,
  buildPlanCatalog,
} from '../utils/individual-plans.js';
import { buildIndividualReceipt } from '../utils/individualAccount.js';
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
  const schoolManaged = Boolean(user && user.role === 'student' && !user.isIndividualAccount && user.schoolStudentSubscriptionEnabled);
  if (!user || (!user.isIndividualAccount && !schoolManaged)) return { ok: false, message: 'Student subscription account not found.' };
  return { ok: true, role: 'student', doc: user, schoolManaged };
}

function schoolStudentPlan(doc) {
  const amountInr = Math.max(0, Number(doc?.schoolStudentAnnualPriceInr) || 0);
  return {
    packageType: 'school',
    period: 'year',
    label: 'School student yearly plan',
    amountInr,
    amountPaise: Math.round(amountInr * 100),
  };
}

export async function getCurrentStudentBillingPlan(req, res) {
  try {
    const loaded = await loadIndividualAccount(req);
    if (!loaded.ok) return res.status(403).json({ success: false, message: loaded.message });
    if (!loaded.schoolManaged) return res.json({ success: true, schoolManaged: false });
    return res.json({
      success: true,
      schoolManaged: true,
      paymentMode: loaded.doc.schoolStudentPaymentMode || 'offline',
      onlineEnabled: ['online', 'both'].includes(loaded.doc.schoolStudentPaymentMode),
      plan: schoolStudentPlan(loaded.doc),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load student plan.' });
  }
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

export async function getIndividualSubscriptionReceipt(req, res) {
  try {
    const loaded = await loadIndividualAccount(req);
    if (!loaded.ok) return res.status(403).json({ success: false, message: loaded.message });
    const receipt = buildIndividualReceipt(loaded.doc);
    return res.json({ success: true, receipt });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load receipt.' });
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

    if (loaded.schoolManaged && !['online', 'both'].includes(loaded.doc.schoolStudentPaymentMode)) {
      return res.status(403).json({ success: false, message: 'This school collects student payments offline. Please contact your school.' });
    }

    const packageType = req.body?.packageType;
    const period = req.body?.period;
    const plan = loaded.schoolManaged
      ? schoolStudentPlan(loaded.doc)
      : await resolveIndividualPlan({ role: loaded.role, packageType, period });
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Choose Boards, IIT, or both.' });
    }

    const classLabel = String(req.body?.classLabel || loaded.doc.classNumber || '').trim();
    if (loaded.schoolManaged && plan.amountPaise < 100) {
      return res.status(400).json({ success: false, message: 'The yearly student fee has not been configured. Please contact your school.' });
    }
    const track = loaded.schoolManaged || plan.packageType === 'board' ? '' : normalizeTrack(req.body?.track);
    if (!loaded.schoolManaged && plan.packageType !== 'board' && !track) {
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
  let paymentClaim = null;
  try {
    const loaded = await loadIndividualAccount(req);
    if (!loaded.ok) return res.status(403).json({ success: false, message: loaded.message });

    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: 'Payment details are incomplete.' });
    }

    if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, message: 'Payment signature could not be verified.' });
    }

    const [order, payment] = await Promise.all([
      fetchRazorpayOrder(orderId),
      fetchRazorpayPayment(paymentId),
    ]);
    const trusted = validateRazorpayCheckoutEvidence({
      order,
      payment,
      accountId: loaded.doc._id,
      role: loaded.role,
    });
    const resolvedPlan = loaded.schoolManaged
      ? schoolStudentPlan(loaded.doc)
      : await resolveIndividualPlan({
          role: loaded.role,
          packageType: trusted.packageType,
          period: trusted.period,
        });
    if (!resolvedPlan || resolvedPlan.packageType !== trusted.packageType || resolvedPlan.period !== trusted.period) {
      return res.status(400).json({ success: false, message: 'The paid order contains an invalid plan.' });
    }
    // Rates may change while a checkout is open. The immutable Razorpay order
    // amount is the paid source of truth; package/period still come only from
    // the server-written order notes.
    const plan = { ...resolvedPlan, amountPaise: trusted.amountPaise, amountInr: trusted.amountInr };
    const track = loaded.schoolManaged || plan.packageType === 'board' ? '' : normalizeTrack(trusted.track);
    if (!loaded.schoolManaged && plan.packageType !== 'board' && !track) {
      return res.status(400).json({ success: false, message: 'The paid order is missing its IIT track.' });
    }
    const classLabel = String(trusted.classLabel || loaded.doc.classNumber || '').trim();

    // Catch payments recorded before the globally unique receipt collection existed.
    const paymentLookup = {
      $or: [
        { razorpayPaymentId: paymentId },
        { trialPaymentReference: paymentId },
        { 'subscriptionPayments.paymentReference': paymentId },
      ],
    };
    const [priorUser, priorTeacher] = await Promise.all([
      User.findOne(paymentLookup).select('_id').lean(),
      Teacher.findOne(paymentLookup).select('_id').lean(),
    ]);
    const historicalOwner = priorUser?._id || priorTeacher?._id;
    if (historicalOwner && String(historicalOwner) !== String(loaded.doc._id)) {
      return res.status(409).json({ success: false, message: 'This payment has already been used.' });
    }

    const existingClaim = await RazorpayPaymentReceipt.findOne({
      $or: [{ paymentId }, { orderId }],
    });
    if (existingClaim) {
      const sameOwner =
        String(existingClaim.accountId) === String(loaded.doc._id) &&
        existingClaim.accountRole === loaded.role &&
        existingClaim.paymentId === paymentId &&
        existingClaim.orderId === orderId;
      if (!sameOwner) {
        return res.status(409).json({ success: false, message: 'This payment has already been used.' });
      }
      if (existingClaim.status === 'activated' || loaded.doc.razorpayPaymentId === paymentId) {
        if (existingClaim.status !== 'activated') {
          existingClaim.status = 'activated';
          existingClaim.activatedAt = new Date();
          await existingClaim.save();
        }
        return res.json({
          success: true,
          message: 'Payment was already applied to this account.',
          subscriptionStatus: loaded.doc.subscriptionStatus,
          paidPackage: loaded.doc.paidPackage,
          subscriptionExpiresAt: loaded.doc.subscriptionExpiresAt,
          subscriptionPeriod: loaded.doc.subscriptionPeriod,
          receipt: buildIndividualReceipt(loaded.doc),
          redirect: loaded.role === 'teacher' ? '/teacher/dashboard' : '/dashboard',
        });
      }
      if (existingClaim.status === 'processing') {
        return res.status(409).json({ success: false, message: 'This payment is already being processed.' });
      }
      existingClaim.status = 'processing';
      existingClaim.failureReason = '';
      paymentClaim = await existingClaim.save();
    } else if (historicalOwner) {
      try {
        await RazorpayPaymentReceipt.create({
          paymentId,
          orderId,
          accountId: loaded.doc._id,
          accountRole: loaded.role,
          packageType: plan.packageType,
          period: plan.period,
          amountPaise: plan.amountPaise,
          currency: 'INR',
          status: 'activated',
          activatedAt: new Date(),
        });
      } catch (claimError) {
        if (claimError?.code !== 11000) throw claimError;
      }
      return res.json({
        success: true,
        message: 'Payment was already applied to this account.',
        subscriptionStatus: loaded.doc.subscriptionStatus,
        paidPackage: loaded.doc.paidPackage,
        subscriptionExpiresAt: loaded.doc.subscriptionExpiresAt,
        subscriptionPeriod: loaded.doc.subscriptionPeriod,
        receipt: buildIndividualReceipt(loaded.doc),
        redirect: loaded.role === 'teacher' ? '/teacher/dashboard' : '/dashboard',
      });
    } else {
      try {
        paymentClaim = await RazorpayPaymentReceipt.create({
          paymentId,
          orderId,
          accountId: loaded.doc._id,
          accountRole: loaded.role,
          packageType: plan.packageType,
          period: plan.period,
          amountPaise: plan.amountPaise,
          currency: 'INR',
          status: 'processing',
        });
      } catch (claimError) {
        if (claimError?.code === 11000) {
          return res.status(409).json({ success: false, message: 'This payment has already been used.' });
        }
        throw claimError;
      }
    }

    const currentExpiry =
      loaded.doc.subscriptionExpiresAt && new Date(loaded.doc.subscriptionExpiresAt).getTime() > Date.now()
        ? new Date(loaded.doc.subscriptionExpiresAt)
        : new Date();
    const expiresAt = subscriptionExpiryDate(plan.period, currentExpiry);
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
    const priorPayments = Array.isArray(loaded.doc.subscriptionPayments) ? loaded.doc.subscriptionPayments : [];
    loaded.doc.subscriptionPayments = [
      {
        paidAt: loaded.doc.trialPaidAt,
        amountInr: plan.amountInr,
        packageType: plan.packageType,
        packageLabel: plan.label,
        period: plan.period,
        periodLabel: plan.period === 'year' ? 'Yearly' : 'Monthly',
        paymentMethod: 'razorpay',
        paymentReference: paymentId,
        razorpayOrderId: orderId,
        validUntil: expiresAt,
        status: 'paid',
        source: 'razorpay',
      },
      ...priorPayments.filter((entry) => String(entry?.paymentReference || '') !== paymentId),
    ].slice(0, 20);
    if (!loaded.schoolManaged) {
      if (classLabel) loaded.doc.classNumber = classLabel;
      loaded.doc.iitCategories = track ? [track] : [];
      loaded.doc.interestedCourses = courses;
      if (loaded.doc.schema?.paths?.isAsliPrepExclusive) {
        loaded.doc.isAsliPrepExclusive = Boolean(track);
      }
    }
    await loaded.doc.save();

    paymentClaim.status = 'activated';
    paymentClaim.activatedAt = new Date();
    await paymentClaim.save();

    const receipt = buildIndividualReceipt(loaded.doc, {
      label: plan.label,
      amountInr: plan.amountInr,
      period: plan.period,
    });

    return res.json({
      success: true,
      message: 'Payment successful. Your plan is now active.',
      subscriptionStatus: 'active',
      paidPackage: plan.packageType,
      subscriptionExpiresAt: expiresAt,
      subscriptionPeriod: plan.period,
      receipt,
      redirect:
        loaded.role === 'teacher' ? '/teacher/dashboard' : '/dashboard',
    });
  } catch (error) {
    if (paymentClaim?._id && paymentClaim.status === 'processing') {
      await RazorpayPaymentReceipt.findByIdAndUpdate(paymentClaim._id, {
        $set: { status: 'failed', failureReason: String(error?.message || 'Activation failed').slice(0, 300) },
      }).catch(() => {});
    }
    console.error('verifyIndividualCheckout:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not confirm payment.',
    });
  }
}
