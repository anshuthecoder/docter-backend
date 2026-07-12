/**
 * Chat Routes
 * Maps URL endpoints to chat controller actions.
 */

import { Router } from 'express';
import {
  startConversation,
  getUserConversations,
  getConversationMessages,
  sendMessage,
  markAsRead
} from '../controllers/chatController.js';

const router = Router();

// POST /api/chat/start - Start or get an existing conversation
router.post('/start', startConversation);

// GET /api/chat/conversations/:email/:role - Get conversations for a user
router.get('/conversations/:email/:role', getUserConversations);

// GET /api/chat/messages/:conversationId - Get messages in a conversation
router.get('/messages/:conversationId', getConversationMessages);

// POST /api/chat/send - Send a message
router.post('/send', sendMessage);

// PUT /api/chat/read/:conversationId - Mark messages as read
router.put('/read/:conversationId', markAsRead);

export default router;
