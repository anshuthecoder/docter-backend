import express from 'express';
import {
  createPaymentOrder,
  verifyPayment,
  bookAndPayAppointment,
  getUserAppointments,
  startChat
} from '../controllers/appointmentController.js';

const router = express.Router();

// Cashfree Payment Gateway Routes
// Route: POST /api/appointments/create-payment-order
router.post('/create-payment-order', createPaymentOrder);

// Route: POST /api/appointments/verify-payment
router.post('/verify-payment', verifyPayment);

// Legacy / Direct Booking Route
// Route: POST /api/appointments/book
router.post('/book', bookAndPayAppointment);

// Route: GET /api/appointments/:email/:role
router.get('/:email/:role', getUserAppointments);

// Route: POST /api/appointments/:id/start-chat
router.post('/:id/start-chat', startChat);

export default router;
