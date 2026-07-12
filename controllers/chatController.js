/**
 * Chat Controller
 * Handles conversation management and message exchange between doctor & patient with PostgreSQL.
 *
 * Endpoints:
 *  POST   /api/chat/start                → Start or get existing conversation
 *  GET    /api/chat/conversations/:email/:role → List all conversations for a user
 *  GET    /api/chat/messages/:conversationId   → Get messages in a conversation
 *  POST   /api/chat/send                 → Send a message
 *  PUT    /api/chat/read/:conversationId  → Mark messages as read
 */

import {
  findUserByEmailAndRole,
  generateConversationId,
  findConversationById,
  findConversationByParticipants,
  getConversationsForUser,
  createConversation,
  updateConversation,
  getMessagesByConversation,
  addMessage,
  createUser,
} from '../config/db.js';

// ─────────────────────────────────────────────
// POST /api/chat/start
// Start a new conversation or return existing one
// Body: { doctorEmail, patientEmail }
// ─────────────────────────────────────────────
export const startConversation = async (req, res) => {
  const { doctorEmail, patientEmail, consultationFee, scheduledTime } = req.body;

  // Validation
  if (!doctorEmail || !patientEmail) {
    return res.status(400).json({
      success: false,
      error: 'Both doctorEmail and patientEmail are required.',
    });
  }

  // Verify both users exist
  let doctor = await findUserByEmailAndRole(doctorEmail, 'doctor');
  if (!doctor) {
    const calculatedName = req.body.doctorName || ('Dr. ' + doctorEmail.split('@')[0].split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '));
    doctor = {
      email: doctorEmail,
      password: 'password',
      role: 'doctor',
      name: calculatedName,
      profileCompleted: true,
      completionPercentage: 100,
      profileData: {
        fullName: calculatedName,
        email: doctorEmail,
        specialization: req.body.specialty || 'General Medicine',
        currentHospital: req.body.hospital || 'Medicare Clinic',
        consultationFee: String(consultationFee || 500),
        onlineFee: String(consultationFee || 500),
      }
    };
    await createUser(doctor);
    console.log(`🌱 Auto-seeded doctor in database: ${doctorEmail} (${calculatedName})`);
  }

  const patient = await findUserByEmailAndRole(patientEmail, 'patient');
  if (!patient) {
    return res.status(404).json({
      success: false,
      error: 'Patient not found.',
    });
  }

  // Check if conversation already exists
  const existing = await findConversationByParticipants(doctorEmail, patientEmail);
  if (existing) {
    const updates = {};
    if (consultationFee !== undefined) updates.consultationFee = consultationFee;
    if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;

    let updated = existing;
    if (Object.keys(updates).length > 0) {
      updated = await updateConversation(existing.conversationId, updates);
    }

    if (scheduledTime) {
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const message = {
        messageId,
        conversationId: existing.conversationId,
        senderEmail: patientEmail,
        senderRole: 'patient',
        senderName: patient.name,
        content: `Hello Dr. ${doctor.name}, I have scheduled an online consultation for ${scheduledTime}. Fee: ₹${consultationFee || 500}.`,
        type: 'text',
        isRead: false,
        timestamp: new Date().toISOString(),
      };
      await addMessage(message);
      updated = await updateConversation(existing.conversationId, {
        lastMessage: message.content,
        lastMessageAt: message.timestamp,
        unreadDoctor: (existing.unreadDoctor || 0) + 1,
      });
    }

    console.log(`💬 Existing conversation updated/returned: ${existing.conversationId}`);
    return res.json({
      success: true,
      message: 'Existing conversation updated.',
      conversation: updated,
      isNew: false,
    });
  }

  // Create new conversation
  const conversationId = generateConversationId();
  const newConversation = {
    conversationId,
    doctorEmail: doctor.email,
    doctorName: doctor.name,
    patientEmail: patient.email,
    patientName: patient.name,
    status: 'active',
    lastMessage: null,
    lastMessageAt: null,
    unreadDoctor: 0,
    unreadPatient: 0,
    createdAt: new Date().toISOString(),
    consultationFee: consultationFee || null,
    scheduledTime: scheduledTime || null,
  };

  await createConversation(newConversation);

  let finalConversation = newConversation;

  if (scheduledTime) {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const message = {
      messageId,
      conversationId,
      senderEmail: patientEmail,
      senderRole: 'patient',
      senderName: patient.name,
      content: `Hello Dr. ${doctor.name}, I have scheduled an online consultation for ${scheduledTime}. Fee: ₹${consultationFee || 500}.`,
      type: 'text',
      isRead: false,
      timestamp: new Date().toISOString(),
    };
    await addMessage(message);
    finalConversation = await updateConversation(conversationId, {
      lastMessage: message.content,
      lastMessageAt: message.timestamp,
      unreadDoctor: 1,
    });
  }

  console.log(`✅ New conversation created: ${conversationId} (${doctor.name} ↔ ${patient.name})`);

  return res.status(201).json({
    success: true,
    message: 'Conversation started successfully.',
    conversation: finalConversation,
    isNew: true,
  });
};

// ─────────────────────────────────────────────
// GET /api/chat/conversations/:email/:role
// Get all conversations for a user
// ─────────────────────────────────────────────
export const getUserConversations = async (req, res) => {
  const { email, role } = req.params;

  if (!email || !role) {
    return res.status(400).json({
      success: false,
      error: 'Email and role are required.',
    });
  }

  const conversations = await getConversationsForUser(email, role);

  // Sort by last message time (newest first), then by creation time
  conversations.sort((a, b) => {
    const dateA = a.lastMessageAt || a.createdAt;
    const dateB = b.lastMessageAt || b.createdAt;
    return new Date(dateB) - new Date(dateA);
  });

  // Enrich with unread counts
  const enriched = conversations.map((conv) => ({
    ...conv,
    unreadCount: role === 'doctor' ? conv.unreadDoctor : conv.unreadPatient,
    otherPartyName: role === 'doctor' ? conv.patientName : conv.doctorName,
    otherPartyEmail: role === 'doctor' ? conv.patientEmail : conv.doctorEmail,
  }));

  return res.json({
    success: true,
    count: enriched.length,
    conversations: enriched,
  });
};

// ─────────────────────────────────────────────
// GET /api/chat/messages/:conversationId
// Get all messages in a conversation
// Query params: ?page=1&limit=50
// ─────────────────────────────────────────────
export const getConversationMessages = async (req, res) => {
  const { conversationId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  if (!conversationId) {
    return res.status(400).json({
      success: false,
      error: 'Conversation ID is required.',
    });
  }

  // Verify conversation exists
  const conversation = await findConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found.',
    });
  }

  // Fetch all messages for this conversation
  const allMessages = await getMessagesByConversation(conversationId);

  // Sort by timestamp (oldest first for chat display)
  allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Paginate
  const startIdx = (page - 1) * limit;
  const paginatedMessages = allMessages.slice(startIdx, startIdx + limit);

  return res.json({
    success: true,
    conversationId,
    totalMessages: allMessages.length,
    page,
    limit,
    messages: paginatedMessages,
  });
};

// ─────────────────────────────────────────────
// POST /api/chat/send
// Send a message in a conversation
// Body: { conversationId, senderEmail, senderRole, content, type }
// ─────────────────────────────────────────────
export const sendMessage = async (req, res) => {
  const { conversationId, senderEmail, senderRole, content, type } = req.body;

  // Validation
  if (!conversationId || !senderEmail || !senderRole || !content) {
    return res.status(400).json({
      success: false,
      error: 'conversationId, senderEmail, senderRole, and content are required.',
    });
  }

  // Verify conversation exists
  const conversation = await findConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found.',
    });
  }

  // Verify sender is a participant
  const isParticipant =
    (senderRole === 'doctor' && conversation.doctorEmail.toLowerCase() === senderEmail.toLowerCase()) ||
    (senderRole === 'patient' && conversation.patientEmail.toLowerCase() === senderEmail.toLowerCase());

  if (!isParticipant) {
    return res.status(403).json({
      success: false,
      error: 'You are not a participant in this conversation.',
    });
  }

  // Build message object
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const message = {
    messageId,
    conversationId,
    senderEmail,
    senderRole,
    senderName: senderRole === 'doctor' ? conversation.doctorName : conversation.patientName,
    content: content.trim(),
    type: type || 'text', // text, image, file, prescription
    isRead: false,
    timestamp: new Date().toISOString(),
  };

  // Save message
  await addMessage(message);

  // Update conversation metadata
  const unreadField = senderRole === 'doctor' ? 'unreadPatient' : 'unreadDoctor';
  const currentUnread = conversation[unreadField] || 0;

  await updateConversation(conversationId, {
    lastMessage: content.trim().substring(0, 100),
    lastMessageAt: message.timestamp,
    [unreadField]: currentUnread + 1,
  });

  console.log(`💬 Message sent in ${conversationId}: [${senderRole}] ${content.substring(0, 50)}...`);

  return res.status(201).json({
    success: true,
    message: message,
  });
};

// ─────────────────────────────────────────────
// PUT /api/chat/read/:conversationId
// Mark all messages as read for a user
// Body: { email, role }
// ─────────────────────────────────────────────
export const markAsRead = async (req, res) => {
  const { conversationId } = req.params;
  const { email, role } = req.body;

  if (!conversationId || !email || !role) {
    return res.status(400).json({
      success: false,
      error: 'conversationId, email, and role are required.',
    });
  }

  const conversation = await findConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found.',
    });
  }

  // Reset unread count for this user
  const unreadField = role === 'doctor' ? 'unreadDoctor' : 'unreadPatient';
  await updateConversation(conversationId, {
    [unreadField]: 0,
  });

  console.log(`✅ Marked as read: ${conversationId} for ${email} (${role})`);

  return res.json({
    success: true,
    message: 'Messages marked as read.',
  });
};
