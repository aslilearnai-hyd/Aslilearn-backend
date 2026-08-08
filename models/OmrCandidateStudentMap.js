import mongoose from 'mongoose';

const omrCandidateStudentMapSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    candidateId: { type: String, trim: true, required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

omrCandidateStudentMapSchema.index({ adminId: 1, candidateId: 1 }, { unique: true });
omrCandidateStudentMapSchema.index({ adminId: 1, userId: 1 });

const OmrCandidateStudentMap =
  mongoose.models.OmrCandidateStudentMap ||
  mongoose.model('OmrCandidateStudentMap', omrCandidateStudentMapSchema);

export default OmrCandidateStudentMap;
