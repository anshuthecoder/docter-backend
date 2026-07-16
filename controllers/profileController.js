/**
 * Profile Controller
 * Handles doctor profile CRUD operations with PostgreSQL.
 */

import {
  findUserByEmailAndRole,
  createUser,
  updateUser,
  getAllDoctorsFromDb,
  searchDoctorsInDb,
  normalizeProfileData,
  calculateCompletion,
} from '../config/db.js';

// ─────────────────────────────────────────────
// GET /api/profile/doctor/:email
// Fetch full doctor profile by email
// ─────────────────────────────────────────────
export const getDoctorProfile = async (req, res) => {
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Doctor email is required.',
    });
  }

  const doctor = await findUserByEmailAndRole(email, 'doctor');

  if (!doctor) {
    return res.status(404).json({
      success: false,
      error: 'Doctor profile not found.',
    });
  }

  const { password: _, ...safeDoctor } = doctor;

  return res.json({
    success: true,
    doctor: safeDoctor,
  });
};

// ─────────────────────────────────────────────
// GET /api/profile/doctor/status/:email
// Check doctor profile completion status
// ─────────────────────────────────────────────
export const getDoctorProfileStatus = async (req, res) => {
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Doctor email is required.',
    });
  }

  const doctor = await findUserByEmailAndRole(email, 'doctor');

  if (!doctor) {
    return res.status(404).json({
      success: false,
      error: 'Doctor profile not found.',
    });
  }

  return res.json({
    success: true,
    email: doctor.email,
    name: doctor.name,
    profileCompleted: doctor.profileCompleted || false,
    completionPercentage: doctor.completionPercentage || 0,
    missingFields: getMissingFields(doctor.profileData || {}),
  });
};

// ─────────────────────────────────────────────
// POST /api/profile/doctor/create
// Create a brand-new doctor profile
// ─────────────────────────────────────────────
export const createDoctorProfile = async (req, res) => {
  const { email, name, profileData } = req.body;

  if (!email || !name) {
    return res.status(400).json({
      success: false,
      error: 'Email and name are required.',
    });
  }

  // Check if already exists
  const existing = await findUserByEmailAndRole(email, 'doctor');
  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'A doctor profile with this email already exists.',
    });
  }

  // Build profile with step-wise data
  const pd = normalizeProfileData(profileData || {}, name, email);
  const completion = calculateCompletion(pd);

  const newDoctor = {
    email,
    password: 'password',
    role: 'doctor',
    name,
    profileCompleted: completion >= 100,
    completionPercentage: completion,
    profileData: pd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await createUser(newDoctor);

  const { password: _, ...safeDoctor } = newDoctor;
  console.log(`✅ Doctor profile created: ${email} (${completion}%)`);

  return res.status(201).json({
    success: true,
    message: 'Doctor profile created successfully.',
    doctor: safeDoctor,
  });
};

// ─────────────────────────────────────────────
// PUT /api/profile/doctor/update
// Update doctor profile (supports step-by-step)
// ─────────────────────────────────────────────
export const updateDoctorProfile = async (req, res) => {
  const { email, profileData, step } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required to update profile.',
    });
  }

  const existingDoctor = await findUserByEmailAndRole(email, 'doctor');
  if (!existingDoctor) {
    return res.status(404).json({
      success: false,
      error: 'Doctor profile not found.',
    });
  }

  // Merge new profile data with existing
  const mergedProfileData = {
    ...existingDoctor.profileData,
    ...(profileData || {}),
  };
  const pd = normalizeProfileData(mergedProfileData, existingDoctor.name, email);
  const completion = calculateCompletion(pd);

  const updates = {
    profileData: pd,
    completionPercentage: completion,
    profileCompleted: completion >= 100,
    updatedAt: new Date().toISOString(),
    ...(step !== undefined ? { lastCompletedStep: step } : {}),
  };

  const updatedDoctor = await updateUser(email, 'doctor', updates);

  if (!updatedDoctor) {
    return res.status(500).json({
      success: false,
      error: 'Failed to update doctor profile.',
    });
  }

  const { password: _, ...safeDoctor } = updatedDoctor;
  console.log(`✅ Doctor profile updated: ${email} → ${completion}% (Step: ${step || 'N/A'})`);

  return res.json({
    success: true,
    message: `Profile updated. Completion: ${completion}%`,
    doctor: safeDoctor,
  });
};

// ─────────────────────────────────────────────
// GET /api/profile/doctors
// List all doctors (for patient search / booking)
// ─────────────────────────────────────────────
export const getAllDoctors = async (req, res) => {
  try {
    const rawDoctors = await getAllDoctorsFromDb();
    const doctors = rawDoctors.map((safe) => ({
      email: safe.email,
      name: safe.name,
      specialization: safe.profileData?.specialization || 'General',
      qualification: safe.profileData?.qualification || '',
      experience: safe.profileData?.experience || '0',
      currentHospital: safe.profileData?.currentHospital || '',
      consultationFee: safe.profileData?.consultationFee || '500',
      onlineFee: safe.profileData?.onlineFee || '400',
      city: safe.profileData?.city || '',
      languages: safe.profileData?.languages || 'English',
      bio: safe.profileData?.bio || '',
      servicesOffered: safe.profileData?.servicesOffered || [],
      rating: safe.rating || (4.0 + Math.random() * 0.9).toFixed(1),
      totalReviews: safe.totalReviews || Math.floor(50 + Math.random() * 200),
    }));

    return res.json({
      success: true,
      count: doctors.length,
      doctors,
    });
  } catch (err) {
    console.error('Error fetching doctors:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while fetching doctors.',
    });
  }
};


// ─────────────────────────────────────────────
// Helper: Get list of missing required fields
// ─────────────────────────────────────────────
function getMissingFields(pd) {
  const required = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'gender', label: 'Gender' },
    { key: 'dob', label: 'Date of Birth' },
    { key: 'mobile', label: 'Mobile Number' },
    { key: 'email', label: 'Email' },
    { key: 'regNumber', label: 'Registration Number' },
    { key: 'qualification', label: 'Qualification' },
    { key: 'specialization', label: 'Specialization' },
    { key: 'experience', label: 'Experience' },
    { key: 'currentHospital', label: 'Hospital/Clinic' },
    { key: 'city', label: 'City' },
    { key: 'consultationFee', label: 'Consultation Fee' },
    { key: 'bio', label: 'Bio' },
    { key: 'languages', label: 'Languages' },
  ];

  return required
    .filter((f) => !pd[f.key] || pd[f.key].trim() === '')
    .map((f) => f.label);
}

// ─────────────────────────────────────────────
// GET /api/profile/search
// Search doctors by name, specialty, or city
// ─────────────────────────────────────────────
export const searchDoctors = async (req, res) => {
  const { q, specialty, city } = req.query;

  try {
    const rawDoctors = await searchDoctorsInDb({ q, specialty, city });
    const doctors = rawDoctors.map((safe) => ({
      email: safe.email,
      name: safe.name,
      specialization: safe.profileData?.specialization || 'General',
      qualification: safe.profileData?.qualification || '',
      experience: safe.profileData?.experience || '0',
      currentHospital: safe.profileData?.currentHospital || '',
      consultationFee: safe.profileData?.consultationFee || '500',
      onlineFee: safe.profileData?.onlineFee || '400',
      city: safe.profileData?.city || '',
      languages: safe.profileData?.languages || 'English',
      bio: safe.profileData?.bio || '',
      servicesOffered: safe.profileData?.servicesOffered || [],
      rating: safe.rating || (4.0 + Math.random() * 0.9).toFixed(1),
      totalReviews: safe.totalReviews || Math.floor(50 + Math.random() * 200),
    }));

    return res.json({
      success: true,
      count: doctors.length,
      doctors,
    });
  } catch (err) {
    console.error('Error searching doctors:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while searching doctors.',
    });
  }
}
