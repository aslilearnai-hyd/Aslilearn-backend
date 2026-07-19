import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import fs from 'fs';

dns.setServers(['8.8.8.8', '1.1.1.1', '192.168.1.1']);
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SAMPLE_PER_TOOL = 120;

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 25000 });
console.error('Connected');

const { AI_TOOL_ORDERED_SLUGS, getAiToolTemplate } = await import('../config/aiToolTemplates.js');
const { checkRecordSectionGap } = await import('../services/ai-tool-data-audit-service.js');
const AiToolGeneration = (await import('../models/AiToolGeneration.js')).default;
const AIGeneratorRecord = (await import('../models/AIGeneratorRecord.js')).default;

const MASTER_FIELDS =
  'toolName toolDisplayName sourceType board classLabel subject topic subtopic content generatedContent createdAt metadata';
const LEGACY_FIELDS =
  'toolSlug toolName className subjectName topicName subtopicName board generatedContent createdAt';

function mapMaster(doc) {
  return {
    _id: doc._id,
    sourceType: doc.sourceType || 'legacy',
    toolName: doc.toolName || '',
    toolDisplayName: doc.toolDisplayName || '',
    board: doc.board || '',
    classLabel: doc.classLabel || '',
    subject: doc.subject || '',
    topic: doc.topic || '',
    subtopic: doc.subtopic || '',
    createdAt: doc.createdAt || null,
    content: doc.content || doc.generatedContent || '',
    generatedContent: doc.generatedContent || doc.content || '',
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : undefined,
  };
}

function mapLegacy(doc) {
  return {
    _id: doc._id,
    sourceType: 'ai_generator',
    toolName: doc.toolSlug || doc.toolName || '',
    toolDisplayName: doc.toolName || doc.toolSlug || '',
    board: doc.board || '',
    classLabel: doc.className || '',
    subject: doc.subjectName || '',
    topic: doc.topicName || '',
    subtopic: doc.subtopicName || '',
    createdAt: doc.createdAt || null,
    content: doc.generatedContent || '',
    generatedContent: doc.generatedContent || '',
    metadata: { source: 'ai_generators_legacy_collection' },
  };
}

const tools = [];
for (const slug of AI_TOOL_ORDERED_SLUGS) {
  const t = getAiToolTemplate(slug);
  const [masterTotal, legacyTotal, masterRows, legacyRows] = await Promise.all([
    AiToolGeneration.countDocuments({ toolName: slug, sourceType: { $ne: 'ai_pdf' } }),
    AIGeneratorRecord.countDocuments({ toolSlug: slug }),
    AiToolGeneration.find({ toolName: slug, sourceType: { $ne: 'ai_pdf' } })
      .select(MASTER_FIELDS)
      .sort({ createdAt: -1 })
      .limit(SAMPLE_PER_TOOL)
      .lean(),
    AIGeneratorRecord.find({ toolSlug: slug })
      .select(LEGACY_FIELDS)
      .sort({ createdAt: -1 })
      .limit(SAMPLE_PER_TOOL)
      .lean(),
  ]);

  const rows = [
    ...masterRows.map(mapMaster),
    ...legacyRows.map(mapLegacy),
  ].slice(0, SAMPLE_PER_TOOL);

  let incomplete = 0;
  const missingFreq = {};
  for (const row of rows) {
    const gap = checkRecordSectionGap(row);
    if (!gap.complete) {
      incomplete += 1;
      for (const s of gap.missingSections || []) {
        missingFreq[s] = (missingFreq[s] || 0) + 1;
      }
    }
  }

  const topMissing = Object.entries(missingFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => `${name} (${n})`);

  const scanned = rows.length;
  const incompletePct = scanned ? Math.round((100 * incomplete) / scanned) : 0;
  const records = masterTotal + legacyTotal;

  // Completeness sub-score 0–10 from incomplete%
  const completenessScore =
    scanned === 0 ? 3 : Math.max(0, Math.min(10, Math.round(10 - incompletePct / 10)));

  tools.push({
    slug,
    title: t?.title || slug,
    sections: t?.canonicalHeadings?.length || 0,
    records,
    scanned,
    incomplete,
    incompletePct,
    completenessScore,
    topMissing,
  });

  console.error(
    `${slug}: records=${records} scanned=${scanned} incomplete=${incomplete} (${incompletePct}%) score=${completenessScore}`,
  );
}

const payload = {
  scannedAt: new Date().toISOString(),
  samplePerTool: SAMPLE_PER_TOOL,
  totalRecords: tools.reduce((s, t) => s + t.records, 0),
  tools,
};

const outPath = path.join(__dirname, '..', 'qa-results', 'ai-tools-live-scorecard.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
await mongoose.disconnect();
