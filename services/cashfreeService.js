import dotenv from 'dotenv';
dotenv.config();

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '13568117c76340626033b2d82851186531';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'cfsk_ma_prod_5756aa79649c5242bd422159393b8122_286cda12';
const CASHFREE_ENV = process.env.CASHFREE_ENV || (CASHFREE_SECRET_KEY.includes('_prod_') ? 'production' : 'sandbox');
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';

const BASE_URL = CASHFREE_ENV === 'production' 
  ? 'https://api.cashfree.com/pg' 
  : 'https://sandbox.cashfree.com/pg';

console.log(`💳 [Cashfree] Initialized in ${CASHFREE_ENV.toUpperCase()} mode (Base URL: ${BASE_URL})`);

/**
 * Helper to clean customer IDs for Cashfree (Alphanumeric, max 50 chars)
 */
const sanitizeCustomerId = (rawId) => {
  if (!rawId) return `cust_${Date.now()}`;
  return rawId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);
};

/**
 * 1. Create a Cashfree Payment Order
 */
export const createCashfreeOrder = async ({
  orderId,
  orderAmount,
  orderCurrency = 'INR',
  customerDetails = {},
  orderMeta = {},
  orderNote = 'Doctor Consultation Booking'
}) => {
  try {
    const custId = sanitizeCustomerId(customerDetails.customerId || customerDetails.customerEmail);
    const custPhone = (customerDetails.customerPhone || '9999999999').replace(/[^0-9]/g, '').slice(-10) || '9999999999';
    const custName = customerDetails.customerName || 'Patient';
    const custEmail = customerDetails.customerEmail || 'patient@curemotionhealthhub.com';

    const payload = {
      order_id: orderId,
      order_amount: parseFloat(orderAmount).toFixed(2),
      order_currency: orderCurrency,
      customer_details: {
        customer_id: custId,
        customer_name: custName,
        customer_email: custEmail,
        customer_phone: custPhone
      },
      order_meta: {
        return_url: orderMeta.returnUrl || 'https://www.curemotionhealthhub.com/appointments',
        notify_url: orderMeta.notifyUrl || undefined
      },
      order_note: orderNote
    };

    console.log(`💳 [Cashfree] Creating order ${orderId} for ₹${orderAmount}...`);

    const response = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': CASHFREE_API_VERSION,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ [Cashfree] Order creation error response:', data);
      return {
        success: false,
        error: data.message || data.error || 'Failed to create Cashfree order',
        details: data
      };
    }

    console.log(`✅ [Cashfree] Order created successfully! CF Order ID: ${data.cf_order_id}, Session ID: ${data.payment_session_id}`);

    return {
      success: true,
      orderId: data.order_id,
      cfOrderId: data.cf_order_id,
      paymentSessionId: data.payment_session_id,
      orderStatus: data.order_status,
      orderAmount: data.order_amount,
      orderCurrency: data.order_currency,
      mode: CASHFREE_ENV
    };
  } catch (error) {
    console.error('❌ [Cashfree] Network/Exception while creating order:', error);
    return {
      success: false,
      error: error.message || 'Network error connecting to Cashfree API'
    };
  }
};

/**
 * 2. Fetch/Verify Cashfree Order Status
 */
export const getCashfreeOrderStatus = async (orderId) => {
  try {
    console.log(`💳 [Cashfree] Verifying status for order ${orderId}...`);

    const response = await fetch(`${BASE_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY,
        'x-api-version': CASHFREE_API_VERSION,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ [Cashfree] Order verification error response:', data);
      return {
        success: false,
        error: data.message || data.error || 'Failed to fetch order status',
        details: data
      };
    }

    console.log(`✅ [Cashfree] Order ${orderId} status: ${data.order_status}`);

    return {
      success: true,
      orderId: data.order_id,
      cfOrderId: data.cf_order_id,
      orderStatus: data.order_status, // 'PAID', 'ACTIVE', 'EXPIRED', 'FAILED'
      orderAmount: data.order_amount,
      orderCurrency: data.order_currency,
      paymentSessionId: data.payment_session_id,
      settlements: data.settlements || null,
      raw: data
    };
  } catch (error) {
    console.error('❌ [Cashfree] Network/Exception while verifying order:', error);
    return {
      success: false,
      error: error.message || 'Network error connecting to Cashfree API'
    };
  }
};
