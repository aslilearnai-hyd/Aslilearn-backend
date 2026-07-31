import express from 'express';
import { loginLimiter, signupLimiter } from '../middleware/rate-limit.js';
import { loginSchema, validateRequest } from '../validators/superAdminValidator.js';
import { verifyToken } from '../middleware/auth.js';
import {
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  me,
  trialLoginQuizzes,
  patchUser,
  register,
  login,
} from '../controllers/authController.js';

const router = express.Router();

router.post('/logout', logout);
router.post('/refresh', loginLimiter, refresh);
router.post('/forgot-password', loginLimiter, forgotPassword);
router.post('/reset-password', loginLimiter, resetPassword);
router.get('/me', verifyToken, me);
router.get('/trial-login-quizzes', verifyToken, trialLoginQuizzes);
router.post('/register', signupLimiter, register);
router.options('/login', (req, res) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
router.post('/login', loginLimiter, validateRequest(loginSchema), login);

export default router;

/** Profile patch under /api/users — mount separately. */
export const usersRouter = express.Router();
usersRouter.patch('/:userId', verifyToken, patchUser);
