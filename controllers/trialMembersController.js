import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import {
  ALL_CONTENT_TYPES,
  NORMAL_SCHOOL_CONTENT_TYPES,
} from '../utils/schoolProgram.js';
import {
  buildTrialWindow,
  resolveIndividualAccess,
  INDIVIDUAL_TRIAL_DAYS,
} from '../utils/individualAccount.js';

const VALID_CONTENT_TYPES = new Set([...ALL_CONTENT_TYPES, ...NORMAL_SCHOOL_CONTENT_TYPES]);

function formatMember(doc, role) {
  const access = resolveIndividualAccess(doc);
  const now = Date.now();
  const ends = doc.trialEndsAt ? new Date(doc.trialEndsAt).getTime() : null;
  const exceeded = Boolean(doc.isIndividualAccount) && (!ends || now >= ends) && access.subscriptionStatus !== 'active';

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
    createdAt: doc.createdAt || null,
    lastLogin: doc.lastLogin || null,
  };
}

function normalizeContentTypes(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t || '').trim()).filter((t) => VALID_CONTENT_TYPES.has(t)))];
}

function normalizeToolSlugs(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t || '').trim()).filter(Boolean))];
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

    if (status === 'active' || status === 'trial') {
      members = members.filter((m) => m.trialActive || m.subscriptionStatus === 'trial');
    } else if (status === 'exceeded' || status === 'expired') {
      members = members.filter((m) => m.trialExceeded || m.subscriptionStatus === 'expired');
    } else if (status === 'paid' || status === 'active_paid') {
      members = members.filter((m) => m.subscriptionStatus === 'active');
    }

    if (q) {
      members = members.filter(
        (m) =>
          m.fullName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.schoolName.toLowerCase().includes(q) ||
          m.phone.includes(q)
      );
    }

    members.sort((a, b) => {
      const ae = a.trialExceeded ? 0 : 1;
      const be = b.trialExceeded ? 0 : 1;
      if (ae !== be) return ae - be;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    const summary = {
      total: members.length,
      trialActive: members.filter((m) => m.trialActive).length,
      exceeded: members.filter((m) => m.trialExceeded).length,
      paid: members.filter((m) => m.subscriptionStatus === 'active').length,
      students: members.filter((m) => m.role === 'student').length,
      teachers: members.filter((m) => m.role === 'teacher').length,
    };

    res.json({
      success: true,
      data: {
        members,
        summary,
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
 * Body: { role?, trialDays?, trialEndsAt?, subscriptionStatus?,
 *         trialAllowedContentTypes?, trialAllowedAiTools?, trialAdminNotes?, isActive?, resetTrial? }
 */
export async function updateTrialMember(req, res) {
  try {
    const { id } = req.params;
    const roleHint = req.body.role;
    const found = await findTrialMember(id, roleHint);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Trial member not found' });
    }

    const { doc } = found;
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
    } = req.body;

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
        return res.status(400).json({ success: false, message: 'Invalid trialEndsAt' });
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
        return res.status(400).json({
          success: false,
          message: 'subscriptionStatus must be trial, active, expired, or none',
        });
      }
      doc.subscriptionStatus = status;
      if (status === 'active') {
        // Paid / unlocked by Super Admin
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

    await doc.save();

    res.json({
      success: true,
      message: 'Trial member updated',
      data: formatMember(doc.toObject ? doc.toObject() : doc, found.role),
    });
  } catch (error) {
    console.error('updateTrialMember error:', error);
    res.status(500).json({ success: false, message: 'Failed to update trial member' });
  }
}
