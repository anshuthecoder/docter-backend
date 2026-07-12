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
    : false
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
        email VARCHAR(255) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        "profileCompleted" BOOLEAN DEFAULT FALSE,
        "completionPercentage" INTEGER DEFAULT 0,
        "profileData" JSONB,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "lastCompletedStep" INTEGER
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

    // 4. Create Appointments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

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
    'SELECT * FROM messages WHERE "conversationId" = $1',
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

export const getAllDoctorsFromDb = async () => {
  const res = await pool.query(
    'SELECT * FROM users WHERE role = $1 AND "profileCompleted" = $2',
    ['doctor', true]
  );
  return res.rows;
};

export const searchDoctorsInDb = async (filters) => {
  const { q, specialty, city } = filters;
  let query = 'SELECT * FROM users WHERE role = $1 AND "profileCompleted" = $2';
  const params = ['doctor', true];
  let paramIdx = 3;

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
