/**
 * School-level Vidya AI usage policy (Super Admin School Management).
 * unlimited = no quotas; limited = per-user daily caps for chatbot and/or tools (24h rolling).
 * Policies can be set per role (admin / teacher / student); legacy flat fields still work.
 */

export const SCHOOL_VIDYA_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SCHOOL_VIDYA_CHAT_PER_DAY = 10;
export const DEFAULT_SCHOOL_VIDYA_GENERATIONS_PER_DAY = 10;

export const VIDYA_ROLE_KEYS = ['admin', 'teacher', 'student'];

export function normalizeSchoolVidyaPolicy(raw = {}) {
  const mode =
    String(raw.vidyaUsageMode || raw.usageMode || raw.mode || 'unlimited').toLowerCase() ===
    'limited'
      ? 'limited'
      : 'unlimited';

  let limitChatbot = Boolean(raw.vidyaLimitChatbot ?? raw.limitChatbot);
  let limitTools = Boolean(raw.vidyaLimitTools ?? raw.limitTools);

  const chatPerDay = Math.max(
    1,
    Math.min(
      10000,
      Math.floor(
        Number(raw.vidyaChatPerDay ?? raw.chatPerDay) || DEFAULT_SCHOOL_VIDYA_CHAT_PER_DAY
      )
    )
  );
  const generationsPerDay = Math.max(
    1,
    Math.min(
      10000,
      Math.floor(
        Number(raw.vidyaGenerationsPerDay ?? raw.generationsPerDay) ||
          DEFAULT_SCHOOL_VIDYA_GENERATIONS_PER_DAY
      )
    )
  );

  if (mode === 'limited' && !limitChatbot && !limitTools) {
    return {
      vidyaUsageMode: 'unlimited',
      vidyaLimitChatbot: false,
      vidyaLimitTools: false,
      vidyaChatPerDay: chatPerDay,
      vidyaGenerationsPerDay: generationsPerDay,
      applies: false,
    };
  }

  return {
    vidyaUsageMode: mode,
    vidyaLimitChatbot: mode === 'limited' ? limitChatbot : false,
    vidyaLimitTools: mode === 'limited' ? limitTools : false,
    vidyaChatPerDay: chatPerDay,
    vidyaGenerationsPerDay: generationsPerDay,
    applies: mode === 'limited',
  };
}

/** Fields to persist on admin User / School from request body (legacy flat). */
export function schoolVidyaPolicyFromBody(body = {}) {
  return normalizeSchoolVidyaPolicy(body);
}

function unlimitedPolicy() {
  return normalizeSchoolVidyaPolicy({ vidyaUsageMode: 'unlimited' });
}

function roleBucket(rawPolicies, role) {
  if (!rawPolicies || typeof rawPolicies !== 'object') return null;
  const bucket = rawPolicies[role];
  if (!bucket || typeof bucket !== 'object') return null;
  return bucket;
}

/**
 * Resolve per-role Vidya policies from admin/school document or request body.
 * Teacher/student fall back to legacy flat school-wide fields when role bucket missing.
 * Admin defaults to unlimited when no role bucket is set.
 */
export function normalizeVidyaRolePolicies(source = {}) {
  const nested = source.vidyaRolePolicies || {};
  const legacy = normalizeSchoolVidyaPolicy(source);
  const out = {};

  for (const role of VIDYA_ROLE_KEYS) {
    const bucket = roleBucket(nested, role);
    if (bucket) {
      out[role] = normalizeSchoolVidyaPolicy(bucket);
    } else if (role === 'admin') {
      out[role] = unlimitedPolicy();
    } else {
      out[role] = legacy;
    }
  }
  return out;
}

/**
 * Build role policies from create/update body.
 * Accepts `vidyaRolePolicies` or legacy flat fields (applied to teacher + student).
 */
export function schoolVidyaRolePoliciesFromBody(body = {}) {
  if (body.vidyaRolePolicies && typeof body.vidyaRolePolicies === 'object') {
    const out = {};
    for (const role of VIDYA_ROLE_KEYS) {
      const bucket = roleBucket(body.vidyaRolePolicies, role);
      out[role] = bucket ? normalizeSchoolVidyaPolicy(bucket) : unlimitedPolicy();
    }
    return out;
  }
  const legacy = schoolVidyaPolicyFromBody(body);
  return {
    admin: unlimitedPolicy(),
    teacher: legacy,
    student: legacy,
  };
}

/** Persistable plain object (no `applies`). */
export function rolePoliciesForPersist(policies) {
  const out = {};
  for (const role of VIDYA_ROLE_KEYS) {
    const p = policies[role] || unlimitedPolicy();
    out[role] = {
      vidyaUsageMode: p.vidyaUsageMode,
      vidyaLimitChatbot: p.vidyaLimitChatbot,
      vidyaLimitTools: p.vidyaLimitTools,
      vidyaChatPerDay: p.vidyaChatPerDay,
      vidyaGenerationsPerDay: p.vidyaGenerationsPerDay,
    };
  }
  return out;
}

/** Pick a single legacy flat policy for older clients / list cards. */
export function legacyFlatFromRolePolicies(policies) {
  const student = policies?.student || unlimitedPolicy();
  const teacher = policies?.teacher || unlimitedPolicy();
  if (student.applies) return student;
  if (teacher.applies) return teacher;
  return policies?.admin?.applies ? policies.admin : student;
}

export function validateLimitedRolePolicies(policies) {
  for (const role of VIDYA_ROLE_KEYS) {
    const raw = policies?.[role];
    if (!raw) continue;
    const mode = String(raw.vidyaUsageMode || raw.usageMode || '').toLowerCase();
    if (mode !== 'limited') continue;
    const limitChatbot = Boolean(raw.vidyaLimitChatbot ?? raw.limitChatbot);
    const limitTools = Boolean(raw.vidyaLimitTools ?? raw.limitTools);
    if (!limitChatbot && !limitTools) {
      return {
        ok: false,
        message: `When Vidya is Limited for ${role}, select Chatbot and/or AI Tools and set the daily limits.`,
      };
    }
  }
  return { ok: true };
}

/** Policy for one role from an admin document. */
export function policyForRole(adminOrSchool, role) {
  const key = String(role || '').toLowerCase();
  const normalizedRole = VIDYA_ROLE_KEYS.includes(key) ? key : 'student';
  return normalizeVidyaRolePolicies(adminOrSchool || {})[normalizedRole];
}
