/**
 * Medicare Backend Server
 * Entry point for the Express API application with PostgreSQL & dotenv.
 * 
 * Architecture: MVC (Model-View-Controller)
 * - config/db.js        → Database operations using Pool
 * - controllers/         → Business logic handlers
 * - routes/              → URL endpoint mappings
 * 
 * Real-time Features:
 * - Socket.io            → Live chat messaging & typing indicators
 * - WebRTC Signaling     → Video call offer/answer/ICE exchange
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import postRoutes from './routes/postRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import {
  initDbSchema,
  findConversationById,
  addMessage,
  updateConversation,
} from './config/db.js';

const app = express();
const PORT = process.env.PORT || 5001;

// Create HTTP server for Socket.io compatibility
const httpServer = createServer(app);

// ─────────────────────────────────────────────
// Socket.io Setup
// ─────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://localhost:4173', 'https://docter-frontend-mu.vercel.app', 'https://curemotionhealthhub.com', 'https://www.curemotionhealthhub.com'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Track online users: { socketId: { email, role, conversationId } }
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // ── Join a conversation room ──
  socket.on('join-conversation', ({ conversationId, email, role }) => {
    if (!conversationId || !email) return;

    socket.join(conversationId);
    onlineUsers.set(socket.id, { email, role, conversationId });

    console.log(`📌 ${email} (${role}) joined room: ${conversationId}`);

    // Notify others in room that user came online
    socket.to(conversationId).emit('user-online', { email, role });
  });

  // ── Leave a conversation room ──
  socket.on('leave-conversation', ({ conversationId }) => {
    if (!conversationId) return;
    socket.leave(conversationId);
    console.log(`📤 ${socket.id} left room: ${conversationId}`);
  });

  // ── Send a chat message (real-time + DB persist) ──
  socket.on('send-message', async (data) => {
    const { conversationId, senderEmail, senderRole, content, type } = data;

    if (!conversationId || !senderEmail || !senderRole || !content) return;

    try {
      // Verify conversation exists
      const conversation = await findConversationById(conversationId);
      if (!conversation) return;

      // Build message object
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const message = {
        messageId,
        conversationId,
        senderEmail,
        senderRole,
        senderName: senderRole === 'doctor' ? conversation.doctorName : conversation.patientName,
        content: content.trim(),
        type: type || 'text',
        isRead: false,
        timestamp: new Date().toISOString(),
      };

      // Save to database
      await addMessage(message);

      // Update conversation metadata
      const unreadField = senderRole === 'doctor' ? 'unreadPatient' : 'unreadDoctor';
      const currentUnread = conversation[unreadField] || 0;
      await updateConversation(conversationId, {
        lastMessage: content.trim().substring(0, 100),
        lastMessageAt: message.timestamp,
        [unreadField]: currentUnread + 1,
      });

      console.log(`💬 [Socket] Message in ${conversationId}: [${senderRole}] ${content.substring(0, 50)}...`);

      // Broadcast to everyone in the room (including sender for confirmation)
      io.to(conversationId).emit('new-message', message);
    } catch (err) {
      console.error('❌ Error handling send-message socket event:', err.message);
    }
  });

  // ── Typing indicators ──
  socket.on('typing', ({ conversationId, email, role }) => {
    socket.to(conversationId).emit('user-typing', { email, role });
  });

  socket.on('stop-typing', ({ conversationId, email, role }) => {
    socket.to(conversationId).emit('user-stop-typing', { email, role });
  });

  // ── WebRTC Signaling: Video/Audio Call Offer ──
  socket.on('video-call-offer', ({ conversationId, offer, callerEmail, callerRole, callType }) => {
    console.log(`📹 ${callType || 'video'} call offer from ${callerEmail} in ${conversationId}`);
    socket.to(conversationId).emit('incoming-call', {
      offer,
      callerEmail,
      callerRole,
      conversationId,
      callType: callType || 'video',
    });
  });

  // ── WebRTC Signaling: Video Call Answer ──
  socket.on('video-call-answer', ({ conversationId, answer, answererEmail }) => {
    console.log(`✅ Video call answered by ${answererEmail} in ${conversationId}`);
    socket.to(conversationId).emit('call-answered', {
      answer,
      answererEmail,
    });
  });

  // ── WebRTC Signaling: ICE Candidate ──
  socket.on('ice-candidate', ({ conversationId, candidate, senderEmail }) => {
    socket.to(conversationId).emit('ice-candidate', {
      candidate,
      senderEmail,
    });
  });

  // ── End Call ──
  socket.on('end-call', ({ conversationId, email }) => {
    console.log(`📴 Call ended by ${email} in ${conversationId}`);
    socket.to(conversationId).emit('call-ended', { email });
  });

  // ── Reject Call ──
  socket.on('reject-call', ({ conversationId, email }) => {
    console.log(`❌ Call rejected by ${email} in ${conversationId}`);
    socket.to(conversationId).emit('call-rejected', { email });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      const { email, role, conversationId } = userData;
      if (conversationId) {
        socket.to(conversationId).emit('user-offline', { email, role });
      }
      onlineUsers.delete(socket.id);
    }
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://localhost:4173', 'https://docter-frontend-mu.vercel.app', 'https://curemotionhealthhub.com', 'https://www.curemotionhealthhub.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
}));
app.use(express.json());

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Medicare Backend API',
    port: PORT,
    time: new Date().toISOString(),
    socketio: true,
  });
});

// Authentication routes (register, login, profile update)
app.use('/api/auth', authRoutes);

// Profile routes (create, retrieve, status, updates, listings)
app.use('/api/profile', profileRoutes);

// Chat routes (start conversation, fetch conversations/messages, send message, read status)
app.use('/api/chat', chatRoutes);

// Health post routes (upload, retrieve, like, download)
app.use('/api/posts', postRoutes);

// Appointments routes (request, list, approve/reject, pay)
app.use('/api/appointments', appointmentRoutes);

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─────────────────────────────────────────────
// Start Server (HTTP + Socket.io) after Schema Init
// ─────────────────────────────────────────────
const startServer = async () => {
  try {
    await initDbSchema();
    httpServer.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║   🏥  Medicare Backend Server Running       ║');
      console.log(`║   🌐  http://localhost:${PORT}                ║`);
      console.log('║   📁  Database: PostgreSQL (Cloud Instance) ║');
      console.log('║   🔌  Socket.io: Enabled                    ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log('');
      console.log('Available API Endpoints:');
      console.log('  GET    /api/health          → Server health check');
      console.log('  POST   /api/auth/register   → Register new user');
      console.log('  POST   /api/auth/login      → Login user');
      console.log('  PUT    /api/auth/profile    → Update doctor profile (legacy)');
      console.log('  GET    /api/profile/doctors → List all completed doctor profiles');
      console.log('  GET    /api/profile/doctor/:email → Fetch specific doctor');
      console.log('  PUT    /api/profile/doctor/update → Update doctor profile (MVC)');
      console.log('  POST   /api/chat/start      → Start/Retrieve a conversation');
      console.log('  GET    /api/chat/conversations/:email/:role → Fetch user conversations');
      console.log('  POST   /api/chat/send       → Send conversation message');
      console.log('');
      console.log('Socket.io Events:');
      console.log('  join-conversation  → Join a chat room');
      console.log('  send-message       → Real-time message delivery');
      console.log('  typing / stop-typing → Typing indicators');
      console.log('  video-call-offer   → WebRTC SDP offer');
      console.log('  video-call-answer  → WebRTC SDP answer');
      console.log('  ice-candidate      → ICE candidate exchange');
      console.log('  end-call           → Terminate video call');
      console.log('');

      // Start Render self-ping keep-alive loop
      keepAlive();
    });
  } catch (err) {
    console.error('❌ Error: Failed to start Medicare Server:', err.message);
    process.exit(1);
  }
};

const keepAlive = () => {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://docter-backend-0zol.onrender.com';
  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes in ms

  // Initial self-ping in 10 seconds to warm up the instance on deployment
  setTimeout(async () => {
    try {
      console.log(`[Keep-Alive] Initial self-ping warm-up to ${RENDER_URL}/api/health...`);
      await fetch(`${RENDER_URL}/api/health`);
    } catch (err) {
      console.error(`[Keep-Alive] Warm-up ping failed:`, err.message);
    }
  }, 10000);

  setInterval(async () => {
    try {
      console.log(`[Keep-Alive] Pinging self at ${RENDER_URL}/api/health to prevent spin-down...`);
      const response = await fetch(`${RENDER_URL}/api/health`);
      if (response.ok) {
        console.log(`[Keep-Alive] Self-ping succeeded. Server stays awake!`);
      } else {
        console.warn(`[Keep-Alive] Self-ping returned status: ${response.status}`);
      }
    } catch (err) {
      console.error(`[Keep-Alive] Self-ping failed:`, err.message);
    }
  }, PING_INTERVAL);
};

startServer();
