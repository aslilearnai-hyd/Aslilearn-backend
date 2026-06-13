import mongoose from 'mongoose';

const aiGenerationFingerprintSchema = new mongoose.Schema(
  {
    toolSlug: { type: String, required: true, index: true },
    board: { type: String, default: '', index: true },
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    topic: { type: String, default: '', index: true },
    subtopic: { type: String, default: '', index: true },
    contentType: {
      type: String,
      enum: [
        'title',
        'objective',
        'question',
        'activity',
        'assignment',
        'flashcard',
        'assessment',
        'explanation',
        'note',
        'body',
        'other',
      ],
      required: true,
      index: true,
    },
    fingerprint: { type: String, required: true, index: true },
    originalText: { type: String, default: '' },
    generationId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiToolGeneration', index: true },
    generationVariant: { type: Number, default: null },
  },
  { timestamps: true },
);

aiGenerationFingerprintSchema.index({ fingerprint: 1, contentType: 1 });
aiGenerationFingerprintSchema.index({
  toolSlug: 1,
  board: 1,
  className: 1,
  subject: 1,
  topic: 1,
  subtopic: 1,
  contentType: 1,
});
aiGenerationFingerprintSchema.index({ generationId: 1, contentType: 1 });

const AiGenerationFingerprint =
  mongoose.models.AiGenerationFingerprint ||
  mongoose.model('AiGenerationFingerprint', aiGenerationFingerprintSchema);

export default AiGenerationFingerprint;
