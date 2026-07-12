/**
 * Authentication Controller
 * Handles user registration, login, and profile completion logic with PostgreSQL.
 */

import {
  findUserByEmail,
  findUserByEmailAndRole,
  createUser,
  updateUser,
} from '../config/db.js';

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
export const registerUser = async (req, res) => {
  const { email, password, role, name, profileData } = req.body;

  // Validation
  if (!email || !password || !role || !name) {
    return res.status(400).json({
      success: false,
      error: 'All fields are required: email, password, role, name.',
    });
  }

  if (!['doctor', 'patient'].includes(role)) {
    return res.status(400).json({
      success: false,
      error: 'Role must be either "doctor" or "patient".',
    });
  }

  // Check if user already exists with same email + role
  const existingUser = await findUserByEmailAndRole(email, role);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: `A ${role} account with this email already exists.`,
    });
  }

  // Build user record based on role
  let newUser;

  if (role === 'doctor') {
    newUser = {
      email,
      password,
      role,
      name,
      profileCompleted: false,
      completionPercentage: 20,
      profileData: {
        fullName: name,
        email,
        ...(profileData || {}),
      },
      createdAt: new Date().toISOString(),
    };
  } else {
    // Patient
    newUser = {
      email,
      password,
      role,
      name,
      profileCompleted: true,
      completionPercentage: 100,
      profileData: {
        fullName: name,
        email,
        age: '28',
        gender: 'Male',
        phone: '9876543212',
        bloodGroup: 'O+',
        address: 'Sector 62, Noida, Uttar Pradesh',
        emergencyContact: 'Asha Thakur - 9876543213',
        medicalHistory: 'Mild dust allergy, seasonal asthma (mild), no regular medications.',
        insuranceDetails: 'Star Health Assure Insurance • Policy No: ST102394 • Valid till Jan 2028',
        ...(profileData || {}),
      },
      createdAt: new Date().toISOString(),
    };
  }

  // Save to database
  await createUser(newUser);

  // Return response without password
  const { password: _, ...safeUser } = newUser;
  console.log(`✅ Registered new ${role}: ${email}`);

  return res.status(201).json({
    success: true,
    message: `${role === 'doctor' ? 'Doctor' : 'Patient'} registered successfully.`,
    user: safeUser,
  });
};

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
export const loginUser = async (req, res) => {
  const { email, password, role } = req.body;

  // Validation
  if (!email || !password || !role) {
    return res.status(400).json({
      success: false,
      error: 'Email, password, and role are required.',
    });
  }

  // Find user
  const user = await findUserByEmailAndRole(email, role);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'No account found with this email and role.',
    });
  }

  // Validate password
  if (user.password !== password) {
    return res.status(401).json({
      success: false,
      error: 'Incorrect password.',
    });
  }

  // Return response without password
  const { password: _, ...safeUser } = user;
  console.log(`✅ Login successful: ${email} (${role})`);

  return res.json({
    success: true,
    message: 'Login successful.',
    user: safeUser,
  });
};

// ─────────────────────────────────────────────
// PUT /api/auth/profile
// Update doctor profile during "Complete Profile" flow
// ─────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  const { email, profileData, completionPercentage, profileCompleted } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required to update profile.',
    });
  }

  const existingUser = await findUserByEmailAndRole(email, 'doctor');
  if (!existingUser) {
    return res.status(404).json({
      success: false,
      error: 'Doctor account not found.',
    });
  }

  // Merge profile data
  const updates = {
    profileData: {
      ...existingUser.profileData,
      ...(profileData || {}),
    },
  };

  if (completionPercentage !== undefined) {
    updates.completionPercentage = completionPercentage;
  }
  if (profileCompleted !== undefined) {
    updates.profileCompleted = profileCompleted;
  }

  const updatedUser = await updateUser(email, 'doctor', updates);

  if (!updatedUser) {
    return res.status(500).json({
      success: false,
      error: 'Failed to update profile.',
    });
  }

  const { password: _, ...safeUser } = updatedUser;
  console.log(`✅ Profile updated: ${email} → ${completionPercentage}%`);

  return res.json({
    success: true,
    message: 'Profile updated successfully.',
    user: safeUser,
  });
};
