#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import PdfChunk from '../models/PdfChunk.js';
import PdfKnowledgeSource from '../models/PdfKnowledgeSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) || 0 : 0;

const log = (...args) => console.log('[migrate-pdf-chunks]', ...args);

const LEGACY_TAG = 'migrated-from-PdfChunk';

const ensureContentEngineSource = async (legacySource) => {
  if (!legacySource) return null;
  const fileName = legacySource.fileName || legacySource.title || `migrated-${legacySource._id}.pdf`;
  const exists = await AiContentEngineSource.findOne({
    fileName,
    subject: legacySource.subject || '',
    classLabel: legacySource.classLabel || '',
    chapter: legacySource.chapter || '',
  }).lean();
  if (exists) return exists;
  const created = await AiContentEngineSource.create({
    fileName,
    originalName: legacySource.title || fileName,
    fileUrl: legacySource.fileUrl || '',
    storageProvider: legacySource.storageProvider || 'local',
    storageKey: legacySource.storageKey || '',
    subject: legacySource.subject || 'General',
    classLabel: legacySource.classLabel || 'General',
    chapter: legacySource.chapter || 'General',
    topic: legacySource.topic || legacySource.chapter || '',
    subTopic: legacySource.subTopic || '',
    toolType: legacySource.toolType || '',
    chunkCount: legacySource.chunkCount || 0,
    extractedTextLength: legacySource.extractedTextLength || 0,
    processingStatus: 'processed',
    uploadedBy: 'system-migration',
    uploadedByRole: 'super-admin',
    reviewComment: `${LEGACY_TAG}:${legacySource._id}`,
  });
  return created;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Aborting.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  log('Connected to MongoDB');

  const totalLegacy = await PdfChunk.countDocuments();
  const totalEngine = await AiContentEngineChunk.countDocuments();
  log(`Legacy PdfChunk count: ${totalLegacy}`);
  log(`AiContentEngineChunk count: ${totalEngine}`);

  if (totalLegacy === 0) {
    log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  const cursor = PdfChunk.find({}).lean().cursor();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const sourceCache = new Map();

  for await (const chunk of cursor) {
    if (limit && migrated + skipped >= limit) break;
    try {
      const legacySourceId = String(chunk.sourcePdfId || '');
      let mappedSource = sourceCache.get(legacySourceId);
      if (!mappedSource) {
        const legacySource = legacySourceId
          ? await PdfKnowledgeSource.findById(legacySourceId).lean()
          : null;
        mappedSource = await ensureContentEngineSource(legacySource);
        if (mappedSource) sourceCache.set(legacySourceId, mappedSource);
      }
      if (!mappedSource) {
        skipped += 1;
        continue;
      }

      const exists = await AiContentEngineChunk.findOne({
        sourcePdfId: mappedSource._id,
        chunkIndex: chunk.chunkIndex,
      })
        .select('_id')
        .lean();
      if (exists) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        migrated += 1;
        continue;
      }

      await AiContentEngineChunk.create({
        sourcePdfId: mappedSource._id,
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        embedding: chunk.embedding || [],
        embeddingModel: chunk.embeddingModel || 'local-hash-256',
        tokenCount: chunk.tokenCount || 0,
        subject: chunk.subject || mappedSource.subject || '',
        classLabel: chunk.classLabel || mappedSource.classLabel || '',
        chapter: chunk.chapter || mappedSource.chapter || '',
        topic: mappedSource.topic || chunk.chapter || '',
        subTopic: mappedSource.subTopic || '',
        toolType: mappedSource.toolType || '',
      });
      migrated += 1;
      if (migrated % 100 === 0) log(`Migrated ${migrated} chunks so far...`);
    } catch (err) {
      errors += 1;
      console.error('Failed to migrate chunk', chunk._id, err.message);
    }
  }

  log(`Done. migrated=${migrated} skipped=${skipped} errors=${errors} dryRun=${dryRun}`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
