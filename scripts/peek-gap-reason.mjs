import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const AiToolGeneration = (await import('../models/AiToolGeneration.js')).default;
const { checkRecordSectionGap } = await import('../services/ai-tool-data-audit-service.js');
const { validateDashboardAiToolDoc } = await import('../services/ai-tool-dashboard-validation.js');

for (const slug of ['concept-mastery-helper', 'worksheet-mcq-generator', 'lesson-planner', 'flashcard-generator']) {
  const doc = await AiToolGeneration.findOne({ toolName: slug, sourceType: { $ne: 'ai_pdf' } })
    .sort({ createdAt: -1 })
    .lean();
  if (!doc) {
    console.log(slug, 'NO DOC');
    continue;
  }
  const row = {
    toolName: doc.toolName,
    toolDisplayName: doc.toolDisplayName,
    sourceType: doc.sourceType,
    content: doc.content || doc.generatedContent,
    generatedContent: doc.generatedContent || doc.content,
    metadata: doc.metadata,
  };
  const gap = checkRecordSectionGap(row);
  const gate = validateDashboardAiToolDoc(row.toolName, row);
  console.log(
    JSON.stringify(
      {
        slug,
        gapComplete: gap.complete,
        missing: gap.missingSections?.slice(0, 6),
        optional: gap.optionalMissingSections?.slice(0, 4),
        valid: gate.valid,
        code: gate.code,
        message: gate.message || gate.reason,
        errors: Array.isArray(gate.errors) ? gate.errors.slice(0, 4) : undefined,
      },
      null,
      2,
    ),
  );
}
await mongoose.disconnect();
