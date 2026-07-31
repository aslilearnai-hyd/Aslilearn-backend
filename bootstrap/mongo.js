import mongoose from 'mongoose';
import { configureMongoDns } from '../config/mongo-dns.js';
import { MONGOOSE_CONNECT_OPTIONS, attachMongooseConnectionListeners } from '../config/mongoose-options.js';

/**
 * Connect MongoDB and run post-connect index/seed hooks.
 * Does not delete or wipe school/user data.
 */
export async function connectMongo() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not set in environment variables!');
    process.exit(1);
  }

  const uriForLogging = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  const dbName = MONGO_URI.split('/').pop()?.split('?')[0] || 'Unknown';
  console.log('🔌 Connecting to MongoDB...');
  console.log('📍 URI:', uriForLogging);
  console.log('📦 Database:', dbName);

  configureMongoDns();
  mongoose.set('bufferTimeoutMS', 10_000);

  await mongoose.connect(MONGO_URI, MONGOOSE_CONNECT_OPTIONS);
  attachMongooseConnectionListeners(mongoose.connection);
  console.log('✅ Connected to MongoDB Atlas');
  console.log('📊 Database Name:', mongoose.connection.db.databaseName);
  console.log(
    '🔗 Connection State:',
    mongoose.connection.readyState === 1 ? 'Connected' : 'Not Connected',
  );

  const { initializeBoards } = await import('../controllers/boardController.js');
  await initializeBoards();

  try {
    const { ensureDefaultProductCategories } = await import('../constants/products.js');
    await ensureDefaultProductCategories();
  } catch (seedErr) {
    console.warn('Product category seed skipped:', seedErr?.message || seedErr);
  }
  try {
    const { ensureSubjectIndexes } = await import('../models/Subject.js');
    await ensureSubjectIndexes();
  } catch (idxErr) {
    console.warn('Subject index ensure skipped:', idxErr?.message || idxErr);
  }
  try {
    const { ensureAiToolTopicIndexes } = await import('../models/AiToolTopic.js');
    await ensureAiToolTopicIndexes();
  } catch (idxErr) {
    console.warn('AI tool topic index ensure skipped:', idxErr?.message || idxErr);
  }
  try {
    const { backfillLegacyIitContentToAlpha } = await import('../utils/backfill-legacy-alpha.js');
    await backfillLegacyIitContentToAlpha();
  } catch (bfErr) {
    console.warn('Legacy Alpha backfill skipped:', bfErr?.message || bfErr);
  }
}
