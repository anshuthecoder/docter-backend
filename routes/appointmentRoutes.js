import express from 'express';
import {
  bookAndPayAppointment,
  getUserAppointments,
  startChat
} from '../controllers/appointmentController.js';

const router = express.Router();

// Route: POST /api/appointments/book
router.post('/book', bookAndPayAppointment);

// Route: GET /api/appointments/:email/:role
router.get('/:email/:role', getUserAppointments);

// Route: POST /api/appointments/:id/start-chat
router.post('/:id/start-chat', startChat);

export default router;
