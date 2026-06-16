import mongoose from 'mongoose';

const orderCatalogProductSchema = new mongoose.Schema(
  {
    catalogId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    classLabel: { type: String, default: '', trim: true },
    price: { type: Number, required: true, min: 0 },
    isCustom: { type: Boolean, default: false },
  },
  { timestamps: true },
);

function formatCatalogProduct(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  return {
    id: o.catalogId,
    name: o.name,
    classLabel: o.classLabel || '',
    price: o.price,
    isCustom: Boolean(o.isCustom),
  };
}

orderCatalogProductSchema.statics.formatCatalogProduct = formatCatalogProduct;

const OrderCatalogProduct = mongoose.model('OrderCatalogProduct', orderCatalogProductSchema);
export default OrderCatalogProduct;
export { formatCatalogProduct };

export const DEFAULT_ORDER_CATALOG = [
  { catalogId: 'bnd-1', name: 'Alpha – Class VI', classLabel: '4 Subject Bundle', price: 3000, isCustom: false },
  { catalogId: 'bnd-2', name: 'Alpha – Class VII', classLabel: '4 Subject Bundle', price: 3200, isCustom: false },
  { catalogId: 'bnd-3', name: 'Alpha – Class VIII', classLabel: '4 Subject Bundle', price: 3400, isCustom: false },
  { catalogId: 'bnd-4', name: 'Beta – Class X', classLabel: '4 Subject Bundle', price: 3600, isCustom: false },
];
