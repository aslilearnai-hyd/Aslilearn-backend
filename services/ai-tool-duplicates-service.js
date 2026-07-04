import mongoose from 'mongoose';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { contentFingerprint, wordJaccardSimilarity } from '../utils/ai-generator-dedup.js';

const PREVIEW_LEN = 180;
const DEFAULT_SIMILARITY = 0.82;
const MIN_QUESTION_OVERLAP = 0.45;

function activeRecordFilter() {
  return {
    status: { $nin: ['inactive', 'archived', 'deleted'] },
    reviewStatus: { $nin: ['archived', 'rejected'] },
    $or: [
      { 'metadata.mergedInto': { $exists: false } },
      { 'metadata.mergedInto': null },
      { 'metadata.mergedInto': '' },
    ],
  };
}

function scopeKey(doc) {
  return [
    String(doc.toolName || '').trim().toLowerCase(),
    String(doc.board || '').trim().toUpperCase(),
    String(doc.classLabel || '').trim().toLowerCase(),
    String(doc.subject || '').trim().toLowerCase(),
    String(doc.topic || '').trim().toLowerCase(),
    String(doc.subtopic || '').trim().toLowerCase(),
  ].join('::');
}

/** Unwrap `{ formatted, raw }` envelopes so previews are human-readable. */
function unwrapStoredContent(raw) {
  let text = String(raw || '').trim();
  for (let i = 0; i < 2; i += 1) {
    if (!text.startsWith('{') && !text.startsWith('[')) break;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.formatted === 'string') {
        text = String(parsed.formatted || '').trim();
        continue;
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const title =
          parsed.flashcard_deck_title ||
          parsed.deck_title ||
          parsed.title ||
          parsed.paper_title ||
          '';
        if (title) return String(title).trim();
      }
    } catch {
      break;
    }
    break;
  }
  return text;
}

function bodyText(doc) {
  // Prefer short preview slice (fast path) over full generatedContent.
  if (doc.previewRaw != null) return unwrapStoredContent(doc.previewRaw);
  return unwrapStoredContent(doc.generatedContent || doc.content || '');
}

function titleFromBody(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const cleaned = line
      .replace(/^#+\s*/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .replace(/^Deck Title:\s*/i, '')
      .replace(/^Title:\s*/i, '')
      .trim();
    if (cleaned.length >= 4 && cleaned.length <= 120 && !cleaned.startsWith('{')) {
      return cleaned;
    }
  }
  return '';
}

function previewText(doc) {
  const text = bodyText(doc);
  if (!text) return '(empty)';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > PREVIEW_LEN ? `${compact.slice(0, PREVIEW_LEN)}…` : compact;
}

function displayTitle(doc) {
  const structured = doc?.structuredContent || doc?.metadata?.structuredContent;
  if (structured && typeof structured === 'object') {
    const fromMeta =
      structured.flashcard_deck_title ||
      structured.deck_title ||
      structured.title ||
      structured.paper_title ||
      structured.worksheet_title ||
      '';
    if (String(fromMeta).trim()) return String(fromMeta).trim();
  }
  return titleFromBody(bodyText(doc)) || 'Untitled record';
}

function fingerprintOf(doc) {
  const stored = String(
    doc?.contentFingerprint || doc?.metadata?.contentFingerprint || '',
  ).trim();
  if (stored) return stored;
  // Only hash the short preview slice — never full multi-KB bodies during scan.
  const body = bodyText(doc);
  return body.length >= 40 ? contentFingerprint(body) : '';
}

function questionFingerprints(doc) {
  const list = doc?.questionFingerprints || doc?.metadata?.questionFingerprints;
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}

function questionOverlapRatio(a, b) {
  const sa = new Set(questionFingerprints(a));
  const sb = new Set(questionFingerprints(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const fp of sa) {
    if (sb.has(fp)) inter += 1;
  }
  const denom = Math.min(sa.size, sb.size);
  return denom > 0 ? inter / denom : 0;
}

function areSimilar(a, b, threshold) {
  const fa = fingerprintOf(a);
  const fb = fingerprintOf(b);
  if (fa && fb && fa === fb) {
    return { similar: true, similarity: 1, reason: 'identical_fingerprint' };
  }

  const qOverlap = questionOverlapRatio(a, b);
  if (qOverlap >= MIN_QUESTION_OVERLAP) {
    return {
      similar: true,
      similarity: Math.max(qOverlap, 0.85),
      reason: 'question_overlap',
    };
  }

  // Cheap preview-only text compare (first ~500 chars), not full document bodies.
  const bodyA = bodyText(a);
  const bodyB = bodyText(b);
  if (bodyA.length >= 40 && bodyB.length >= 40) {
    const sim = wordJaccardSimilarity(bodyA.slice(0, 500), bodyB.slice(0, 500));
    if (sim >= threshold) {
      return { similar: true, similarity: sim, reason: 'content_similarity' };
    }
  }

  return { similar: false, similarity: qOverlap, reason: '' };
}

/** Union-find clustering within one curriculum scope. */
function clusterSimilar(docs, threshold) {
  const n = docs.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  const edgeMeta = new Map();

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const result = areSimilar(docs[i], docs[j], threshold);
      if (!result.similar) continue;
      union(i, j);
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      edgeMeta.set(key, result);
    }
  }

  const buckets = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(i);
  }

  return Array.from(buckets.values())
    .filter((idxs) => idxs.length >= 2)
    .map((idxs) => {
      let bestSim = 0;
      let reason = 'content_similarity';
      for (let a = 0; a < idxs.length; a += 1) {
        for (let b = a + 1; b < idxs.length; b += 1) {
          const i = idxs[a];
          const j = idxs[b];
          const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
          const meta = edgeMeta.get(key);
          if (meta && meta.similarity > bestSim) {
            bestSim = meta.similarity;
            reason = meta.reason;
          }
        }
      }
      return { indices: idxs, similarity: bestSim, reason };
    });
}

function scoreRecord(doc) {
  const structured = doc?.structuredContent || doc?.metadata?.structuredContent;
  const hasStructured =
    structured && typeof structured === 'object' && Object.keys(structured).length > 0;
  const qCount = questionFingerprints(doc).length;
  return (
    (hasStructured ? 1000 : 0) +
    qCount * 10 +
    (doc.reviewStatus === 'approved' ? 50 : 0) +
    (doc.createdAt ? new Date(doc.createdAt).getTime() / 1e13 : 0)
  );
}

function toMember(doc, isSuggestedPrimary) {
  return {
    _id: String(doc._id),
    toolName: doc.toolName || '',
    toolDisplayName: doc.toolDisplayName || doc.toolName || '',
    board: doc.board || '',
    classLabel: doc.classLabel || '',
    subject: doc.subject || '',
    topic: doc.topic || '',
    subtopic: doc.subtopic || '',
    sourceType: doc.sourceType || 'legacy',
    reviewStatus: doc.reviewStatus || 'approved',
    createdAt: doc.createdAt,
    title: displayTitle(doc),
    preview: previewText(doc),
    contentFingerprint: fingerprintOf(doc),
    questionCount: questionFingerprints(doc).length,
    suggestedPrimary: isSuggestedPrimary,
  };
}

const MAX_PER_SCOPE_CLUSTER = 300;

/**
 * Find duplicate groups in AI Tool Data (active records only).
 * Scans the full active collection: first finds scopes with 2+ records, then loads those only.
 */
export async function findAiToolDuplicateGroups(options = {}) {
  const threshold =
    Number.isFinite(options.threshold) && options.threshold > 0 && options.threshold < 1
      ? options.threshold
      : DEFAULT_SIMILARITY;
  const limitGroups = Math.min(Math.max(Number(options.limit) || 500, 1), 2000);

  const filter = { ...activeRecordFilter() };
  if (options.toolName) filter.toolName = String(options.toolName).trim();
  if (options.board) filter.board = String(options.board).trim();
  if (options.classLabel) filter.classLabel = String(options.classLabel).trim();
  if (options.subject) filter.subject = String(options.subject).trim();

  // Sort newest-first so $push order is recent-first, then $slice keeps newest only.
  const [totalActive, scopeBuckets] = await Promise.all([
    AiToolGeneration.countDocuments(filter),
    AiToolGeneration.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            toolName: { $toLower: { $ifNull: ['$toolName', ''] } },
            board: { $toUpper: { $ifNull: ['$board', ''] } },
            classLabel: { $toLower: { $ifNull: ['$classLabel', ''] } },
            subject: { $toLower: { $ifNull: ['$subject', ''] } },
            topic: { $toLower: { $ifNull: ['$topic', ''] } },
            subtopic: { $toLower: { $ifNull: ['$subtopic', ''] } },
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gte: 2 } } },
      {
        $project: {
          count: 1,
          ids: { $slice: ['$ids', MAX_PER_SCOPE_CLUSTER] },
          truncated: { $gt: ['$count', MAX_PER_SCOPE_CLUSTER] },
        },
      },
      { $sort: { count: -1 } },
    ]),
  ]);

  const candidateIds = [];
  let scopesTruncated = 0;
  for (const bucket of scopeBuckets) {
    if (bucket.truncated) scopesTruncated += 1;
    const ids = Array.isArray(bucket.ids) ? bucket.ids : [];
    for (const id of ids) candidateIds.push(id);
  }

  // Lightweight projection only — never load full generatedContent bodies for scan.
  const docs =
    candidateIds.length === 0
      ? []
      : await AiToolGeneration.aggregate([
          { $match: { _id: { $in: candidateIds } } },
          {
            $project: {
              toolName: 1,
              toolDisplayName: 1,
              board: 1,
              classLabel: 1,
              subject: 1,
              topic: 1,
              subtopic: 1,
              sourceType: 1,
              reviewStatus: 1,
              status: 1,
              createdAt: 1,
              contentFingerprint: '$metadata.contentFingerprint',
              questionFingerprints: '$metadata.questionFingerprints',
              structuredContent: '$metadata.structuredContent',
              previewRaw: {
                $substrCP: [
                  {
                    $ifNull: ['$generatedContent', { $ifNull: ['$content', ''] }],
                  },
                  0,
                  500,
                ],
              },
            },
          },
        ]);

  const byScope = new Map();
  for (const doc of docs) {
    const key = scopeKey(doc);
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key).push(doc);
  }

  const groups = [];

  for (const [key, scopeDocs] of byScope.entries()) {
    if (scopeDocs.length < 2) continue;
    const clusters = clusterSimilar(scopeDocs, threshold);
    for (const cluster of clusters) {
      const members = cluster.indices.map((i) => scopeDocs[i]);
      members.sort((a, b) => scoreRecord(b) - scoreRecord(a));
      const primary = members[0];
      groups.push({
        groupId: `${key}::${fingerprintOf(primary) || String(primary._id)}`,
        toolName: primary.toolName || '',
        toolDisplayName: primary.toolDisplayName || primary.toolName || '',
        board: primary.board || '',
        classLabel: primary.classLabel || '',
        subject: primary.subject || '',
        topic: primary.topic || '',
        subtopic: primary.subtopic || '',
        similarity: Number(cluster.similarity.toFixed(3)),
        reason: cluster.reason,
        count: members.length,
        suggestedPrimaryId: String(primary._id),
        members: members.map((m) => toMember(m, String(m._id) === String(primary._id))),
      });
    }
  }

  groups.sort((a, b) => b.count - a.count || b.similarity - a.similarity);
  const visible = groups.slice(0, limitGroups);

  let totalRecordsInGroups = 0;
  let totalExtraRecords = 0;
  for (const group of groups) {
    const n = Number(group.count) || 0;
    totalRecordsInGroups += n;
    totalExtraRecords += Math.max(0, n - 1);
  }

  return {
    totalGroups: groups.length,
    /** All records that sit inside a duplicate group (primaries + extras). */
    totalRecordsInGroups,
    /** Extras that can be archived if every group is merged (keep 1 primary each). */
    totalExtraRecords,
    /** One primary kept per group if all groups are merged. */
    totalPrimaryRecords: groups.length,
    groups: visible,
    scannedRecords: totalActive,
    candidateRecords: docs.length,
    scopesWithMultiples: scopeBuckets.length,
    scopesTruncated,
    truncatedGroups: groups.length > visible.length,
    threshold,
  };
}

/**
 * Merge duplicates: keep primary active, archive the rest.
 */
export async function mergeAiToolDuplicates({
  primaryId,
  duplicateIds = [],
  mergedBy = 'super-admin',
}) {
  if (!mongoose.Types.ObjectId.isValid(primaryId)) {
    throw Object.assign(new Error('Invalid primary id'), { status: 400 });
  }

  const dupIds = [...new Set((duplicateIds || []).map(String).filter(Boolean))].filter(
    (id) => id !== String(primaryId) && mongoose.Types.ObjectId.isValid(id),
  );

  if (!dupIds.length) {
    throw Object.assign(new Error('Select at least one duplicate to merge'), { status: 400 });
  }

  const primary = await AiToolGeneration.findById(primaryId);
  if (!primary) {
    throw Object.assign(new Error('Primary record not found'), { status: 404 });
  }
  if (primary.reviewStatus === 'archived' || primary.status === 'archived') {
    throw Object.assign(new Error('Primary record is already archived'), { status: 400 });
  }

  const now = new Date();
  const result = await AiToolGeneration.updateMany(
    {
      _id: { $in: dupIds },
      reviewStatus: { $ne: 'archived' },
    },
    {
      $set: {
        reviewStatus: 'archived',
        status: 'archived',
        reviewedAt: now,
        reviewedBy: mergedBy,
        reviewerNotes: `Merged into ${primaryId}`,
        'metadata.mergedInto': String(primaryId),
        'metadata.duplicateMergedAt': now.toISOString(),
        'metadata.mergedBy': String(mergedBy),
      },
    },
  );

  const meta = primary.metadata && typeof primary.metadata === 'object' ? { ...primary.metadata } : {};
  const mergedFrom = Array.isArray(meta.mergedFromIds) ? meta.mergedFromIds.map(String) : [];
  for (const id of dupIds) {
    if (!mergedFrom.includes(id)) mergedFrom.push(id);
  }
  meta.mergedFromIds = mergedFrom;
  meta.lastMergeAt = now.toISOString();
  primary.metadata = meta;
  primary.reviewStatus = primary.reviewStatus === 'rejected' ? 'approved' : primary.reviewStatus || 'approved';
  if (primary.status === 'archived' || primary.status === 'inactive') {
    primary.status = 'active';
  }
  primary.markModified('metadata');
  await primary.save();

  return {
    primaryId: String(primary._id),
    archivedCount: result.modifiedCount || 0,
    duplicateIds: dupIds,
  };
}

/**
 * Merge every duplicate group: keep suggested primary, archive all extras.
 */
export async function mergeAllAiToolDuplicates(options = {}) {
  const scan = await findAiToolDuplicateGroups({
    ...options,
    limit: 2000,
  });

  const groups = Array.isArray(scan.groups) ? scan.groups : [];
  if (!groups.length) {
    return {
      groupsMerged: 0,
      archivedCount: 0,
      primariesKept: 0,
      totalExtraRecords: 0,
    };
  }

  const mergedBy = options.mergedBy || 'super-admin';
  let archivedCount = 0;
  let groupsMerged = 0;
  const failures = [];

  for (const group of groups) {
    const primaryId = String(group.suggestedPrimaryId || group.members?.[0]?._id || '');
    const duplicateIds = (group.members || [])
      .map((m) => String(m._id))
      .filter((id) => id && id !== primaryId);
    if (!primaryId || !duplicateIds.length) continue;
    try {
      const result = await mergeAiToolDuplicates({
        primaryId,
        duplicateIds,
        mergedBy,
      });
      archivedCount += result.archivedCount || 0;
      groupsMerged += 1;
    } catch (error) {
      failures.push({
        groupId: group.groupId,
        primaryId,
        message: error?.message || 'Merge failed',
      });
    }
  }

  return {
    groupsMerged,
    archivedCount,
    primariesKept: groupsMerged,
    totalExtraRecords: scan.totalExtraRecords || 0,
    totalGroups: scan.totalGroups || groups.length,
    failures,
  };
}
