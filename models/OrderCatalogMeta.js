import mongoose from 'mongoose';

const orderCatalogMetaSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    initialized: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const OrderCatalogMeta = mongoose.model('OrderCatalogMeta', orderCatalogMetaSchema);
export default OrderCatalogMeta;
