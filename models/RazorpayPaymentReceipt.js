import mongoose from 'mongoose';

const razorpayPaymentReceiptSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, index: true, trim: true },
    orderId: { type: String, required: true, unique: true, index: true, trim: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    accountRole: { type: String, enum: ['student', 'teacher'], required: true },
    packageType: { type: String, required: true, trim: true },
    period: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['processing', 'activated', 'failed'], default: 'processing' },
    failureReason: { type: String, default: '' },
    activatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('RazorpayPaymentReceipt', razorpayPaymentReceiptSchema);
