/**
 * Profile Routes
 * Maps URL endpoints to profile controller actions.
 */

import { Router } from 'express';
import {
  getDoctorProfile,
  getDoctorProfileStatus,
  createDoctorProfile,
  updateDoctorProfile,
  getAllDoctors,
  searchDoctors
} from '../controllers/profileController.js';

const router = Router();

// GET /api/profile/search - Search doctors
router.get('/search', searchDoctors);

// GET /api/profile/doctors - List all doctors
router.get('/doctors', getAllDoctors);

// GET /api/profile/doctor/:email - Fetch specific doctor profile
router.get('/doctor/:email', getDoctorProfile);

// GET /api/profile/doctor/status/:email - Check profile completeness status
router.get('/doctor/status/:email', getDoctorProfileStatus);

// POST /api/profile/doctor/create - Create a brand-new doctor profile
router.post('/doctor/create', createDoctorProfile);

// PUT /api/profile/doctor/update - Update doctor profile (supports step-by-step)
router.put('/doctor/update', updateDoctorProfile);

export default router;
