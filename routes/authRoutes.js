/**
 * Authentication Routes
 * Maps URL endpoints to controller actions.
 */

import { Router } from 'express';
import { registerUser, loginUser, updateProfile, sendOtp, verifyOtp } from '../controllers/authController.js';

const router = Router();

// POST /api/auth/send-otp - Send a 4-digit OTP to the user's email
router.post('/send-otp', sendOtp);

// POST /api/auth/verify-otp - Verify the OTP entered by the user
router.post('/verify-otp', verifyOtp);

// POST /api/auth/register - Create a new patient or doctor account
router.post('/register', registerUser);

// POST /api/auth/login - Authenticate and return user profile
router.post('/login', loginUser);

// PUT /api/auth/profile - Update doctor profile (Complete Profile flow)
router.put('/profile', updateProfile);

export default router;
