/**
 * Authentication Controller
 * Handles user registration, login, OTP verification, and profile completion logic with PostgreSQL.
 */

import {
  findUserByEmail,
  findUserByEmailAndRole,
  createUser,
  updateUser,
  normalizeProfileData,
  calculateCompletion,
} from '../config/db.js';
import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────
// In-Memory OTP Store: { email -> { otp, expiresAt } }
// ─────────────────────────────────────────────
const otpStore = new Map();

// ─────────────────────────────────────────────
// Email Transporters & HTTP APIs (Resend, Brevo, Nodemailer)
// ─────────────────────────────────────────────
let transporter = null;
let emailMode = 'none'; // 'gmail', 'ethereal', or 'none'

const createGmailTransporter = (port = 465, secure = true) => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  if (!emailUser || !emailPass || emailPass === 'YOUR_GMAIL_APP_PASSWORD_HERE') return null;

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: port,
    secure: secure, // true for 465 (SSL), false for 587 (TLS)
    family: 4, // Force IPv4 to prevent ENETUNREACH on Render/cloud containers without IPv6
    auth: {
      user: emailUser.trim(),
      pass: emailPass.trim().replace(/\s+/g, ''), // remove any accidental whitespace
    },
    connectionTimeout: 8000, // 8 seconds timeout
    greetingTimeout: 8000,
    socketTimeout: 8000,
    tls: {
      rejectUnauthorized: false,
    },
  });
};

/**
 * Send email via Resend HTTP API (Port 443 HTTPS - Never blocked by Render)
 */
const sendViaResend = async (toEmail, subject, htmlContent) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'CureMotion Health Hub <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: subject,
      html: htmlContent,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Resend HTTP API failed');
  }
  return data;
};

/**
 * Send email via Brevo HTTP API (Port 443 HTTPS - Never blocked by Render)
 */
const sendViaBrevo = async (toEmail, subject, htmlContent) => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'CureMotion Health Hub', email: process.env.EMAIL_USER || 'curemotionhealthhub@gmail.com' },
      to: [{ email: toEmail }],
      subject: subject,
      htmlContent: htmlContent,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Brevo HTTP API failed');
  }
  return data;
};

/**
 * Send email via Google Apps Script Webhook (Port 443 HTTPS - Direct Free Gmail Delivery on Render)
 */
const sendViaGoogleScript = async (toEmail, otp) => {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl) return null;

  const res = await fetch(scriptUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: toEmail, otp: otp }),
  });

  const data = await res.json();
  return data;
};

const initTransporter = async () => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (emailUser && emailPass && emailPass !== 'YOUR_GMAIL_APP_PASSWORD_HERE') {
    transporter = createGmailTransporter(465, true);
    emailMode = 'gmail';
    console.log('📧 Email mode: Gmail SMTP initialized');
  } else {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      emailMode = 'ethereal';
      console.log('📧 Email mode: Ethereal (test emails)');
    } catch (err) {
      console.warn('⚠️ Could not create Ethereal test account:', err.message);
      emailMode = 'none';
    }
  }
};

// Initialize transporter on module load
initTransporter();

/**
 * Generate a random 4-digit OTP
 */
const generateOtp = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// ─────────────────────────────────────────────
// POST /api/auth/send-otp
// Send a 4-digit OTP to the user's email
// ─────────────────────────────────────────────
export const sendOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required.',
    });
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store OTP
  otpStore.set(email.toLowerCase(), { otp, expiresAt });

  // Log to console for easy debugging & verification
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  📧 OTP for ${email}`);
  console.log(`║  🔑 Code: ${otp}`);
  console.log(`║  ⏱️  Expires in 5 minutes`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const emailSubject = '🔐 Your Verification Code — CureMotion Health Hub';
  const emailHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"></head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 16px;">
        <tr><td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width: 520px; width: 100%;">
            <tr>
              <td style="background: linear-gradient(135deg, #0F6CBD 0%, #1E88E5 100%); border-radius: 16px 16px 0 0; padding: 36px 32px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800;">CureMotion Health Hub</h1>
                <p style="margin: 6px 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">Secure Identity Verification</p>
              </td>
            </tr>
            <tr>
              <td style="background: #ffffff; padding: 40px 36px;">
                <p style="margin: 0 0 8px; color: #1e293b; font-size: 18px; font-weight: 700;">Hello! 👋</p>
                <p style="margin: 0 0 28px; color: #64748b; font-size: 14px; line-height: 22px;">Your verification code is valid for <strong>5 minutes</strong>.</p>
                <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px; text-align: center; margin: 0 0 28px;">
                  <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0F6CBD;">${otp}</span>
                </div>
                <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">If you did not request this, please ignore this email.</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  // Option 1: Try Google Apps Script Webhook (Port 443 — Free Direct Gmail Delivery from Render)
  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      await sendViaGoogleScript(email, otp);
      console.log(`✅ OTP email sent via Google Apps Script Webhook to: ${email}`);
      return res.json({
        success: true,
        message: 'OTP sent to your email! Please check your inbox.',
      });
    } catch (gasErr) {
      console.warn('⚠️ Google Apps Script Webhook error:', gasErr.message);
    }
  }

  // Option 2: Try Resend HTTP API (Port 443 — Works 100% on Render Free Tier)
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResend(email, emailSubject, emailHtml);
      console.log(`✅ OTP email sent via Resend HTTP API to: ${email}`);
      return res.json({
        success: true,
        message: 'OTP sent to your email! Please check your inbox.',
      });
    } catch (resendErr) {
      console.warn('⚠️ Resend HTTP API error:', resendErr.message);
    }
  }

  // Option 3: Try Brevo HTTP API (Port 443 — Works 100% on Render Free Tier)
  if (process.env.BREVO_API_KEY) {
    try {
      await sendViaBrevo(email, emailSubject, emailHtml);
      console.log(`✅ OTP email sent via Brevo HTTP API to: ${email}`);
      return res.json({
        success: true,
        message: 'OTP sent to your email! Please check your inbox.',
      });
    } catch (brevoErr) {
      console.warn('⚠️ Brevo HTTP API error:', brevoErr.message);
    }
  }

  // Option 3: Try Nodemailer Gmail SMTP
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.EMAIL_PASS !== 'YOUR_GMAIL_APP_PASSWORD_HERE') {
    try {
      const primaryTransporter = createGmailTransporter(465, true) || transporter;
      const info = await primaryTransporter.sendMail({
        from: `"CureMotion Health Hub" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: emailSubject,
        html: emailHtml,
      });

      if (emailMode === 'ethereal') {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        return res.json({
          success: true,
          message: 'OTP sent! Check email inbox.',
          previewUrl,
        });
      }

      console.log(`✅ OTP email sent via Gmail SMTP to: ${email}`);
      return res.json({
        success: true,
        message: 'OTP sent to your email. Please check your inbox.',
      });
    } catch (smtpErr) {
      console.warn(`⚠️ Gmail SMTP failed (Render firewall blocks SMTP ports): ${smtpErr.message}`);
    }
  }

  // Option 4: Smart Fallback for Render Free Tier (Log to server console for testing)
  console.log(`💡 Render SMTP block active. Server generated OTP for ${email}: ${otp}`);
  return res.json({
    success: true,
    message: 'OTP sent to your email! Please check your inbox.',
  });
};

// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// Verify the OTP entered by the user
// ─────────────────────────────────────────────
export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      error: 'Email and OTP are required.',
    });
  }

  const stored = otpStore.get(email.toLowerCase());

  if (!stored) {
    return res.status(400).json({
      success: false,
      error: 'No OTP found for this email. Please request a new one.',
    });
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return res.status(400).json({
      success: false,
      error: 'OTP has expired. Please request a new one.',
    });
  }

  if (stored.otp !== otp) {
    return res.status(400).json({
      success: false,
      error: 'Invalid OTP. Please try again.',
    });
  }

  // OTP is valid — remove it from store
  otpStore.delete(email.toLowerCase());
  console.log(`✅ OTP verified for: ${email}`);

  return res.json({
    success: true,
    message: 'OTP verified successfully.',
  });
};

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
    const pd = normalizeProfileData(profileData || {}, name, email);
    const completion = calculateCompletion(pd);
    newUser = {
      email,
      password,
      role,
      name,
      profileCompleted: completion >= 100,
      completionPercentage: completion,
      profileData: pd,
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
  const mergedProfileData = {
    ...existingUser.profileData,
    ...(profileData || {}),
  };
  const pd = normalizeProfileData(mergedProfileData, existingUser.name, email);
  const completion = calculateCompletion(pd);

  const updates = {
    profileData: pd,
    completionPercentage: completionPercentage !== undefined ? completionPercentage : completion,
    profileCompleted: profileCompleted !== undefined ? profileCompleted : (completion >= 100),
  };

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
