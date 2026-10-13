import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { auditAiToolRecordQuality } from '../ai/validation/ai-tool-record-quality.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const reportArg = process.argv.find((arg) => arg.startsWith('--report='));
const limit = Math.max(0, Number(limitArg?.split('=')[1]) || 0);
const reportPath = reportArg?.slice('--report='.length) || '';

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL ||
  '';
if (!mongoUri) throw new Error('MONGODB_URI/MONGO_URI/DATABASE_URL is not configured.');

await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

const projection =
  'toolName toolDisplayName sourceType board productCategory classLabel subject topic subtopic content generatedContent metadata status reviewStatus createdAt';
let query = AiToolGeneration.find({ status: { $ne: 'archived' } }).select(projection).sort({ _id: 1 });
if (limit > 0) query = query.limit(limit);

const stats = {
  mode: apply ? 'apply' : 'dry-run',
  scanned: 0,
  valid: 0,
  invalid: 0,
  repaired: 0,
  quarantined: 0,
  warningsOnly: 0,
  byCode: {},
  samples: [],
};

for await (const doc of query.cursor()) {
  stats.scanned += 1;
  const row = doc.toObject();
  let audit = auditAiToolRecordQuality(row);

  for (const finding of audit.issues) {
    stats.byCode[finding.code] = (stats.byCode[finding.code] || 0) + 1;
  }

  const update = {};
  if (audit.repair?.structuredContent) {
    update['metadata.structuredContent'] = audit.repair.structuredContent;
    if (audit.repair.syncJsonContent) {
      const json = JSON.stringify(audit.repair.structuredContent);
      update.content = json;
      update.generatedContent = json;
    }
    const repairedRow = {
      ...row,
      content: update.content || row.content,
      generatedContent: update.generatedContent || row.generatedContent,
      metadata: { ...(row.metadata || {}), structuredContent: audit.repair.structuredContent },
    };
    audit = auditAiToolRecordQuality(repairedRow);
    stats.repaired += 1;
  }

  if (audit.valid) {
    stats.valid += 1;
    if (audit.warningCount > 0) stats.warningsOnly += 1;
  } else {
    stats.invalid += 1;
    update.reviewStatus = 'under_review';
    update.reviewerNotes = `Automated quality audit: ${audit.issues
      .filter((item) => item.severity === 'error')
      .map((item) => item.code)
      .join(', ')}`.slice(0, 1000);
    stats.quarantined += 1;
  }

  update['metadata.qualityAudit'] = {
    version: 1,
    auditedAt: new Date(),
    valid: audit.valid,
    issues: audit.issues.map(({ code, severity, message }) => ({ code, severity, message })),
  };

  if (apply && Object.keys(update).length) {
    await AiToolGeneration.updateOne({ _id: doc._id }, { $set: update });
  }

  if (!audit.valid && stats.samples.length < 100) {
    stats.samples.push({
      id: String(doc._id),
      toolName: row.toolName,
      classLabel: row.classLabel,
      subject: row.subject,
      topic: row.topic,
      subtopic: row.subtopic,
      issues: audit.issues,
    });
  }
}

stats.finishedAt = new Date().toISOString();
if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(stats, null, 2));
await mongoose.disconnect();

