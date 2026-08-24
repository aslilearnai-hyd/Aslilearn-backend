import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import {
  normalizeSchoolVidyaPolicy,
  SCHOOL_VIDYA_WINDOW_MS,
} from './schoolVidyaLimits.js';

/** Lifetime Vidya chat messages for unpaid individual (trial) accounts. */
export const TRIAL_VIDYA_CHAT_LIMIT = 3;
/** AI tool generations per rolling window for unpaid trial accounts. */
export const TRIAL_GENERATION_DAILY_LIMIT = 3;
/** Rolling refresh window for generation quota. */
export const TRIAL_GENERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Unpaid individual / trial members (not school accounts, not paid).
 * Limits apply until Super Admin marks them paid (subscriptionStatus active).
 */
export function isUnpaidTrialMember(doc) {
  if (!doc?.isIndividualAccount) return false;
  const status = String(doc.subscriptionStatus || 'trial').toLowerCase();
  return status !== 'active' && status !== 'paid';
}

function generationWindowState(doc, now = Date.now()) {
  const startedAt = doc?.trialGenerationWindowStartedAt
    ? new Date(doc.trialGenerationWindowStartedAt).getTime()
    : 0;
  const rawCount = Number(doc?.trialGenerationCount) || 0;
  const windowFresh = Boolean(startedAt && now - startedAt < TRIAL_GENERATION_WINDOW_MS);
  const used = windowFresh ? rawCount : 0;
  const resetsAt = windowFresh
    ? new Date(startedAt + TRIAL_GENERATION_WINDOW_MS)
    : null;
  return {
    used,
    limit: TRIAL_GENERATION_DAILY_LIMIT,
    remaining: Math.max(0, TRIAL_GENERATION_DAILY_LIMIT - used),
    resetsAt,
    windowStartedAt: windowFresh ? new Date(startedAt) : null,
  };
}

export function getTrialUsageSnapshot(doc) {
  if (!isUnpaidTrialMember(doc)) {
    return {
      applies: false,
      vidyaChat: {
        used: 0,
        limit: TRIAL_VIDYA_CHAT_LIMIT,
        remaining: null,
      },
      generations: {
        used: 0,
        limit: TRIAL_GENERATION_DAILY_LIMIT,
        remaining: null,
        resetsAt: null,
      },
    };
  }

  const chatUsed = Math.max(0, Number(doc.trialVidyaChatUsed) || 0);
  const gens = generationWindowState(doc);

  return {
    applies: true,
    vidyaChat: {
      used: chatUsed,
      limit: TRIAL_VIDYA_CHAT_LIMIT,
      remaining: Math.max(0, TRIAL_VIDYA_CHAT_LIMIT - chatUsed),
    },
    generations: gens,
  };
}

/** Attach trial usage fields onto resolveIndividualAccess result. */
export function withTrialUsageLimits(access, doc) {
  const usage = getTrialUsageSnapshot(doc);
  return {
    ...access,
    trialUsage: usage,
    trialVidyaChatRemaining: usage.applies ? usage.vidyaChat.remaining : null,
    trialGenerationRemaining: usage.applies ? usage.generations.remaining : null,
    trialGenerationResetsAt: usage.applies ? usage.generations.resetsAt : null,
  };
}

export async function loadAccountForTrialLimits(userId, role) {
  const id = String(userId || '').trim();
  if (!id) return { Model: null, doc: null, role: '' };
  const r = String(role || '').toLowerCase();
  if (r === 'teacher') {
    const doc = await Teacher.findById(id);
    return { Model: Teacher, doc, role: 'teacher' };
  }
  const doc = await User.findById(id);
  return { Model: User, doc, role: r || 'student' };
}

function limitError({ code, message, usage }) {
  const err = new Error(message);
  err.statusCode = 429;
  err.code = code;
  err.trialUsage = usage;
  return err;
}

function adminIdFromAccount(doc, role) {
  if (!doc) return null;
  if (String(role || '').toLowerCase() === 'teacher') {
    return doc.adminId ? String(doc.adminId) : null;
  }
  if (doc.assignedAdmin) return String(doc.assignedAdmin._id || doc.assignedAdmin);
  return null;
}

async function loadSchoolVidyaPolicy(doc, role) {
  if (!doc || doc.isIndividualAccount) return null;
  const adminId = adminIdFromAccount(doc, role);
  if (!adminId) return null;
  return loadSchoolVidyaPolicyForAdmin(adminId);
}

/** School Vidya usage policy for an admin user id (tenant boundary). */
export async function loadSchoolVidyaPolicyForAdmin(adminId) {
  if (!adminId) return null;
  const admin = await User.findById(adminId)
    .select(
      'vidyaUsageMode vidyaLimitChatbot vidyaLimitTools vidyaChatPerDay vidyaGenerationsPerDay role'
    )
    .lean();
  if (!admin || String(admin.role || '').toLowerCase() !== 'admin') return null;
  return normalizeSchoolVidyaPolicy(admin);
}

function schoolChatWindowState(doc, limit, now = Date.now()) {
  const startedAt = doc?.schoolVidyaChatWindowStartedAt
    ? new Date(doc.schoolVidyaChatWindowStartedAt).getTime()
    : 0;
  const rawCount = Number(doc?.schoolVidyaChatCount) || 0;
  const windowFresh = Boolean(startedAt && now - startedAt < SCHOOL_VIDYA_WINDOW_MS);
  const used = windowFresh ? rawCount : 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: windowFresh ? new Date(startedAt + SCHOOL_VIDYA_WINDOW_MS) : null,
  };
}

function schoolGenerationWindowState(doc, limit, now = Date.now()) {
  const startedAt = doc?.schoolVidyaGenerationWindowStartedAt
    ? new Date(doc.schoolVidyaGenerationWindowStartedAt).getTime()
    : 0;
  const rawCount = Number(doc?.schoolVidyaGenerationCount) || 0;
  const windowFresh = Boolean(startedAt && now - startedAt < SCHOOL_VIDYA_WINDOW_MS);
  const used = windowFresh ? rawCount : 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: windowFresh ? new Date(startedAt + SCHOOL_VIDYA_WINDOW_MS) : null,
  };
}

async function consumeSchoolDailyCounter({
  Model,
  doc,
  countField,
  windowField,
  limit,
  code,
  label,
}) {
  const now = Date.now();
  const startedAt = doc[windowField] ? new Date(doc[windowField]).getTime() : 0;
  const windowFresh = Boolean(startedAt && now - startedAt < SCHOOL_VIDYA_WINDOW_MS);
  const used = windowFresh ? Math.max(0, Number(doc[countField]) || 0) : 0;

  if (used >= limit) {
    const resetsAt = windowFresh ? new Date(startedAt + SCHOOL_VIDYA_WINDOW_MS) : null;
    throw limitError({
      code,
      message:
        `School Vidya limit: ${limit} ${label} per 24 hours. ` +
        `Quota refreshes ${resetsAt ? resetsAt.toLocaleString() : 'in 24 hours'}.`,
      usage: {
        applies: true,
        source: 'school',
        used,
        limit,
        remaining: 0,
        resetsAt,
      },
    });
  }

  if (!windowFresh) {
    return Model.findByIdAndUpdate(
      doc._id,
      { $set: { [windowField]: new Date(now), [countField]: 1 } },
      { new: true }
    );
  }
  return Model.findByIdAndUpdate(doc._id, { $inc: { [countField]: 1 } }, { new: true });
}

/**
 * Enforce + consume one Vidya chat turn.
 * Trial members: lifetime TRIAL_VIDYA_CHAT_LIMIT until payment.
 * School members: school daily chat cap when limited + chatbot selected.
 */
export async function consumeTrialVidyaChat(userId, role) {
  const { Model, doc } = await loadAccountForTrialLimits(userId, role);
  if (!doc) {
    return { ok: true, applies: false, usage: getTrialUsageSnapshot(null) };
  }

  if (isUnpaidTrialMember(doc)) {
    const used = Math.max(0, Number(doc.trialVidyaChatUsed) || 0);
    if (used >= TRIAL_VIDYA_CHAT_LIMIT) {
      const usage = getTrialUsageSnapshot(doc);
      throw limitError({
        code: 'TRIAL_VIDYA_CHAT_LIMIT',
        message:
          `Trial Vidya chat limit reached (${TRIAL_VIDYA_CHAT_LIMIT} messages). ` +
          'Complete payment to continue chatting with Vidya AI.',
        usage,
      });
    }

    const updated = await Model.findByIdAndUpdate(
      doc._id,
      { $inc: { trialVidyaChatUsed: 1 } },
      { new: true }
    );
    return { ok: true, applies: true, usage: getTrialUsageSnapshot(updated) };
  }

  const policy = await loadSchoolVidyaPolicy(doc, role);
  if (!policy?.applies || !policy.vidyaLimitChatbot) {
    return { ok: true, applies: false, usage: null };
  }

  const updated = await consumeSchoolDailyCounter({
    Model,
    doc,
    countField: 'schoolVidyaChatCount',
    windowField: 'schoolVidyaChatWindowStartedAt',
    limit: policy.vidyaChatPerDay,
    code: 'SCHOOL_VIDYA_CHAT_LIMIT',
    label: 'Vidya chat messages',
  });

  return {
    ok: true,
    applies: true,
    usage: {
      applies: true,
      source: 'school',
      ...schoolChatWindowState(updated, policy.vidyaChatPerDay),
    },
  };
}

/**
 * Enforce + consume one AI tool generation.
 * Trial members: 3 / 24h. School members: school daily gen cap when limited + tools selected.
 */
export async function consumeTrialGeneration(userId, role) {
  const { Model, doc } = await loadAccountForTrialLimits(userId, role);
  if (!doc) {
    return { ok: true, applies: false, usage: getTrialUsageSnapshot(null) };
  }

  if (isUnpaidTrialMember(doc)) {
    const now = Date.now();
    const startedAt = doc.trialGenerationWindowStartedAt
      ? new Date(doc.trialGenerationWindowStartedAt).getTime()
      : 0;
    const windowFresh = Boolean(startedAt && now - startedAt < TRIAL_GENERATION_WINDOW_MS);
    const used = windowFresh ? Math.max(0, Number(doc.trialGenerationCount) || 0) : 0;

    if (used >= TRIAL_GENERATION_DAILY_LIMIT) {
      const usage = getTrialUsageSnapshot(doc);
      const resetsLabel = usage.generations.resetsAt
        ? new Date(usage.generations.resetsAt).toLocaleString()
        : 'in 24 hours';
      throw limitError({
        code: 'TRIAL_GENERATION_LIMIT',
        message:
          `Trial limit: ${TRIAL_GENERATION_DAILY_LIMIT} AI generations per 24 hours. ` +
          `Quota refreshes ${resetsLabel}. Complete payment for unlimited generations.`,
        usage,
      });
    }

    let updated;
    if (!windowFresh) {
      updated = await Model.findByIdAndUpdate(
        doc._id,
        {
          $set: {
            trialGenerationWindowStartedAt: new Date(now),
            trialGenerationCount: 1,
          },
        },
        { new: true }
      );
    } else {
      updated = await Model.findByIdAndUpdate(
        doc._id,
        { $inc: { trialGenerationCount: 1 } },
        { new: true }
      );
    }

    return { ok: true, applies: true, usage: getTrialUsageSnapshot(updated) };
  }

  const policy = await loadSchoolVidyaPolicy(doc, role);
  if (!policy?.applies || !policy.vidyaLimitTools) {
    return { ok: true, applies: false, usage: null };
  }

  const updated = await consumeSchoolDailyCounter({
    Model,
    doc,
    countField: 'schoolVidyaGenerationCount',
    windowField: 'schoolVidyaGenerationWindowStartedAt',
    limit: policy.vidyaGenerationsPerDay,
    code: 'SCHOOL_VIDYA_GENERATION_LIMIT',
    label: 'AI tool generations',
  });

  return {
    ok: true,
    applies: true,
    usage: {
      applies: true,
      source: 'school',
      ...schoolGenerationWindowState(updated, policy.vidyaGenerationsPerDay),
    },
  };
}

export function trialLimitHttpPayload(err) {
  return {
    success: false,
    code: err?.code || 'TRIAL_LIMIT',
    message: err?.message || 'Usage limit reached. Please try again later or contact support.',
    trialUsage: err?.trialUsage || null,
  };
}
