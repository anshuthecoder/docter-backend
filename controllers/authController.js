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
// Nodemailer Transporter (Gmail SSL or Ethereal fallback)
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
    auth: {
      user: emailUser.trim(),
      pass: emailPass.trim().replace(/\s+/g, ''), // remove any accidental whitespace
    },
    connectionTimeout: 10000, // 10 seconds timeout to prevent hanging on Render
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: {
      rejectUnauthorized: false,
    },
  });
};

const initTransporter = async () => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (emailUser && emailPass && emailPass !== 'YOUR_GMAIL_APP_PASSWORD_HERE') {
    // Real Gmail SMTP using Port 465 (SSL) — optimal for Render and cloud hosts
    transporter = createGmailTransporter(465, true);
    emailMode = 'gmail';
    console.log('📧 Email mode: Gmail SMTP via Port 465 SSL (real emails will be sent)');
  } else {
    // Create a free Ethereal test account automatically
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      emailMode = 'ethereal';
      console.log('📧 Email mode: Ethereal (test emails — preview links in console)');
      console.log(`   Ethereal user: ${testAccount.user}`);
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

  // Always log to console for easy debugging
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  📧 OTP for ${email}`);
  console.log(`║  🔑 Code: ${otp}`);
  console.log(`║  ⏱️  Expires in 5 minutes`);
  console.log('╚══════════════════════════════════════════════╝');

  // Attempt to send email
  if (!transporter) {
    // Re-try init if transporter is null
    await initTransporter();
  }

  if (transporter) {
    try {
      const mailOptions = {
        from: `"CureMotion Health Hub" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Your Verification Code — CureMotion Health Hub',
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            
            <!-- Outer Container -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width: 520px; width: 100%;">
                    
                    <!-- Header Band -->
                    <tr>
                      <td style="background: linear-gradient(135deg, #0F6CBD 0%, #1E88E5 50%, #4DA8DA 100%); border-radius: 16px 16px 0 0; padding: 36px 32px 28px; text-align: center;">
                        <!-- Logo / Icon -->
                        <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.2); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; font-size: 32px;">
                          🏥
                        </div>
                        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                          CureMotion Health Hub
                        </h1>
                        <p style="margin: 6px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">
                          Secure Identity Verification
                        </p>
                      </td>
                    </tr>
                    
                    <!-- Main Body -->
                    <tr>
                      <td style="background: #ffffff; padding: 40px 36px;">
                        
                        <!-- Greeting -->
                        <p style="margin: 0 0 8px; color: #1e293b; font-size: 18px; font-weight: 700;">
                          Hello! 👋
                        </p>
                        <p style="margin: 0 0 28px; color: #64748b; font-size: 14px; line-height: 22px;">
                          We received a request to verify your email address. Use the code below to complete your login. This code is valid for <strong style="color: #1e293b;">5 minutes</strong>.
                        </p>
                        
                        <!-- OTP Code Box -->
                        <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px 24px; text-align: center; margin: 0 0 28px;">
                          <p style="margin: 0 0 14px; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                            Your Verification Code
                          </p>
                          <!-- Individual Digit Boxes -->
                          <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                            <tr>
                              ${otp.split('').map(digit => `
                                <td style="padding: 0 5px;">
                                  <div style="width: 52px; height: 64px; background: linear-gradient(180deg, #0F6CBD 0%, #1565C0 100%); border-radius: 12px; line-height: 64px; text-align: center; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: 0; box-shadow: 0 4px 12px rgba(15, 108, 189, 0.3);">
                                    ${digit}
                                  </div>
                                </td>
                              `).join('')}
                            </tr>
                          </table>
                          <p style="margin: 16px 0 0; color: #94a3b8; font-size: 12px;">
                            ⏱️ Expires at <strong style="color: #64748b;">${new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</strong>
                          </p>
                        </div>
                        
                        <!-- Security Notice -->
                        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; padding: 14px 16px; margin: 0 0 28px;">
                          <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600; line-height: 20px;">
                            🔒 Security Tip: Never share this code with anyone. Our team will never ask for your OTP via call or message.
                          </p>
                        </div>
                        
                        <!-- Divider -->
                        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;">
                        
                        <!-- Help Section -->
                        <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 20px; text-align: center;">
                          Didn't request this? You can safely ignore this email.<br>
                          If you have concerns, contact us at
                          <a href="mailto:${process.env.EMAIL_USER}" style="color: #0F6CBD; text-decoration: none; font-weight: 600;">${process.env.EMAIL_USER}</a>
                        </p>
                        
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background: #1e293b; border-radius: 0 0 16px 16px; padding: 28px 36px; text-align: center;">
                        <p style="margin: 0 0 8px; color: #ffffff; font-size: 14px; font-weight: 700;">
                          CureMotion Health Hub
                        </p>
                        <p style="margin: 0 0 16px; color: #94a3b8; font-size: 11px; line-height: 18px;">
                          Your trusted digital healthcare companion.<br>
                          Connecting patients with the best doctors — anytime, anywhere.
                        </p>
                        <div style="margin: 0 0 16px;">
                          <a href="#" style="display: inline-block; width: 32px; height: 32px; background: rgba(255,255,255,0.1); border-radius: 8px; line-height: 32px; text-align: center; margin: 0 4px; text-decoration: none; font-size: 14px;">🌐</a>
                          <a href="#" style="display: inline-block; width: 32px; height: 32px; background: rgba(255,255,255,0.1); border-radius: 8px; line-height: 32px; text-align: center; margin: 0 4px; text-decoration: none; font-size: 14px;">📧</a>
                          <a href="#" style="display: inline-block; width: 32px; height: 32px; background: rgba(255,255,255,0.1); border-radius: 8px; line-height: 32px; text-align: center; margin: 0 4px; text-decoration: none; font-size: 14px;">📱</a>
                        </div>
                        <p style="margin: 0; color: #64748b; font-size: 10px;">
                          © ${new Date().getFullYear()} CureMotion Health Hub. All rights reserved.
                        </p>
                      </td>
                    </tr>
                    
                  </table>
                </td>
              </tr>
            </table>
            
          </body>
          </html>
        `,
      };

      let info;
      try {
        // Try Port 465 (SSL)
        const primaryTransporter = createGmailTransporter(465, true) || transporter;
        info = await primaryTransporter.sendMail(mailOptions);
      } catch (primaryErr) {
        console.warn(`⚠️ Primary SMTP (Port 465 SSL) failed: ${primaryErr.message}. Trying Port 587 fallback...`);
        // Fallback to Port 587 (TLS)
        const fallbackTransporter = createGmailTransporter(587, false);
        if (fallbackTransporter) {
          info = await fallbackTransporter.sendMail(mailOptions);
        } else {
          throw primaryErr;
        }
      }

      if (emailMode === 'ethereal') {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`📬 Ethereal preview: ${previewUrl}`);
        console.log('   (Open this link to see the OTP email)');
        console.log('');

        return res.json({
          success: true,
          message: 'OTP sent! Check your email inbox.',
          previewUrl,
        });
      }

      console.log(`✅ OTP email sent to: ${email}`);
      console.log('');

      return res.json({
        success: true,
        message: 'OTP sent to your email. Please check your inbox.',
      });
    } catch (err) {
      console.error('❌ Failed to send OTP email:', err.message);
      console.log('');

      return res.status(500).json({
        success: false,
        error: `Failed to send OTP email: ${err.message}. Please verify Gmail App Password in server environment.`,
      });
    }
  }

  // If no email provider configured
  return res.status(500).json({
    success: false,
    error: 'Email service is not properly configured on server.',
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
