import mongoose from 'mongoose';

const omrResultBatchSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    testNo: { type: String, trim: true, default: '', index: true },
    testTitle: { type: String, trim: true, required: true },
    testDate: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rowCount: { type: Number, default: 0 },
    assignedCount: { type: Number, default: 0 },
    sourceFileName: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

omrResultBatchSchema.index({ adminId: 1, createdAt: -1 });
omrResultBatchSchema.index({ adminId: 1, testNo: 1 });

const OmrResultBatch =
  mongoose.models.OmrResultBatch || mongoose.model('OmrResultBatch', omrResultBatchSchema);

export default OmrResultBatch;
