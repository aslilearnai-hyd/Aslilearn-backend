import mongoose from 'mongoose';

import { loadPlatformAccess, platformModuleScope, platformReadableFields } from './platform-access.js';
import { redactPlatformValue, isPrivateField } from './field-policy.js';
import { MODULE_REGISTRY, moduleSchemaFields, resolveModuleKey } from './module-registry.js';
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
  const lastN = String(tf || '').match(/^last_(\d{1,3})_days$/);
  if (lastN || tf === 'last_7_days') {
    const n = lastN ? Math.min(365, Math.max(1, parseInt(lastN[1], 10))) : 7;
    return { $gte: new Date(Date.now() - n * 24 * 60 * 60 * 1000), $lte: new Date() };
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
    const daysAgo = v.match(/^days_ago_(\d{1,3})$/);
    if (daysAgo) {
      const n = Math.min(365, Math.max(1, parseInt(daysAgo[1], 10)));
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
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
    if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) continue;
    if (Array.isArray(val) && val.some(v => v && typeof v === 'object')) continue;
    // A blank/missing value means "no constraint was actually specified" (e.g. "Class"
    // with no number) — applying it literally (field === '') would zero out real matches
    // instead of just not filtering on that field.
    if ((val === '' || val === null || val === undefined) && op !== 'exists') continue;
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
      const pattern = String(val || '').slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (pattern) mongo[field] = { $regex: pattern, $options: 'i' };
    }
  }
  return mongo;
}

function applyTimeframe(baseFilter, tf, allowedFields, preferredDateField = '') {
  const dt = timeframeToDateFilter(tf);
  if (!dt) return baseFilter;
  const preferred = String(preferredDateField || '').trim();
  if (preferred && allowedFields.has(preferred)) {
    return { ...baseFilter, [preferred]: dt };
  }
  const candidates = [
    'at',
    'ts',
    'lastLogin',
    'createdAt',
    'updatedAt',
    'weekStart',
    'generatedAt',
    'date',
    'startDate',
    'completedAt',
    'uploadDate',
  ];
  const target = candidates.find((f) => allowedFields.has(f));
  if (!target) return baseFilter;
  return { ...baseFilter, [target]: dt };
}

/**
 * Join actors/users/teachers → School so "grouped by school" works on collections
 * that do not store schoolName directly.
 */
async function aggregateGroupedBySchool({ moduleKey, model, match, limit }) {
  const collection = model.collection.name;
  let pipeline = null;

  if (moduleKey === 'impact_snapshots') {
    pipeline = [
      { $match: match },
      {
        $group: {
          _id: { school: { $ifNull: ['$schoolName', 'Unknown school'] } },
          count: { $sum: 1 },
          totalLearningSessions: { $sum: '$totalLearningSessions' },
          teachersLoggedIn: { $sum: '$teachersLoggedIn' },
          studentsAccessed: { $sum: '$studentsAccessed' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  } else if (moduleKey === 'audit_logs') {
    pipeline = [
      { $match: match },
      {
        $addFields: {
          _actorOid: {
            $convert: { input: '$actor.id', to: 'objectId', onError: null, onNull: null },
          },
        },
      },
      { $lookup: { from: 'users', localField: '_actorOid', foreignField: '_id', as: '_u' } },
      { $unwind: { path: '$_u', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'teachers', localField: '_actorOid', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _adminOid: {
            $cond: [
              { $eq: ['$_u.role', 'admin'] },
              '$_u._id',
              { $ifNull: ['$_u.assignedAdmin', '$_t.adminId'] },
            ],
          },
        },
      },
      { $lookup: { from: 'schools', localField: '_adminOid', foreignField: 'adminUserId', as: '_s' } },
      {
        $addFields: {
          schoolName: {
            $ifNull: [
              { $arrayElemAt: ['$_s.name', 0] },
              { $ifNull: ['$_u.schoolName', 'Platform / unscoped'] },
            ],
          },
        },
      },
      { $group: { _id: { school: '$schoolName' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  } else if (moduleKey === 'analytics') {
    pipeline = [
      { $match: match },
      {
        $addFields: {
          _userOid: {
            $convert: { input: '$userId', to: 'objectId', onError: null, onNull: null },
          },
        },
      },
      { $lookup: { from: 'users', localField: '_userOid', foreignField: '_id', as: '_u' } },
      { $unwind: { path: '$_u', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'teachers', localField: '_userOid', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _adminOid: {
            $cond: [
              { $eq: ['$_u.role', 'admin'] },
              '$_u._id',
              { $ifNull: ['$_u.assignedAdmin', '$_t.adminId'] },
            ],
          },
        },
      },
      { $lookup: { from: 'schools', localField: '_adminOid', foreignField: 'adminUserId', as: '_s' } },
      {
        $addFields: {
          schoolName: {
            $ifNull: [
              { $arrayElemAt: ['$_s.name', 0] },
              { $ifNull: ['$_u.schoolName', 'Platform / unscoped'] },
            ],
          },
        },
      },
      { $group: { _id: { school: '$schoolName' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  } else if (moduleKey === 'teacher_tool_usage') {
    pipeline = [
      { $match: match },
      { $lookup: { from: 'teachers', localField: 'teacherId', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'schools', localField: '_t.adminId', foreignField: 'adminUserId', as: '_s' } },
      {
        $addFields: {
          schoolName: {
            $ifNull: [{ $arrayElemAt: ['$_s.name', 0] }, 'Unknown school'],
          },
        },
      },
      { $group: { _id: { school: '$schoolName' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  } else if (moduleKey === 'ai_tool_data') {
    pipeline = [
      { $match: match },
      {
        $addFields: {
          _adminOid: {
            $ifNull: [
              '$adminId',
              {
                $convert: {
                  input: '$metadata.adminId',
                  to: 'objectId',
                  onError: null,
                  onNull: null,
                },
              },
            ],
          },
        },
      },
      { $lookup: { from: 'schools', localField: '_adminOid', foreignField: 'adminUserId', as: '_s' } },
      {
        $addFields: {
          schoolName: {
            $ifNull: [{ $arrayElemAt: ['$_s.name', 0] }, 'Platform / unscoped'],
          },
        },
      },
      { $group: { _id: { school: '$schoolName' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  } else if (allowedNativeSchoolField(model)) {
    const field = allowedNativeSchoolField(model);
    pipeline = [
      { $match: match },
      {
        $group: {
          _id: { school: { $ifNull: [`$${field}`, 'Unknown school'] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
  }

  if (!pipeline) return null;
  const rows = await model.aggregate(pipeline).option({ maxTimeMS: 10000 });
  return {
    ok: true,
    facts: {
      mode: 'database',
      module: moduleKey,
      operation: 'aggregate',
      filter: match,
      groupBy: ['school'],
      collection,
      rows: sanitizeFactRows(rows, limit),
    },
  };
}

function allowedNativeSchoolField(model) {
  const paths = model?.schema?.paths || {};
  if (paths.schoolName) return 'schoolName';
  if (paths.school) return 'school';
  return null;
}

const DEFAULT_LIST_SELECT = {
  users: ['fullName', 'email', 'role', 'classNumber', 'schoolName', 'isActive', 'lastLogin', 'createdAt'],
  students: ['fullName', 'email', 'role', 'classNumber', 'schoolName', 'isActive', 'lastLogin', 'createdAt'],
  teachers: ['fullName', 'email', 'phone', 'isActive', 'adminId', 'createdAt'],
  schools: ['name', 'place', 'board', 'phone', 'contactPerson', 'isActive', 'licensedStudents', 'licensedTeachers'],
};

function sanitizeFactRows(rows, limit = 40) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map(row => redactPlatformValue(row));

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
  if (keys.length === 0) {
    // Never return unprojected documents (password hashes / tokens).
    return Object.fromEntries([...allowedFields].filter(k => !k.includes('.')).map(k => [k, 1]));
  }
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
  access,
}) {
  const role = String(viewerRole || '').toLowerCase();
  if (!['super-admin', 'admin', 'teacher', 'student'].includes(role)) return { ok: false, error: 'Unsupported platform role.' };
  const moduleKey = resolveModuleKey(plan.module);
  if (!moduleKey) {
    return { ok: false, error: 'Could not map this question to a known application module.' };
  }
  const cfg = MODULE_REGISTRY[moduleKey];
  if (cfg?.allowedRoles && !cfg.allowedRoles.includes(role)) {
    return { ok: false, error: 'This catalog is not available for your role through the control assistant.' };
  }
  if (!cfg?.model) {
    return { ok: true, facts: { module: moduleKey, available: false, reason: cfg?.unavailableReason || 'Unavailable' } };
  }

  const model = cfg.model;
  const fields = platformReadableFields(moduleSchemaFields(model), role, moduleKey);
  const allowedFields = new Set(fields);
  const requestedFields = [...asArray(plan.selectFields), ...asArray(plan.filters).map(f => f?.field)];
  if (requestedFields.some(f => !allowedFields.has(String(f)))) return { ok: false, error: 'A requested field is unavailable for this module or role.' };
  if (asArray(plan.filters).some(f => !['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists', 'regex'].includes(f.op)
    || (f.value && typeof f.value === 'object' && !(f.value instanceof Date) && !Array.isArray(f.value))
    || (Array.isArray(f.value) && f.value.some(v => v && typeof v === 'object')))) {
    return { ok: false, error: 'Unsupported query filter.' };
  }
  if (plan.timeframe && !/^(all|today|this_week|this_month|last_\d{1,3}_days)$/.test(plan.timeframe)) return { ok: false, error: 'Unsupported timeframe.' };
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
  const resolvedAccess = access || await loadPlatformAccess(role, viewerUserId);
  if (resolvedAccess.role !== role || String(resolvedAccess.userId) !== String(viewerUserId)) return { ok: false, error: 'Account scope mismatch.' };
  const scoped = platformModuleScope(moduleKey, resolvedAccess, model);
  if (scoped.__scopeError) return { ok: false, error: scoped.__scopeError };
  let mergedBaseFilter = { $and: [base, fromPlan, scoped] };
  if (selfScopeOr.length === 1) {
    mergedBaseFilter = { ...mergedBaseFilter, ...selfScopeOr[0] };
  } else if (selfScopeOr.length > 1) {
    mergedBaseFilter = { $and: [mergedBaseFilter, { $or: selfScopeOr }] };
  }
  const basicTimeFiltered = applyTimeframe(
    mergedBaseFilter,
    plan.timeframe,
    allowedFields,
    plan.dateField || plan.preferredDateField || '',
  );
  const merged = applyModuleSpecificTimeframe({
    moduleKey,
    mergedFilter: basicTimeFiltered,
    timeframe: plan.timeframe,
    allowedFields,
  });

  const limit = Math.max(1, Math.min(100, Math.floor(Number(plan.limit) || 20)));
  for (const [field, range] of Object.entries(merged)) {
    if (model.schema.paths[field]?.instance === 'String' && ['date', 'dateKey'].includes(field) && range && typeof range === 'object') {
      for (const op of ['$gte', '$lte']) if (range[op] instanceof Date) range[op] = istYmd(range[op]);
    }
  }
  const offset = Math.max(0, Math.min(10000, Math.floor(Number(plan.offset) || 0)));
  const operation = String(plan.operation || 'list').toLowerCase();
  if (!['list', 'count', 'aggregate', 'distinct'].includes(operation)) return { ok: false, error: 'Only read operations are supported.' };

  if (operation === 'count') {
    const count = await model.countDocuments(merged).maxTimeMS(10000);
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
    const targetField = safeField(plan.selectFields?.[0], allowedFields);
    if (!targetField) return { ok: false, error: 'Choose an available distinct field.' };
    const values = await model.distinct(targetField, merged).maxTimeMS(10000);
    return {
      ok: true,
      facts: {
        mode: 'database',
        module: moduleKey,
        operation: 'distinct',
        filter: merged,
        field: targetField,
        totalDistinct: values.length,
        values: redactPlatformValue(values.slice(0, limit)),
      },
    };
  }

  if (operation === 'aggregate') {
    if (asArray(plan.groupBy).some(f => ['school', 'schools', 'schoolName'].includes(f)) && asArray(plan.aggregates).every(a => a.func === 'count')) {
      const schoolAgg = await aggregateGroupedBySchool({
        moduleKey,
        model,
        match: model.find(merged).cast(model),
        limit,
      });
      if (schoolAgg) return schoolAgg;
    }

    if (asArray(plan.groupBy).some(f => !allowedFields.has(f))) return { ok: false, error: 'Requested grouping field is unavailable.' };
    const groupBy = asArray(plan.groupBy).map((f) => safeField(f, allowedFields)).filter(Boolean);
    const aggs = asArray(plan.aggregates).slice(0, 5);
    if (aggs.some(a => !['count', 'sum', 'avg', 'min', 'max'].includes(a.func) || (a.func !== 'count' && !allowedFields.has(a.field)))) return { ok: false, error: 'Requested aggregate is unavailable.' };
    const groupStage = { _id: {} };
    if (groupBy.length === 0) groupStage._id = null;
    else {
      for (const g of groupBy) groupStage._id[g.replace(/\./g, '_')] = `$${g}`;
    }
    let hasMetric = false;
    for (const a of aggs) {
      const func = String(a?.func || '').toLowerCase();
      const as = String(a?.as || `${func}_metric`).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
      if (!as || as === '_id' || isPrivateField(as)) continue;
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

    const sort = safeSort(plan.sort, new Set(Object.keys(groupStage))) || { [Object.keys(groupStage).find(k => k !== '_id') || '_id']: -1 };
    const rows = await model.aggregate([
      { $match: model.find(merged).cast(model) },
      { $group: groupStage },
      { $sort: sort },
      { $limit: limit },
    ]).option({ maxTimeMS: 10000 });

    return {
      ok: true,
      facts: {
        mode: 'database',
        module: moduleKey,
        operation: 'aggregate',
        filter: merged,
        groupBy,
        rows: sanitizeFactRows(rows, limit),
      },
    };
  }

  let selectFields = Array.isArray(plan.selectFields) ? plan.selectFields : [];
  if (!selectFields.length && DEFAULT_LIST_SELECT[moduleKey]) {
    selectFields = DEFAULT_LIST_SELECT[moduleKey];
  }
  const projection = safeProjection(selectFields, allowedFields);
  const sort =
    safeSort(plan.sort, allowedFields) ||
    (allowedFields.has('lastLogin') && String(plan.dateField || '') === 'lastLogin'
      ? { lastLogin: -1 }
      : allowedFields.has('createdAt')
        ? { createdAt: -1 }
        : { _id: -1 });
  let q = model.find(merged);
  if (projection) q = q.select(projection);
  const [rows, totalMatched] = await Promise.all([
    q.sort(sort).skip(offset).limit(limit).maxTimeMS(10000).lean(),
    model.countDocuments(merged).maxTimeMS(10000),
  ]);
  return {
    ok: true,
    facts: {
      mode: 'database',
      module: moduleKey,
      operation: 'list',
      filter: merged,
      limit,
      offset,
      totalMatched,
      hasMore: offset + rows.length < totalMatched,
      nextOffset: offset + rows.length < totalMatched ? offset + rows.length : null,
      totalReturned: rows.length,
      rows: sanitizeFactRows(rows, limit),
    },
  };
}
