import mongoose from 'mongoose';
import { MODULE_REGISTRY, moduleSchemaFields, resolveModuleKey, scopeFieldsForModule } from './module-registry.js';
import { istYmd, istWeekDateKeys, istStartOfDayInstant, istEndOfDayInstant } from './ist-time.js';

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function safeField(field, allowed) {
  const f = String(field || '').trim();
  return allowed.has(f) ? f : null;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function timeframeToDateFilter(tf) {
  if (!tf || tf === 'all') return null;
  if (tf === 'today') {
    const ymd = istYmd(new Date());
    return { $gte: istStartOfDayInstant(ymd), $lte: istEndOfDayInstant(ymd) };
  }
  if (tf === 'this_week') {
    const wk = istWeekDateKeys(new Date());
    return { $gte: istStartOfDayInstant(wk[0]), $lte: istEndOfDayInstant(wk[6]) };
  }
  if (tf === 'this_month') {
    const ymd = istYmd(new Date());
    return { $gte: istStartOfDayInstant(`${ymd.slice(0, 7)}-01`), $lte: new Date() };
  }
  return null;
}

function normalizeSimpleValue(value) {
  if (typeof value === 'string' && value.length <= 64) {
    const v = value.trim().toLowerCase();
    if (v === 'now') return new Date();
    if (v === 'today_start') {
      const ymd = istYmd(new Date());
      return istStartOfDayInstant(ymd);
    }
    if (v === 'today_end') {
      const ymd = istYmd(new Date());
      return istEndOfDayInstant(ymd);
    }
    const c = value.match(/class\s*(\d+)/i);
    if (c) return c[1];
  }
  return value;
}

function toMongoFilter(filters, allowedFields) {
  const mongo = {};
  for (const it of asArray(filters)) {
    const field = safeField(it?.field, allowedFields);
    if (!field) continue;
    const op = String(it?.op || 'eq').toLowerCase();
    const val = normalizeSimpleValue(it?.value);
    if (op === 'eq') {
      if (field === 'classNumber' && typeof val === 'string' && /^\d+$/.test(val)) {
        mongo[field] = { $in: [val, `Class ${val}`, `class ${val}`] };
      } else {
        mongo[field] = val;
      }
    }
    else if (op === 'ne') mongo[field] = { $ne: val };
    else if (op === 'gt') mongo[field] = { $gt: val };
    else if (op === 'gte') mongo[field] = { $gte: val };
    else if (op === 'lt') mongo[field] = { $lt: val };
    else if (op === 'lte') mongo[field] = { $lte: val };
    else if (op === 'in') mongo[field] = { $in: asArray(val) };
    else if (op === 'exists') mongo[field] = { $exists: Boolean(val) };
    else if (op === 'regex') {
      const pattern = String(val || '').slice(0, 80);
      if (pattern) mongo[field] = { $regex: pattern, $options: 'i' };
    }
  }
  return mongo;
}

function adminScopeFilter({ role, viewerUserId, moduleKey, allowedFields }) {
  if (role !== 'admin') return {};
  const viewerOid = oid(viewerUserId);
  if (!viewerOid) return { __scopeError: 'Admin token user id is not a database ObjectId; cannot school-scope safely.' };

  const scopeFields = scopeFieldsForModule(moduleKey).filter((f) => allowedFields.has(f));
  if (scopeFields.length === 0) return {};
  if (scopeFields.length === 1) return { [scopeFields[0]]: viewerOid };
  return { $or: scopeFields.map((f) => ({ [f]: viewerOid })) };
}

function applyTimeframe(baseFilter, tf, allowedFields) {
  const dt = timeframeToDateFilter(tf);
  if (!dt) return baseFilter;
  const candidates = ['createdAt', 'updatedAt', 'ts', 'date', 'startDate', 'completedAt', 'uploadDate'];
  const target = candidates.find((f) => allowedFields.has(f));
  if (!target) return baseFilter;
  return { ...baseFilter, [target]: dt };
}

function applyModuleSpecificTimeframe({ moduleKey, mergedFilter, timeframe, allowedFields }) {
  // Exam windows should match schedule overlap, not just startDate inside range.
  if (moduleKey === 'exams' && timeframe && timeframe !== 'all' && allowedFields.has('startDate') && allowedFields.has('endDate')) {
    const range = timeframeToDateFilter(timeframe);
    if (!range) return mergedFilter;
    const start = range.$gte;
    const end = range.$lte;
    const base = { ...mergedFilter };
    delete base.startDate;
    delete base.endDate;
    return {
      ...base,
      startDate: { $lte: end },
      endDate: { $gte: start },
    };
  }
  if (
    moduleKey === 'exams'
    && timeframe === 'all'
    && mergedFilter?.isActive === true
    && allowedFields.has('startDate')
    && allowedFields.has('endDate')
  ) {
    const ymd = istYmd(new Date());
    const startOfToday = istStartOfDayInstant(ymd);
    const endOfToday = istEndOfDayInstant(ymd);
    const base = { ...mergedFilter };
    delete base.startDate;
    delete base.endDate;
    return {
      ...base,
      startDate: { $lte: endOfToday },
      endDate: { $gte: startOfToday },
    };
  }
  return mergedFilter;
}

function safeProjection(selectFields, allowedFields) {
  const keys = (Array.isArray(selectFields) ? selectFields : [])
    .map((f) => safeField(f, allowedFields))
    .filter(Boolean);
  if (keys.length === 0) return null;
  return keys.reduce((acc, k) => {
    acc[k] = 1;
    return acc;
  }, {});
}

function safeSort(sortList, allowedFields) {
  const out = {};
  for (const s of asArray(sortList).slice(0, 4)) {
    const field = safeField(s?.field, allowedFields);
    if (!field) continue;
    out[field] = String(s?.direction || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  }
  return Object.keys(out).length ? out : null;
}

export async function executeDynamicDbPlan({
  plan,
  viewerRole,
  viewerUserId,
}) {
  const role = String(viewerRole || '').toLowerCase();
  const moduleKey = resolveModuleKey(plan.module);
  if (!moduleKey) {
    return { ok: false, error: 'Could not map this question to a known application module.' };
  }
  const cfg = MODULE_REGISTRY[moduleKey];
  if (!cfg?.model) {
    return { ok: true, facts: { module: moduleKey, available: false, reason: cfg?.unavailableReason || 'Unavailable' } };
  }

  const model = cfg.model;
  const fields = moduleSchemaFields(model);
  const allowedFields = new Set(fields);
  const base = cfg.baseFilter || {};
  const viewerOid = oid(viewerUserId);
  const selfScopeOr = [];
  let hasViewerScopedFilter = false;
  const normalizedPlanFilters = asArray(plan.filters).flatMap((f) => {
    if (f?.value !== '__viewer__') return [f];
    hasViewerScopedFilter = true;
    const field = String(f?.field || '');
    if (field === 'generatedBy') {
      const values = [String(viewerUserId)];
      if (viewerOid) values.push(viewerOid);
      selfScopeOr.push({ generatedBy: { $in: values } });
      return [];
    }
    if (field === 'teacherId') {
      if (viewerOid) selfScopeOr.push({ teacherId: viewerOid });
      return [];
    }
    return [];
  });
  // Super-admin identities are sometimes symbolic and may not map to User ObjectId.
  // In that case, include metadata role fallback for "my generated content" queries.
  if (
    role === 'super-admin' &&
    moduleKey === 'ai_tool_data' &&
    hasViewerScopedFilter
  ) {
    selfScopeOr.push({ 'metadata.createdByRole': 'super-admin' });
  }
  const fromPlan = toMongoFilter(normalizedPlanFilters, allowedFields);
  const scoped = adminScopeFilter({ role, viewerUserId, moduleKey, allowedFields });
  if (scoped.__scopeError) return { ok: false, error: scoped.__scopeError };
  let mergedBaseFilter = { ...base, ...fromPlan, ...scoped };
  if (selfScopeOr.length === 1) {
    mergedBaseFilter = { ...mergedBaseFilter, ...selfScopeOr[0] };
  } else if (selfScopeOr.length > 1) {
    mergedBaseFilter = { $and: [mergedBaseFilter, { $or: selfScopeOr }] };
  }
  const basicTimeFiltered = applyTimeframe(mergedBaseFilter, plan.timeframe, allowedFields);
  const merged = applyModuleSpecificTimeframe({
    moduleKey,
    mergedFilter: basicTimeFiltered,
    timeframe: plan.timeframe,
    allowedFields,
  });

  const limit = Math.max(1, Math.min(100, Number(plan.limit) || 20));
  const operation = String(plan.operation || 'list').toLowerCase();

  if (operation === 'count') {
    const count = await model.countDocuments(merged);
    return {
      ok: true,
      facts: {
        mode: 'database',
        module: moduleKey,
        operation: 'count',
        filter: merged,
        count,
      },
    };
  }

  if (operation === 'distinct') {
    const targetField = safeField(plan.selectFields?.[0], allowedFields) || 'role';
    const values = await model.distinct(targetField, merged);
    return {
      ok: true,
      facts: {
        mode: 'database',
        module: moduleKey,
        operation: 'distinct',
        filter: merged,
        field: targetField,
        totalDistinct: values.length,
        values: values.slice(0, limit),
      },
    };
  }

  if (operation === 'aggregate') {
    const groupBy = asArray(plan.groupBy).map((f) => safeField(f, allowedFields)).filter(Boolean);
    const aggs = asArray(plan.aggregates).slice(0, 5);
    const groupStage = { _id: {} };
    if (groupBy.length === 0) groupStage._id = null;
    else {
      for (const g of groupBy) groupStage._id[g] = `$${g}`;
    }
    let hasMetric = false;
    for (const a of aggs) {
      const func = String(a?.func || '').toLowerCase();
      const as = String(a?.as || `${func}_metric`).slice(0, 40);
      const field = String(a?.field || '*');
      if (func === 'count') {
        groupStage[as] = { $sum: 1 };
        hasMetric = true;
      } else {
        const safe = safeField(field, allowedFields);
        if (!safe) continue;
        if (func === 'sum') groupStage[as] = { $sum: `$${safe}` };
        if (func === 'avg') groupStage[as] = { $avg: `$${safe}` };
        if (func === 'min') groupStage[as] = { $min: `$${safe}` };
        if (func === 'max') groupStage[as] = { $max: `$${safe}` };
        hasMetric = true;
      }
    }
    if (!hasMetric) groupStage.count = { $sum: 1 };

    const sort = safeSort(plan.sort, allowedFields) || { count: -1 };
    const rows = await model.aggregate([
      { $match: merged },
      { $group: groupStage },
      { $sort: sort },
      { $limit: limit },
    ]);

    return {
      ok: true,
      facts: {
        mode: 'database',
        module: moduleKey,
        operation: 'aggregate',
        filter: merged,
        groupBy,
        rows,
      },
    };
  }

  const projection = safeProjection(plan.selectFields, allowedFields);
  const sort = safeSort(plan.sort, allowedFields) || { createdAt: -1 };
  let q = model.find(merged);
  if (projection) q = q.select(projection);
  const rows = await q.sort(sort).limit(limit).lean();
  return {
    ok: true,
    facts: {
      mode: 'database',
      module: moduleKey,
      operation: 'list',
      filter: merged,
      limit,
      totalReturned: rows.length,
      rows,
    },
  };
}
