// Read-only aggregation. Never prints credentials, prompts or student data.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
try {
  if (!process.env.MONGO_URI) throw new Error('Missing database configuration');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000, autoIndex: false, autoCreate: false });
  const rows = await mongoose.connection.db.collection('aitoolgenerations').aggregate([
    { $project: { toolName: 1, sourceType: 1, createdAt: 1,
      input: '$metadata.tokenUsage.totals.promptTokens', output: '$metadata.tokenUsage.totals.completionTokens',
      allocated: { $ne: [{ $ifNull: ['$metadata.tokenUsage.batchTotals', null] }, null] } } },
    { $group: { _id: { tool: '$toolName', source: '$sourceType' }, records: { $sum: 1 },
      measured: { $sum: { $cond: [{ $and: [{ $isNumber: '$input' }, { $isNumber: '$output' }] }, 1, 0] } },
      inputTokens: { $sum: '$input' }, outputTokens: { $sum: '$output' },
      allocatedRecords: { $sum: { $cond: ['$allocated', 1, 0] } }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
    { $sort: { '_id.tool': 1, '_id.source': 1 } },
  ], { maxTimeMS: 30000 }).toArray();
  console.log(JSON.stringify({ source: 'aitoolgenerations; all retained records', rows }, null, 2));
} catch (error) {
  console.error('Read-only token report failed:', error.name, error.code || '', /Missing/.test(error.message) ? error.message : 'Database unavailable; no records changed.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
