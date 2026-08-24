import {
  createAppointment,
  generateAppointmentId,
  getAppointmentsByUser,
  getAppointmentById,
  getAppointmentByOrderId,
  updateAppointmentStatus,
  updateAppointmentPaymentStatus,
  findUserByEmailAndRole,
  createConversation,
  generateConversationId,
  findConversationByParticipants,
  addMessage,
  updateConversation
} from '../config/db.js';
import { createCashfreeOrder, getCashfreeOrderStatus } from '../services/cashfreeService.js';

// Send Booking Confirmation Email via Resend
const sendBookingConfirmationEmail = async (patientEmail, patientName, doctorName, scheduledTime, consultationFee, appointmentId) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'CureMotion Health Hub <onboarding@resend.dev>';
  const subject = `Booking Confirmed: Online Consultation with Dr. ${doctorName}`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; color: #1E293B; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 30px auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1px solid #E2E8F0; }
          .header { background: #0F6CBD; padding: 30px; text-align: center; color: white; }
          .content { padding: 30px; }
          .badge { background: #E0F2FE; color: #0369A1; font-weight: 700; padding: 6px 14px; border-radius: 20px; display: inline-block; font-size: 13px; margin-bottom: 15px; }
          .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #F8FAFC; border-radius: 12px; }
          .info-table td { padding: 14px 18px; border-bottom: 1px solid #E2E8F0; font-size: 14px; }
          .info-table td:first-child { color: #64748B; font-weight: 600; width: 40%; }
          .info-table td:last-child { color: #1E293B; font-weight: 700; text-align: right; }
          .footer { background: #F1F5F9; padding: 20px; text-align: center; font-size: 12px; color: #64748B; }
          .btn { display: inline-block; background: #0F6CBD; color: white; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px; font-weight: 800;">CureMotion Health Hub</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Appointment & Payment Confirmation</p>
          </div>
          <div class="content">
            <div class="badge">Payment Successful</div>
            <h2 style="margin: 0 0 10px 0; color: #1E293B; font-size: 20px;">Hello ${patientName || 'Patient'},</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
              Your online consultation appointment with <strong>Dr. ${doctorName}</strong> has been successfully booked and confirmed.
            </p>
            <table class="info-table">
              <tr>
                <td>Doctor</td>
                <td>Dr. ${doctorName}</td>
              </tr>
              <tr>
                <td>Scheduled Time</td>
                <td>${scheduledTime}</td>
              </tr>
              <tr>
                <td>Amount Paid</td>
                <td>₹${consultationFee}</td>
              </tr>
              <tr>
                <td>Appointment ID</td>
                <td>${appointmentId}</td>
              </tr>
              <tr style="border-bottom: none;">
                <td>Consultation Type</td>
                <td>Online Consultation / Chat</td>
              </tr>
            </table>
            <p style="color: #64748B; font-size: 13px; line-height: 1.5;">
              You can access your consultation chat directly from your CureMotion dashboard at the scheduled time.
            </p>
            <div style="text-align: center; margin-top: 25px;">
              <a href="https://www.curemotionhealthhub.com/appointments" class="btn" style="color: #FFFFFF;">View My Appointments</a>
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} CureMotion Health Hub. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [patientEmail],
        subject,
        html
      })
    });
    console.log(`📧 [Resend] Confirmation email sent to ${patientEmail}`);
  } catch (err) {
    console.warn('⚠️ Failed to send confirmation email via Resend:', err.message);
  }
};

/**
 * 1. Create Cashfree Payment Order (Patient clicks Pay)
 */
export const createPaymentOrder = async (req, res) => {
  try {
    const {
      doctorEmail,
      patientEmail,
      scheduledTime,
      consultationFee,
      customerPhone,
      customerName,
      returnUrl
    } = req.body;

    if (!doctorEmail || !patientEmail || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Doctor, Patient, and Scheduled Time are required' });
    }

    const doctor = await findUserByEmailAndRole(doctorEmail, 'doctor');
    const patient = await findUserByEmailAndRole(patientEmail, 'patient');

    const doctorName = doctor ? doctor.name : (doctorEmail.split('@')[0]);
    const patName = customerName || (patient ? patient.name : patientEmail.split('@')[0]);
    const fee = parseInt(consultationFee || (doctor?.profileData?.consultationFee) || 500, 10);

    const appointmentId = generateAppointmentId();
    const orderId = `CF_APT_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // 1. Create Cashfree Order via API
    const cfResult = await createCashfreeOrder({
      orderId,
      orderAmount: fee,
      customerDetails: {
        customerEmail: patientEmail,
        customerName: patName,
        customerPhone: customerPhone || patient?.mobile || '9999999999'
      },
      orderMeta: {
        returnUrl: returnUrl || `https://www.curemotionhealthhub.com/appointments?order_id=${orderId}`
      },
      orderNote: `Consultation with Dr. ${doctorName} on ${scheduledTime}`
    });

    if (!cfResult.success) {
      return res.status(500).json({
        success: false,
        error: cfResult.error || 'Failed to initiate Cashfree payment session'
      });
    }

    // 2. Store pending appointment in database
    const newAppointment = await createAppointment({
      appointmentId,
      doctorEmail,
      doctorName,
      patientEmail,
      patientName: patName,
      scheduledTime,
      consultationFee: fee,
      status: 'pending',
      orderId,
      cfOrderId: cfResult.cfOrderId,
      paymentSessionId: cfResult.paymentSessionId
    });

    res.status(201).json({
      success: true,
      message: 'Cashfree payment session created successfully',
      paymentSessionId: cfResult.paymentSessionId,
      orderId,
      cfOrderId: cfResult.cfOrderId,
      appointmentId,
      amount: fee,
      mode: cfResult.mode,
      appointment: newAppointment
    });
  } catch (error) {
    console.error('❌ Error creating Cashfree payment order:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error creating payment order' });
  }
};

/**
 * 2. Verify Cashfree Payment (After patient completes checkout)
 */
export const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required' });
    }

    // 1. Query Cashfree API directly for ground truth status
    const statusResult = await getCashfreeOrderStatus(orderId);

    if (!statusResult.success) {
      return res.status(400).json({
        success: false,
        error: statusResult.error || 'Failed to verify order status with Cashfree'
      });
    }

    const orderStatus = statusResult.orderStatus; // 'PAID', 'ACTIVE', 'EXPIRED', 'FAILED'

    if (orderStatus === 'PAID') {
      // 2. Update appointment status in database
      const updatedAppointment = await updateAppointmentPaymentStatus(orderId, 'paid', statusResult.cfOrderId);

      if (updatedAppointment) {
        // 3. Automatically create/unlock chat conversation
        try {
          const existingConv = await findConversationByParticipants(
            updatedAppointment.doctorEmail,
            updatedAppointment.patientEmail
          );

          if (!existingConv) {
            await createConversation({
              conversationId: generateConversationId(),
              doctorEmail: updatedAppointment.doctorEmail,
              doctorName: updatedAppointment.doctorName,
              patientEmail: updatedAppointment.patientEmail,
              patientName: updatedAppointment.patientName,
              status: 'active',
              consultationFee: updatedAppointment.consultationFee,
              scheduledTime: updatedAppointment.scheduledTime
            });
          }
        } catch (convErr) {
          console.warn('⚠️ Non-fatal error creating conversation after payment:', convErr.message);
        }

        // 4. Send Confirmation Email to Patient
        sendBookingConfirmationEmail(
          updatedAppointment.patientEmail,
          updatedAppointment.patientName,
          updatedAppointment.doctorName,
          updatedAppointment.scheduledTime,
          updatedAppointment.consultationFee,
          updatedAppointment.appointmentId
        ).catch(console.error);

        return res.status(200).json({
          success: true,
          message: 'Payment verified successfully! Appointment confirmed.',
          orderStatus: 'PAID',
          appointment: updatedAppointment
        });
      } else {
        return res.status(200).json({
          success: true,
          message: 'Payment marked as PAID by Cashfree.',
          orderStatus: 'PAID'
        });
      }
    } else if (orderStatus === 'ACTIVE') {
      return res.status(200).json({
        success: false,
        pending: true,
        orderStatus: 'ACTIVE',
        message: 'Payment is pending. Please complete checkout.'
      });
    } else {
      await updateAppointmentPaymentStatus(orderId, 'failed', statusResult.cfOrderId);
      return res.status(400).json({
        success: false,
        orderStatus,
        error: `Payment was not completed (Status: ${orderStatus})`
      });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error verifying payment' });
  }
};

/**
 * 3. Direct/Simulated Book and Pay (Fallback or Sandbox)
 */
export const bookAndPayAppointment = async (req, res) => {
  try {
    const {
      doctorEmail,
      doctorName: reqDoctorName,
      patientEmail,
      patientName: reqPatientName,
      patientPhone,
      scheduledTime,
      consultationFee,
      mode = 'In-Clinic Hospital Visit',
      symptoms = '',
      hospital = ''
    } = req.body;

    if (!doctorEmail || !patientEmail || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Doctor email, Patient email, and Scheduled Time are required.' });
    }

    const doctor = await findUserByEmailAndRole(doctorEmail, 'doctor');
    const patient = await findUserByEmailAndRole(patientEmail, 'patient');

    const doctorName = reqDoctorName || (doctor ? doctor.name : doctorEmail.split('@')[0]);
    const patientName = reqPatientName || (patient ? patient.name : patientEmail.split('@')[0]);
    const fee = Number(consultationFee) || 40; // Default ₹40 for In-Clinic slot booking token

    const appointmentData = {
      appointmentId: generateAppointmentId(),
      doctorEmail,
      doctorName,
      patientEmail,
      patientName,
      scheduledTime,
      consultationFee: fee,
      status: 'confirmed',
      mode,
      patientPhone: patientPhone || '',
      symptoms: symptoms || '',
      hospital: hospital || (doctor?.profileData?.currentHospital || doctor?.profileData?.hospital || '')
    };

    const newAppointment = await createAppointment(appointmentData);

    // Auto-create/update chat conversation and send slot booking message
    let conversation = null;
    try {
      const existingConv = await findConversationByParticipants(doctorEmail, patientEmail);
      let convId = existingConv?.conversationId;

      if (!existingConv) {
        convId = generateConversationId();
        conversation = await createConversation({
          conversationId: convId,
          doctorEmail,
          doctorName,
          patientEmail,
          patientName,
          status: 'active',
          consultationFee: fee,
          scheduledTime
        });
      } else {
        conversation = existingConv;
      }

      // Add auto-generated booking message from patient to doctor
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const autoMessage = {
        messageId,
        conversationId: convId,
        senderEmail: patientEmail,
        senderRole: 'patient',
        senderName: patientName,
        content: `Hello Dr. ${doctorName}, I have booked a ${mode} for ${scheduledTime}. Fee Paid: ₹${fee}.`,
        type: 'text',
        isRead: false,
        timestamp: new Date().toISOString()
      };
      await addMessage(autoMessage);

      conversation = await updateConversation(convId, {
        lastMessage: autoMessage.content,
        lastMessageAt: autoMessage.timestamp,
        unreadDoctor: (existingConv?.unreadDoctor || 0) + 1,
        scheduledTime,
        consultationFee: fee
      });
      console.log(`💬 Auto-sent booking message in conversation: ${convId}`);
    } catch (e) {
      console.warn('⚠️ Error creating conversation/message in booking:', e.message);
    }

    res.status(201).json({
      success: true,
      message: `${mode} booked & confirmed successfully!`,
      conversationId: conversation?.conversationId,
      conversation,
      appointment: {
        ...newAppointment,
        mode,
        hospital: appointmentData.hospital,
        patientPhone: appointmentData.patientPhone,
        symptoms: appointmentData.symptoms
      }
    });
  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to book appointment' });
  }
};

/**
 * 4. Get User Appointments (Doctor or Patient)
 */
export const getUserAppointments = async (req, res) => {
  try {
    const { email, role } = req.params;

    if (!['doctor', 'patient'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    const appointments = await getAppointmentsByUser(email, role);

    res.status(200).json({
      success: true,
      appointments
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appointments' });
  }
};

/**
 * 5. Start Chat (When time arrives)
 */
export const startChat = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await getAppointmentById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    if (appointment.status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Appointment is not paid' });
    }

    // Create or find conversation to unlock chat
    let conversation = await findConversationByParticipants(appointment.doctorEmail, appointment.patientEmail);
    
    if (!conversation) {
      conversation = await createConversation({
        conversationId: generateConversationId(),
        doctorEmail: appointment.doctorEmail,
        doctorName: appointment.doctorName,
        patientEmail: appointment.patientEmail,
        patientName: appointment.patientName,
        status: 'active',
        consultationFee: appointment.consultationFee,
        scheduledTime: appointment.scheduledTime
      });
    }

    res.status(200).json({
      success: true,
      message: 'Chat created/retrieved.',
      conversation
    });
  } catch (error) {
    console.error('Error starting chat:', error);
    res.status(500).json({ success: false, error: 'Failed to start chat' });
  }
};
