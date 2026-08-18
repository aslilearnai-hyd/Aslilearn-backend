import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getBillingConfig,
  createIndividualCheckoutOrder,
  verifyIndividualCheckout,
} from '../controllers/individualBillingController.js';

const router = express.Router();

router.get('/config', getBillingConfig);
router.post('/individual/order', verifyToken, createIndividualCheckoutOrder);
router.post('/individual/verify', verifyToken, verifyIndividualCheckout);

export default router;
