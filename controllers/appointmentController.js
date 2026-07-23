import {
  createAppointment,
  generateAppointmentId,
  getAppointmentsByUser,
  getAppointmentById,
  findUserByEmailAndRole,
  createConversation,
  generateConversationId,
  findConversationByParticipants,
  updateAppointmentStatus
} from '../config/db.js';

// 1. Create Appointment and Process Payment (Patient)
export const bookAndPayAppointment = async (req, res) => {
  try {
    const { doctorEmail, patientEmail, scheduledTime, consultationFee } = req.body;

    if (!doctorEmail || !patientEmail || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Get names
    const doctor = await findUserByEmailAndRole(doctorEmail, 'doctor');
    const patient = await findUserByEmailAndRole(patientEmail, 'patient');

    const doctorName = doctor ? doctor.name : doctorEmail.split('@')[0];
    const patientName = patient ? patient.name : patientEmail.split('@')[0];

    const appointmentData = {
      appointmentId: generateAppointmentId(),
      doctorEmail,
      doctorName,
      patientEmail,
      patientName,
      scheduledTime,
      consultationFee: consultationFee || (doctor?.profileData?.fee || 500),
      status: 'paid' // Simulated instant payment
    };

    const newAppointment = await createAppointment(appointmentData);

    res.status(201).json({
      success: true,
      message: 'Payment successful and appointment booked!',
      appointment: newAppointment
    });
  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({ success: false, error: 'Failed to book appointment' });
  }
};

// 2. Get User Appointments (Doctor or Patient)
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

// 3. Start Chat (When time arrives)
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
