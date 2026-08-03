import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import bcrypt from 'bcryptjs';
import {
  ALL_CONTENT_TYPES,
  NORMAL_SCHOOL_CONTENT_TYPES,
} from '../utils/schoolProgram.js';
import {
  buildTrialWindow,
  resolveIndividualAccess,
  INDIVIDUAL_TRIAL_DAYS,
  normalizeIndividualSignupBody,
  normalizeAccountSource,
  accountSourceLabel,
} from '../utils/individualAccount.js';

const VALID_CONTENT_TYPES = new Set([...ALL_CONTENT_TYPES, ...NORMAL_SCHOOL_CONTENT_TYPES]);
const VALID_PAYMENT_METHODS = new Set(['', 'manual', 'upi', 'bank', 'other']);

function formatMember(doc, role) {
  const access = resolveIndividualAccess(doc);
  const now = Date.now();
  const ends = doc.trialEndsAt ? new Date(doc.trialEndsAt).getTime() : null;
  const exceeded =
    Boolean(doc.isIndividualAccount) &&
    (!ends || now >= ends) &&
    access.subscriptionStatus !== 'active';
  const accountSource = normalizeAccountSource(doc.accountSource, 'legacy');

  return {
    id: String(doc._id),
    role,
    fullName: doc.fullName || '',
    email: doc.email || '',
    phone: doc.phone || '',
    schoolName: doc.schoolName || doc.school || '',
    classNumber: doc.classNumber || '',
    curriculumBoard: doc.curriculumBoard || '',
    interestedCourses: doc.interestedCourses || [],
    interestedSubjects: doc.interestedSubjects || [],
    iitCategories: doc.iitCategories || [],
    accountSource,
    accountSourceLabel: accountSourceLabel(accountSource),
    isActive: doc.isActive !== false,
    subscriptionStatus: access.subscriptionStatus,
    trialStartsAt: doc.trialStartsAt || null,
    trialEndsAt: doc.trialEndsAt || null,
    trialDaysLeft: access.trialDaysLeft,
    trialActive: access.trialActive,
    paymentRequired: access.paymentRequired,
    trialExceeded: exceeded,
    trialAllowedContentTypes: Array.isArray(doc.trialAllowedContentTypes)
      ? doc.trialAllowedContentTypes
      : [],
    trialAllowedAiTools: Array.isArray(doc.trialAllowedAiTools) ? doc.trialAllowedAiTools : [],
    trialAdminNotes: doc.trialAdminNotes || '',
    trialPaymentAmount:
      doc.trialPaymentAmount != null && Number.isFinite(Number(doc.trialPaymentAmount))
        ? Number(doc.trialPaymentAmount)
        : null,
    trialPaidAt: doc.trialPaidAt || null,
    trialPaymentMethod: doc.trialPaymentMethod || '',
    trialPaymentReference: doc.trialPaymentReference || '',
    converted: access.subscriptionStatus === 'active',
    convertedAt: doc.trialPaidAt || null,
    createdAt: doc.createdAt || null,
    lastLogin: doc.lastLogin || null,
  };
}

function normalizeContentTypes(list) {
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(list.map((t) => String(t || '').trim()).filter((t) => VALID_CONTENT_TYPES.has(t))),
  ];
}

function normalizeToolSlugs(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t || '').trim()).filter(Boolean))];
}

function applyPaymentFields(doc, body = {}) {
  if (body.trialPaymentAmount !== undefined) {
    if (body.trialPaymentAmount === null || body.trialPaymentAmount === '') {
      doc.trialPaymentAmount = null;
    } else {
      const amount = Number(body.trialPaymentAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('trialPaymentAmount must be a non-negative number');
      }
      doc.trialPaymentAmount = amount;
    }
  }
  if (body.trialPaymentMethod !== undefined) {
    const method = String(body.trialPaymentMethod || '').toLowerCase().trim();
    if (!VALID_PAYMENT_METHODS.has(method)) {
      throw new Error('trialPaymentMethod must be manual, upi, bank, other, or empty');
    }
    doc.trialPaymentMethod = method;
  }
  if (body.trialPaymentReference !== undefined) {
    doc.trialPaymentReference = String(body.trialPaymentReference || '').trim();
  }
  if (body.trialPaidAt !== undefined) {
    if (body.trialPaidAt === null || body.trialPaidAt === '') {
      doc.trialPaidAt = null;
    } else {
      const paidAt = new Date(body.trialPaidAt);
      if (Number.isNaN(paidAt.getTime())) {
        throw new Error('Invalid trialPaidAt');
      }
      doc.trialPaidAt = paidAt;
    }
  }
}

function applyAccessAndAllowLists(doc, body = {}) {
  const {
    trialDays,
    trialEndsAt,
    subscriptionStatus,
    trialAllowedContentTypes,
    trialAllowedAiTools,
    trialAdminNotes,
    isActive,
    resetTrial,
    extendDays,
  } = body;

  if (resetTrial === true || (trialDays != null && Number(trialDays) > 0)) {
    const days = Number(trialDays) > 0 ? Math.floor(Number(trialDays)) : INDIVIDUAL_TRIAL_DAYS;
    const window = buildTrialWindow(new Date(), days);
    doc.trialStartsAt = window.trialStartsAt;
    doc.trialEndsAt = window.trialEndsAt;
    doc.subscriptionStatus = 'trial';
  } else if (extendDays != null && Number(extendDays) > 0) {
    const add = Math.floor(Number(extendDays));
    const base =
      doc.trialEndsAt && new Date(doc.trialEndsAt).getTime() > Date.now()
        ? new Date(doc.trialEndsAt)
        : new Date();
    base.setDate(base.getDate() + add);
    doc.trialEndsAt = base;
    if (!doc.trialStartsAt) doc.trialStartsAt = new Date();
    doc.subscriptionStatus = 'trial';
  } else if (trialEndsAt) {
    const ends = new Date(trialEndsAt);
    if (Number.isNaN(ends.getTime())) {
      throw new Error('Invalid trialEndsAt');
    }
    doc.trialEndsAt = ends;
    if (!doc.trialStartsAt) doc.trialStartsAt = new Date();
    if (ends.getTime() > Date.now()) {
      doc.subscriptionStatus = 'trial';
    }
  }

  if (subscriptionStatus !== undefined) {
    const status = String(subscriptionStatus).toLowerCase().trim();
    if (!['trial', 'active', 'expired', 'none'].includes(status)) {
      throw new Error('subscriptionStatus must be trial, active, expired, or none');
    }
    doc.subscriptionStatus = status;
    if (status === 'active') {
      if (!doc.trialPaidAt) doc.trialPaidAt = new Date();
      if (!doc.trialPaymentMethod) doc.trialPaymentMethod = 'manual';
    } else if (status === 'expired') {
      doc.trialEndsAt = doc.trialEndsAt || new Date();
      if (new Date(doc.trialEndsAt).getTime() > Date.now()) {
        doc.trialEndsAt = new Date();
      }
    }
  }

  if (trialAllowedContentTypes !== undefined) {
    doc.trialAllowedContentTypes = normalizeContentTypes(trialAllowedContentTypes);
  }
  if (trialAllowedAiTools !== undefined) {
    doc.trialAllowedAiTools = normalizeToolSlugs(trialAllowedAiTools);
  }
  if (trialAdminNotes !== undefined) {
    doc.trialAdminNotes = String(trialAdminNotes || '').trim();
  }
  if (isActive !== undefined) {
    doc.isActive = Boolean(isActive);
  }

  applyPaymentFields(doc, body);
}

async function findTrialMember(id, roleHint) {
  if (roleHint === 'teacher') {
    const teacher = await Teacher.findOne({ _id: id, isIndividualAccount: true });
    if (teacher) return { doc: teacher, role: 'teacher', Model: Teacher };
  }
  if (roleHint === 'student') {
    const student = await User.findOne({ _id: id, role: 'student', isIndividualAccount: true });
    if (student) return { doc: student, role: 'student', Model: User };
  }
  const teacher = await Teacher.findOne({ _id: id, isIndividualAccount: true });
  if (teacher) return { doc: teacher, role: 'teacher', Model: Teacher };
  const student = await User.findOne({ _id: id, role: 'student', isIndividualAccount: true });
  if (student) return { doc: student, role: 'student', Model: User };
  return null;
}

/** GET /api/super-admin/trial-members */
export async function listTrialMembers(req, res) {
  try {
    const status = String(req.query.status || 'all').toLowerCase();
    const role = String(req.query.role || 'all').toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    const [students, teachers] = await Promise.all([
      role === 'teacher'
        ? []
        : User.find({ role: 'student', isIndividualAccount: true })
            .sort({ createdAt: -1 })
            .lean(),
      role === 'student'
        ? []
        : Teacher.find({ isIndividualAccount: true }).sort({ createdAt: -1 }).lean(),
    ]);

    let members = [
      ...students.map((s) => formatMember(s, 'student')),
      ...teachers.map((t) => formatMember(t, 'teacher')),
    ];

    // Global summary (before filters) so cards stay accurate while the table is filtered.
    const summary = {
      total: members.length,
      trialActive: members.filter((m) => m.trialActive).length,
      exceeded: members.filter((m) => m.trialExceeded).length,
      paid: members.filter((m) => m.subscriptionStatus === 'active').length,
      converted: members.filter((m) => m.converted).length,
      students: members.filter((m) => m.role === 'student').length,
      teachers: members.filter((m) => m.role === 'teacher').length,
      revenueInr: members
        .filter((m) => m.subscriptionStatus === 'active' && m.trialPaymentAmount != null)
        .reduce((sum, m) => sum + (Number(m.trialPaymentAmount) || 0), 0),
    };
    const conversionRate =
      summary.total > 0 ? Math.round((summary.converted / summary.total) * 1000) / 10 : 0;

    if (status === 'active' || status === 'trial') {
      members = members.filter((m) => m.trialActive || m.subscriptionStatus === 'trial');
    } else if (status === 'exceeded' || status === 'expired') {
      members = members.filter((m) => m.trialExceeded || m.subscriptionStatus === 'expired');
    } else if (status === 'paid' || status === 'active_paid' || status === 'converted') {
      members = members.filter((m) => m.subscriptionStatus === 'active');
    }

    if (q) {
      members = members.filter(
        (m) =>
          m.fullName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.schoolName.toLowerCase().includes(q) ||
          m.phone.includes(q) ||
          (m.accountSourceLabel || '').toLowerCase().includes(q) ||
          (m.accountSource || '').toLowerCase().includes(q),
      );
    }

    members.sort((a, b) => {
      const ae = a.trialExceeded ? 0 : 1;
      const be = b.trialExceeded ? 0 : 1;
      if (ae !== be) return ae - be;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.json({
      success: true,
      data: {
        members,
        summary: { ...summary, conversionRate },
        contentTypeOptions: [...ALL_CONTENT_TYPES],
        defaultTrialDays: INDIVIDUAL_TRIAL_DAYS,
      },
    });
  } catch (error) {
    console.error('listTrialMembers error:', error);
    res.status(500).json({ success: false, message: 'Failed to load trial members' });
  }
}

/**
 * PUT /api/super-admin/trial-members/:id
 */
export async function updateTrialMember(req, res) {
  try {
    const { id } = req.params;
    const roleHint = req.body.role;
    const found = await findTrialMember(id, roleHint);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Trial member not found' });
    }

    try {
      applyAccessAndAllowLists(found.doc, req.body);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message || 'Invalid update' });
    }

    await found.doc.save();

    res.json({
      success: true,
      message: 'Trial member updated',
      data: formatMember(found.doc.toObject ? found.doc.toObject() : found.doc, found.role),
    });
  } catch (error) {
    console.error('updateTrialMember error:', error);
    res.status(500).json({ success: false, message: 'Failed to update trial member' });
  }
}

/**
 * POST /api/super-admin/trial-members
 * Create an individual trial member (teacher or student) from Super Admin.
 */
export async function createTrialMember(req, res) {
  try {
    const parsed = normalizeIndividualSignupBody({
      ...req.body,
      accountSource: 'super_admin',
    });
    if (!parsed.ok) {
      return res.status(400).json({ success: false, message: parsed.message });
    }
    const d = parsed.data;

    const existingUser = await User.findOne({ email: d.email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }
    const existingTeacher = await Teacher.findOne({ email: d.email });
    if (existingTeacher) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(d.password, 12);
    const trialFields = {
      isIndividualAccount: true,
      schoolName: d.schoolName,
      phone: d.phone,
      classNumber: d.classNumber || 'Unassigned',
      curriculumBoard: d.curriculumBoard,
      board: d.isAsliPrepExclusive ? 'ASLI_EXCLUSIVE_SCHOOLS' : d.curriculumBoard,
      isAsliPrepExclusive: d.isAsliPrepExclusive,
      iitCategories: d.iitCategories,
      interestedCourses: d.interestedCourses,
      interestedSubjects: d.interestedSubjects,
      accountSource: 'super_admin',
      subscriptionStatus: 'trial',
      trialStartsAt: d.trialStartsAt,
      trialEndsAt: d.trialEndsAt,
      trialAdminNotes: String(req.body.trialAdminNotes || '').trim(),
      trialAllowedContentTypes: normalizeContentTypes(req.body.trialAllowedContentTypes),
      trialAllowedAiTools: normalizeToolSlugs(req.body.trialAllowedAiTools),
    };

    if (d.role === 'teacher') {
      const teacher = new Teacher({
        email: d.email,
        password: hashedPassword,
        fullName: d.fullName,
        phone: d.phone,
        school: d.schoolName,
        schoolName: d.schoolName,
        board: trialFields.board,
        curriculumBoard: d.curriculumBoard,
        classNumber: d.classNumber,
        iitCategories: d.iitCategories,
        interestedCourses: d.interestedCourses,
        interestedSubjects: d.interestedSubjects,
        accountSource: 'super_admin',
        isIndividualAccount: true,
        subscriptionStatus: 'trial',
        trialStartsAt: d.trialStartsAt,
        trialEndsAt: d.trialEndsAt,
        trialAdminNotes: trialFields.trialAdminNotes,
        trialAllowedContentTypes: trialFields.trialAllowedContentTypes,
        trialAllowedAiTools: trialFields.trialAllowedAiTools,
        adminId: null,
        isActive: true,
        role: 'teacher',
      });
      await teacher.save();
      return res.status(201).json({
        success: true,
        message: `Teacher trial member created (${d.trialDays}-day trial).`,
        data: formatMember(teacher.toObject(), 'teacher'),
      });
    }

    const student = new User({
      email: d.email,
      password: hashedPassword,
      fullName: d.fullName,
      role: 'student',
      assignedAdmin: null,
      ...trialFields,
      isActive: true,
    });
    await student.save();

    return res.status(201).json({
      success: true,
      message: `Student trial member created (${d.trialDays}-day trial).`,
      data: formatMember(student.toObject(), 'student'),
    });
  } catch (error) {
    console.error('createTrialMember error:', error);
    res.status(500).json({ success: false, message: 'Failed to create trial member' });
  }
}

/**
 * DELETE /api/super-admin/trial-members/:id
 * Permanently remove an individual (B2C) trial member.
 * Query/body: role=student|teacher (optional hint)
 */
export async function deleteTrialMember(req, res) {
  try {
    const { id } = req.params;
    const roleHint = req.query.role || req.body?.role;
    const found = await findTrialMember(id, roleHint);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Trial member not found' });
    }

    await found.Model.deleteOne({ _id: found.doc._id, isIndividualAccount: true });

    res.json({
      success: true,
      message: `${found.role === 'teacher' ? 'Teacher' : 'Student'} trial member deleted`,
      data: { id: String(found.doc._id), role: found.role },
    });
  } catch (error) {
    console.error('deleteTrialMember error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete trial member' });
  }
}

/**
 * POST /api/super-admin/trial-members/apply-defaults
 * Body: { memberIds: [{ id, role }], trialAllowedContentTypes?, trialAllowedAiTools? }
 */
export async function applyTrialMemberDefaults(req, res) {
  try {
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    if (memberIds.length === 0) {
      return res.status(400).json({ success: false, message: 'memberIds is required' });
    }

    const patch = {};
    if (req.body.trialAllowedContentTypes !== undefined) {
      patch.trialAllowedContentTypes = normalizeContentTypes(req.body.trialAllowedContentTypes);
    }
    if (req.body.trialAllowedAiTools !== undefined) {
      patch.trialAllowedAiTools = normalizeToolSlugs(req.body.trialAllowedAiTools);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide trialAllowedContentTypes and/or trialAllowedAiTools',
      });
    }

    const updated = [];
    const failed = [];
    for (const item of memberIds) {
      const id = item?.id || item;
      const roleHint = item?.role;
      try {
        const found = await findTrialMember(id, roleHint);
        if (!found) {
          failed.push({ id: String(id), reason: 'not found' });
          continue;
        }
        if (patch.trialAllowedContentTypes !== undefined) {
          found.doc.trialAllowedContentTypes = patch.trialAllowedContentTypes;
        }
        if (patch.trialAllowedAiTools !== undefined) {
          found.doc.trialAllowedAiTools = patch.trialAllowedAiTools;
        }
        await found.doc.save();
        updated.push(formatMember(found.doc.toObject ? found.doc.toObject() : found.doc, found.role));
      } catch (err) {
        failed.push({ id: String(id), reason: err.message || 'update failed' });
      }
    }

    res.json({
      success: true,
      message: `Applied defaults to ${updated.length} member(s)`,
      data: { updated, failed, patch },
    });
  } catch (error) {
    console.error('applyTrialMemberDefaults error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply trial defaults' });
  }
}
