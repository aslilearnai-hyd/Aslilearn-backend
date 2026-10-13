import mongoose from 'mongoose';

const assessmentAssetSchema = new mongoose.Schema(
  {
    assetId: { type: String, required: true, unique: true, index: true },
    cacheKey: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['generated_diagram'], default: 'generated_diagram' },
    imageUrl: { type: String, required: true },
    prompt: { type: String, default: '' },
    subject: { type: String, default: '', index: true },
    classLabel: { type: String, default: '' },
    topic: { type: String, default: '' },
    subtopic: { type: String, default: '' },
    approvalStatus: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected', 'archived'],
      default: 'pending_review',
      index: true,
    },
    model: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.Mixed, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

assessmentAssetSchema.index({ approvalStatus: 1, subject: 1, createdAt: -1 });

export default mongoose.models.AssessmentAsset || mongoose.model('AssessmentAsset', assessmentAssetSchema);
