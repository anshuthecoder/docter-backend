/**
 * PostgreSQL Database Module
 * Replaces the local JSON file-based database.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_JSON_PATH = path.join(__dirname, '..', 'data', 'db.json');

// Initialize Connection Pool
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ Error: DATABASE_URL environment variable is missing.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('prisma.io') 
    ? { rejectUnauthorized: false } 
    : false,
  max: 20, // Max concurrent clients in pool
  idleTimeoutMillis: 30000, // Close idle clients after 30s
  connectionTimeoutMillis: 5000, // Return error if connection cannot be established in 5s
});

// ─────────────────────────────────────────────
// Database Schema Initialization & Seeding
// ─────────────────────────────────────────────

export const initDbSchema = async () => {
  console.log('🔄 Initializing PostgreSQL database schema...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        "profileCompleted" BOOLEAN DEFAULT FALSE,
        "completionPercentage" INTEGER DEFAULT 0,
        "profileData" JSONB,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "lastCompletedStep" INTEGER,
        PRIMARY KEY (email, role)
      )
    `);

    // 2. Create Conversations Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        "conversationId" VARCHAR(255) PRIMARY KEY,
        "doctorEmail" VARCHAR(255) NOT NULL,
        "doctorName" VARCHAR(255) NOT NULL,
        "patientEmail" VARCHAR(255) NOT NULL,
        "patientName" VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        "lastMessage" TEXT,
        "lastMessageAt" TIMESTAMP,
        "unreadDoctor" INTEGER DEFAULT 0,
        "unreadPatient" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "consultationFee" INTEGER,
        "scheduledTime" VARCHAR(255)
      )
    `);

    // 3. Create Messages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        "messageId" VARCHAR(255) PRIMARY KEY,
        "conversationId" VARCHAR(255) REFERENCES conversations("conversationId") ON DELETE CASCADE,
        "senderEmail" VARCHAR(255) NOT NULL,
        "senderRole" VARCHAR(50) NOT NULL,
        "senderName" VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'text',
        "isRead" BOOLEAN DEFAULT FALSE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Performance Indexes for Chat
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages("conversationId", timestamp);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conv_doctor ON conversations("doctorEmail");`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conv_patient ON conversations("patientEmail");`);

    // 4. Create Appointments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        "appointmentId" VARCHAR(255) PRIMARY KEY,
        "doctorEmail" VARCHAR(255) NOT NULL,
        "doctorName" VARCHAR(255),
        "patientEmail" VARCHAR(255) NOT NULL,
        "patientName" VARCHAR(255),
        "consultationFee" INTEGER,
        "scheduledTime" VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Create Reviews Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        "reviewId" VARCHAR(255) PRIMARY KEY,
        "doctorEmail" VARCHAR(255) NOT NULL,
        "patientEmail" VARCHAR(255) NOT NULL,
        "patientName" VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT NOT NULL,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_doc ON reviews("doctorEmail");`);

    // 5. Create Health Posts Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS health_posts (
        "postId" VARCHAR(255) PRIMARY KEY,
        "doctorEmail" VARCHAR(255) NOT NULL,
        "doctorName" VARCHAR(255) NOT NULL,
        "doctorSpecialty" VARCHAR(255) NOT NULL,
        "doctorAvatar" TEXT,
        "bannerImage" TEXT,
        heading TEXT NOT NULL,
        description TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        downloads INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration constraint check to update existing primary keys to composite (email, role)
    try {
      await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey');
      await client.query('ALTER TABLE users ADD PRIMARY KEY (email, role)');
      console.log('✅ Users table primary key migrated to (email, role) composite key.');
    } catch (err) {
      // Primary key constraint may already be composite, which is fine
    }

    // Performance Indexes for Users, Appointments, and Posts
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role_completed ON users(role, "profileCompleted");`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apt_patient ON appointments("patientEmail");`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apt_doctor ON appointments("doctorEmail");`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_posts_created ON health_posts("createdAt" DESC);`);

    try {
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "doctorName" VARCHAR(255)');
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "patientName" VARCHAR(255)');
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "consultationFee" INTEGER');
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "orderId" VARCHAR(255)');
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "cfOrderId" VARCHAR(255)');
      await client.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "paymentSessionId" TEXT');
      await client.query('ALTER TABLE appointments ALTER COLUMN status SET DEFAULT \'pending\'');
      await client.query('CREATE INDEX IF NOT EXISTS idx_apt_orderId ON appointments("orderId")');
    } catch (err) {
      console.log('Appointments table migration failed/skipped:', err.message);
    }

    await client.query('COMMIT');
    console.log('✅ PostgreSQL tables verified/created successfully.');

    // ── Database Seeding ──
    const userCountRes = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(userCountRes.rows[0].count, 10);

    if (userCount === 0 && fs.existsSync(DB_JSON_PATH)) {
      console.log('🌱 Database is empty. Seeding data from db.json...');
      const seedData = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));

      await client.query('BEGIN');

      // Seed Users
      if (seedData.users) {
        for (const user of seedData.users) {
          await client.query(
            `INSERT INTO users (email, password, role, name, "profileCompleted", "completionPercentage", "profileData", "updatedAt", "lastCompletedStep") 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              user.email,
              user.password,
              user.role,
              user.name,
              user.profileCompleted || false,
              user.completionPercentage || 0,
              user.profileData ? JSON.stringify(user.profileData) : null,
              user.updatedAt || new Date().toISOString(),
              user.lastCompletedStep || null
            ]
          );
        }
        console.log(`🌱 Seeded ${seedData.users.length} users.`);
      }

      // Seed Conversations
      if (seedData.conversations) {
        for (const conv of seedData.conversations) {
          await client.query(
            `INSERT INTO conversations ("conversationId", "doctorEmail", "doctorName", "patientEmail", "patientName", status, "lastMessage", "lastMessageAt", "unreadDoctor", "unreadPatient", "createdAt", "consultationFee", "scheduledTime")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              conv.conversationId,
              conv.doctorEmail,
              conv.doctorName,
              conv.patientEmail,
              conv.patientName,
              conv.status,
              conv.lastMessage || null,
              conv.lastMessageAt || null,
              conv.unreadDoctor || 0,
              conv.unreadPatient || 0,
              conv.createdAt || new Date().toISOString(),
              conv.consultationFee || null,
              conv.scheduledTime || null
            ]
          );
        }
        console.log(`🌱 Seeded ${seedData.conversations.length} conversations.`);
      }

      // Seed Messages
      if (seedData.messages) {
        for (const msg of seedData.messages) {
          await client.query(
            `INSERT INTO messages ("messageId", "conversationId", "senderEmail", "senderRole", "senderName", content, type, "isRead", timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              msg.messageId,
              msg.conversationId,
              msg.senderEmail,
              msg.senderRole,
              msg.senderName,
              msg.content,
              msg.type || 'text',
              msg.isRead || false,
              msg.timestamp || new Date().toISOString()
            ]
          );
        }
        console.log(`🌱 Seeded ${seedData.messages.length} messages.`);
      }

      await client.query('COMMIT');
      console.log('✅ PostgreSQL seeding completed successfully.');
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during PostgreSQL schema init/seeding:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// Database CRUD Helper Functions
// ─────────────────────────────────────────────

export const findUserByEmailAndRole = async (email, role) => {
  const res = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND role = $2',
    [email, role]
  );
  return res.rows[0] || null;
};

export const findUserByEmail = async (email) => {
  const res = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return res.rows[0] || null;
};

export const createUser = async (userData) => {
  await pool.query(
    `INSERT INTO users (email, password, role, name, "profileCompleted", "completionPercentage", "profileData", "updatedAt", "lastCompletedStep") 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userData.email,
      userData.password,
      userData.role,
      userData.name,
      userData.profileCompleted || false,
      userData.completionPercentage || 0,
      userData.profileData ? JSON.stringify(userData.profileData) : null,
      userData.updatedAt || new Date().toISOString(),
      userData.lastCompletedStep || null
    ]
  );
  if (userData.role === 'doctor') {
    invalidateDoctorsCache();
  }
  return userData;
};

export const updateUser = async (email, role, updates) => {
  const keys = Object.keys(updates);
  if (keys.length === 0) return await findUserByEmailAndRole(email, role);

  const setClause = [];
  const values = [email, role];
  let idx = 3;

  for (const key of keys) {
    let colName = key;
    if (key === 'profileCompleted') colName = '"profileCompleted"';
    else if (key === 'completionPercentage') colName = '"completionPercentage"';
    else if (key === 'profileData') colName = '"profileData"';
    else if (key === 'updatedAt') colName = '"updatedAt"';
    else if (key === 'lastCompletedStep') colName = '"lastCompletedStep"';

    setClause.push(`${colName} = $${idx}`);
    const val = key === 'profileData' ? JSON.stringify(updates[key]) : updates[key];
    values.push(val);
    idx++;
  }

  await pool.query(
    `UPDATE users SET ${setClause.join(', ')} WHERE LOWER(email) = LOWER($1) AND role = $2`,
    values
  );
  if (role === 'doctor') {
    invalidateDoctorsCache();
  }
  return await findUserByEmailAndRole(email, role);
};

export const generateConversationId = () => {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  return `conv_${ts}_${rand}`;
};

export const findConversationById = async (conversationId) => {
  const res = await pool.query(
    'SELECT * FROM conversations WHERE "conversationId" = $1',
    [conversationId]
  );
  return res.rows[0] || null;
};

export const findConversationByParticipants = async (doctorEmail, patientEmail) => {
  const res = await pool.query(
    'SELECT * FROM conversations WHERE LOWER("doctorEmail") = LOWER($1) AND LOWER("patientEmail") = LOWER($2)',
    [doctorEmail, patientEmail]
  );
  return res.rows[0] || null;
};

export const getConversationsForUser = async (email, role) => {
  const key = role === 'doctor' ? 'doctorEmail' : 'patientEmail';
  const res = await pool.query(
    `SELECT * FROM conversations WHERE LOWER("${key}") = LOWER($1)`,
    [email]
  );
  return res.rows;
};

export const createConversation = async (conversationData) => {
  await pool.query(
    `INSERT INTO conversations ("conversationId", "doctorEmail", "doctorName", "patientEmail", "patientName", status, "lastMessage", "lastMessageAt", "unreadDoctor", "unreadPatient", "createdAt", "consultationFee", "scheduledTime")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      conversationData.conversationId,
      conversationData.doctorEmail,
      conversationData.doctorName,
      conversationData.patientEmail,
      conversationData.patientName,
      conversationData.status,
      conversationData.lastMessage || null,
      conversationData.lastMessageAt || null,
      conversationData.unreadDoctor || 0,
      conversationData.unreadPatient || 0,
      conversationData.createdAt || new Date().toISOString(),
      conversationData.consultationFee || null,
      conversationData.scheduledTime || null
    ]
  );
  return conversationData;
};

export const updateConversation = async (conversationId, updates) => {
  const keys = Object.keys(updates);
  if (keys.length === 0) return await findConversationById(conversationId);

  const setClause = [];
  const values = [conversationId];
  let idx = 2;

  for (const key of keys) {
    let colName = key;
    if (key === 'conversationId') colName = '"conversationId"';
    else if (key === 'doctorEmail') colName = '"doctorEmail"';
    else if (key === 'doctorName') colName = '"doctorName"';
    else if (key === 'patientEmail') colName = '"patientEmail"';
    else if (key === 'patientName') colName = '"patientName"';
    else if (key === 'lastMessage') colName = '"lastMessage"';
    else if (key === 'lastMessageAt') colName = '"lastMessageAt"';
    else if (key === 'unreadDoctor') colName = '"unreadDoctor"';
    else if (key === 'unreadPatient') colName = '"unreadPatient"';
    else if (key === 'createdAt') colName = '"createdAt"';
    else if (key === 'consultationFee') colName = '"consultationFee"';
    else if (key === 'scheduledTime') colName = '"scheduledTime"';

    setClause.push(`${colName} = $${idx}`);
    values.push(updates[key]);
    idx++;
  }

  await pool.query(
    `UPDATE conversations SET ${setClause.join(', ')} WHERE "conversationId" = $1`,
    values
  );
  return await findConversationById(conversationId);
};

export const getMessagesByConversation = async (conversationId) => {
  const res = await pool.query(
    'SELECT * FROM messages WHERE "conversationId" = $1 ORDER BY timestamp ASC',
    [conversationId]
  );
  return res.rows;
};

export const addMessage = async (messageData) => {
  await pool.query(
    `INSERT INTO messages ("messageId", "conversationId", "senderEmail", "senderRole", "senderName", content, type, "isRead", timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      messageData.messageId,
      messageData.conversationId,
      messageData.senderEmail,
      messageData.senderRole,
      messageData.senderName,
      messageData.content,
      messageData.type || 'text',
      messageData.isRead || false,
      messageData.timestamp || new Date().toISOString()
    ]
  );
  return messageData;
};

let cachedDoctors = null;
let cachedDoctorsTime = 0;
const DOCTORS_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export const invalidateDoctorsCache = () => {
  cachedDoctors = null;
  cachedDoctorsTime = 0;
};

export const getAllDoctorsFromDb = async () => {
  const now = Date.now();
  if (cachedDoctors && now - cachedDoctorsTime < DOCTORS_CACHE_TTL_MS) {
    return cachedDoctors;
  }

  const res = await pool.query(
    'SELECT email, role, name, "profileCompleted", "completionPercentage", "profileData", "updatedAt" FROM users WHERE role = $1 AND "profileCompleted" = $2 AND email NOT LIKE $3',
    ['doctor', true, '%@medicare.com']
  );

  cachedDoctors = res.rows;
  cachedDoctorsTime = now;
  return res.rows;
};

export const searchDoctorsInDb = async (filters) => {
  const { q, specialty, city } = filters;
  let query = 'SELECT * FROM users WHERE role = $1 AND "profileCompleted" = $2 AND email NOT LIKE $3';
  const params = ['doctor', true, '%@medicare.com'];
  let paramIdx = 4;

  if (q) {
    query += ` AND (
      name ILIKE $${paramIdx} 
      OR "profileData"->>'specialization' ILIKE $${paramIdx} 
      OR "profileData"->>'city' ILIKE $${paramIdx}
    )`;
    params.push(`%${q}%`);
    paramIdx++;
  }

  if (specialty) {
    query += ` AND "profileData"->>'specialization' ILIKE $${paramIdx}`;
    params.push(`%${specialty}%`);
    paramIdx++;
  }

  if (city) {
    query += ` AND "profileData"->>'city' ILIKE $${paramIdx}`;
    params.push(`%${city}%`);
    paramIdx++;
  }

  const res = await pool.query(query, params);
  return res.rows;
};

// ─────────────────────────────────────────────
// Health Posts Helpers
// ─────────────────────────────────────────────

export const addHealthPost = async (postData) => {
  const client = await pool.connect();
  try {
    const { postId, doctorEmail, doctorName, doctorSpecialty, doctorAvatar, bannerImage, heading, description } = postData;
    await client.query(
      `INSERT INTO health_posts ("postId", "doctorEmail", "doctorName", "doctorSpecialty", "doctorAvatar", "bannerImage", heading, description, likes, downloads)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0)`,
      [postId, doctorEmail, doctorName, doctorSpecialty, doctorAvatar, bannerImage, heading, description]
    );
    return { success: true };
  } finally {
    client.release();
  }
};

export const getAllHealthPosts = async () => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM health_posts ORDER BY "createdAt" DESC`
    );
    return res.rows;
  } finally {
    client.release();
  }
};

export const incrementPostLikes = async (postId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE health_posts SET likes = likes + 1 WHERE "postId" = $1 RETURNING likes`,
      [postId]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
};

export const incrementPostDownloads = async (postId) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE health_posts SET downloads = downloads + 1 WHERE "postId" = $1 RETURNING downloads`,
      [postId]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
};

export const normalizeProfileData = (pd, name, email) => {
  const normalized = { ...(pd || {}) };
  if (name && !normalized.fullName) normalized.fullName = name;
  if (email && !normalized.email) normalized.email = email;

  // Align specialties
  const specialty = normalized.specialty || normalized.specialization || 'General Physician';
  normalized.specialty = specialty;
  normalized.specialization = specialty;

  // Align locations
  const location = normalized.location || normalized.city || 'Delhi';
  normalized.location = location;
  normalized.city = location;

  // Align hospitals
  const hospital = normalized.hospital || normalized.currentHospital || 'MediCare Center';
  normalized.hospital = hospital;
  normalized.currentHospital = hospital;

  // Align fees
  const fee = normalized.fee || normalized.consultationFee || 500;
  normalized.fee = parseInt(fee, 10);
  normalized.consultationFee = String(fee);

  // Align degrees
  const degree = normalized.degree || normalized.qualification || 'MBBS';
  normalized.degree = degree;
  normalized.qualification = degree;

  // Align phone
  const phone = normalized.phone || normalized.mobile || '';
  normalized.phone = phone;
  normalized.mobile = phone;

  // Default other fields to ensure 100% completion if registering
  if (!normalized.gender) normalized.gender = 'Male';
  if (!normalized.dob) normalized.dob = '1990-01-01';
  if (!normalized.regNumber) {
    normalized.regNumber = 'REG-' + Math.floor(100000 + Math.random() * 900000);
  }
  if (!normalized.regCouncil) normalized.regCouncil = 'Medical Council of India';
  if (!normalized.state) normalized.state = 'Delhi NCR';
  if (!normalized.country) normalized.country = 'India';

  // Align custom availability and date-specific slots
  if (!normalized.availability || typeof normalized.availability !== 'object') {
    normalized.availability = {
      Monday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }, { start: '17:00', end: '20:00' }] },
      Tuesday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }, { start: '17:00', end: '20:00' }] },
      Wednesday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }, { start: '17:00', end: '20:00' }] },
      Thursday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }, { start: '17:00', end: '20:00' }] },
      Friday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }, { start: '17:00', end: '20:00' }] },
      Saturday: { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '16:00' }] },
      Sunday: { enabled: false, slots: [] },
    };
  }
  if (!normalized.customDateSlots || typeof normalized.customDateSlots !== 'object') {
    normalized.customDateSlots = {};
  }

  return normalized;
};

export const calculateCompletion = (pd) => {
  if (!pd) return 0;
  let score = 0;
  const total = 4; // 4 steps, each worth 25%

  // Step 1: Personal Info (fullName, gender, dob, mobile, email, address)
  const step1Fields = ['fullName', 'gender', 'dob', 'mobile', 'email'];
  const step1Filled = step1Fields.filter((f) => pd[f] && String(pd[f]).trim() !== '').length;
  if (step1Filled >= 4) score++;

  // Step 2: Professional Info (regNumber, qualification, degree, specialization, experience)
  const step2Fields = ['regNumber', 'qualification', 'specialization', 'experience'];
  const step2Filled = step2Fields.filter((f) => pd[f] && String(pd[f]).trim() !== '').length;
  if (step2Filled >= 3) score++;

  // Step 3: Clinic/Hospital Info (currentHospital, city, state, consultationFee)
  const step3Fields = ['currentHospital', 'city', 'consultationFee'];
  const step3Filled = step3Fields.filter((f) => pd[f] && String(pd[f]).trim() !== '').length;
  if (step3Filled >= 2) score++;

  // Step 4: Bio & Availability (bio, languages)
  const step4Fields = ['bio', 'languages'];
  const step4Filled = step4Fields.filter((f) => pd[f] && String(pd[f]).trim() !== '').length;
  if (step4Filled >= 1) score++;

  return Math.round((score / total) * 100);
};

// ─────────────────────────────────────────────
// Appointment CRUD Helpers
// ─────────────────────────────────────────────

export const generateAppointmentId = () => {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  return `apt_${ts}_${rand}`;
};

export const createAppointment = async (appointmentData) => {
  const res = await pool.query(
    `INSERT INTO appointments ("appointmentId", "doctorEmail", "doctorName", "patientEmail", "patientName", "consultationFee", "scheduledTime", status, "orderId", "cfOrderId", "paymentSessionId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      appointmentData.appointmentId,
      appointmentData.doctorEmail,
      appointmentData.doctorName,
      appointmentData.patientEmail,
      appointmentData.patientName,
      appointmentData.consultationFee,
      appointmentData.scheduledTime,
      appointmentData.status || 'pending',
      appointmentData.orderId || null,
      appointmentData.cfOrderId || null,
      appointmentData.paymentSessionId || null
    ]
  );
  return res.rows[0];
};

export const getAppointmentsByUser = async (email, role) => {
  const key = role === 'doctor' ? 'doctorEmail' : 'patientEmail';
  const res = await pool.query(
    `SELECT * FROM appointments WHERE LOWER("${key}") = LOWER($1) ORDER BY "createdAt" DESC`,
    [email]
  );
  return res.rows;
};

export const updateAppointmentStatus = async (appointmentId, status) => {
  const res = await pool.query(
    `UPDATE appointments SET status = $1 WHERE "appointmentId" = $2 RETURNING *`,
    [status, appointmentId]
  );
  return res.rows[0];
};

export const getAppointmentById = async (appointmentId) => {
  const res = await pool.query(
    `SELECT * FROM appointments WHERE "appointmentId" = $1`,
    [appointmentId]
  );
  return res.rows[0];
};

export const getAppointmentByOrderId = async (orderId) => {
  const res = await pool.query(
    `SELECT * FROM appointments WHERE "orderId" = $1 OR "appointmentId" = $1`,
    [orderId]
  );
  return res.rows[0];
};

export const updateAppointmentPaymentStatus = async (orderId, status, cfOrderId = null) => {
  const res = await pool.query(
    `UPDATE appointments 
     SET status = $1, "cfOrderId" = COALESCE($2, "cfOrderId") 
     WHERE "orderId" = $3 OR "appointmentId" = $3 
     RETURNING *`,
    [status, cfOrderId, orderId]
  );
  return res.rows[0];
};

export const createReview = async (reviewData) => {
  const reviewId = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const res = await pool.query(
    `INSERT INTO reviews ("reviewId", "doctorEmail", "patientEmail", "patientName", rating, comment, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      reviewId,
      reviewData.doctorEmail,
      reviewData.patientEmail,
      reviewData.patientName,
      reviewData.rating,
      reviewData.comment,
      new Date().toISOString()
    ]
  );
  return res.rows[0];
};

export const getReviewsByDoctor = async (doctorEmail) => {
  const res = await pool.query(
    `SELECT * FROM reviews WHERE LOWER("doctorEmail") = LOWER($1) ORDER BY "createdAt" DESC`,
    [doctorEmail]
  );
  return res.rows;
};

