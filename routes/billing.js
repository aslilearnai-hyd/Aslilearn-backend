import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getBillingConfig,
  createIndividualCheckoutOrder,
  verifyIndividualCheckout,
  getIndividualSubscriptionReceipt,
  getCurrentStudentBillingPlan,
} from '../controllers/individualBillingController.js';

const router = express.Router();

router.get('/config', getBillingConfig);
router.get('/individual/receipt', verifyToken, getIndividualSubscriptionReceipt);
router.get('/student-school-plan', verifyToken, getCurrentStudentBillingPlan);
router.post('/individual/order', verifyToken, createIndividualCheckoutOrder);
router.post('/individual/verify', verifyToken, verifyIndividualCheckout);

export default router;
