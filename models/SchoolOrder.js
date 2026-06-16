import mongoose from 'mongoose';

const productLineSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    classLabel: { type: String, default: '', trim: true },
    qty: { type: Number, default: 1, min: 1 },
    comp: { type: Number, default: 0, min: 0 },
    price: { type: Number, required: true, min: 0 },
    isCustom: { type: Boolean, default: false },
  },
  { _id: false },
);

const financialSchema = new mongoose.Schema(
  {
    orderType: { type: String, default: '' },
    category: { type: String, default: '' },
    paymentTerms: { type: String, default: '' },
    paymentDueDate: { type: String, default: '' },
    notes: { type: String, default: '' },
    documentName: { type: String, default: null },
    documentUrl: { type: String, default: null },
    itemDiscount: { type: Number, default: 0, min: 0 },
    specialDiscount: { type: Number, default: 0, min: 0 },
    advanceReceived: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const computedSchema = new mongoose.Schema(
  {
    subtotal: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
  },
  { _id: false },
);

const schoolOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, index: true },
    schoolId: { type: String, default: '' },
    adminId: { type: String, default: '' },
    schoolName: { type: String, required: true, trim: true },
    brand: { type: String, default: '', trim: true },
    academicYear: { type: String, default: '2026-27' },
    products: { type: [productLineSchema], default: [] },
    financial: { type: financialSchema, default: () => ({}) },
    computed: { type: computedSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ['draft', 'confirmed'],
      default: 'draft',
      index: true,
    },
    createdBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

schoolOrderSchema.index({ createdAt: -1 });

function formatOrder(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  const rawId = o._id ?? o.id;
  return {
    id: rawId != null ? String(rawId) : '',
    orderNumber: o.orderNumber,
    schoolId: o.schoolId,
    adminId: o.adminId,
    schoolName: o.schoolName,
    brand: o.brand,
    academicYear: o.academicYear,
    products: o.products || [],
    financial: o.financial || {},
    computed: o.computed || {},
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

schoolOrderSchema.statics.formatOrder = formatOrder;

const SchoolOrder = mongoose.model('SchoolOrder', schoolOrderSchema);
export default SchoolOrder;
export { formatOrder };
