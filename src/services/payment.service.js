import prisma from '../database.js';

/**
 * Creates a new pending payment record in the database.
 * @param {Object} data - The payment details (userId, photoFileId, status).
 * @returns {Promise<Object>} The created payment record.
 */
export async function createPendingPayment(data) {
  try {
    return await prisma.payment.create({
      data
    });
  } catch (error) {
    console.error(`[DB ERROR] createPendingPayment (User: ${data.userId}):`, error);
    throw error;
  }
}

/**
 * Retrieves a specific payment by its unique ID.
 * @param {string|number} paymentId - The unique ID of the payment.
 * @returns {Promise<Object|null>} The payment object, or null if not found.
 */
export async function getPaymentById(paymentId) {
  try {
    return await prisma.payment.findUnique({
      where: { id: paymentId }
    });
  } catch (error) {
    console.error(`[DB ERROR] getPaymentById (Payment ID: ${paymentId}):`, error);
    throw error;
  }
}

/**
 * Updates the status of an existing payment.
 * @param {string|number} paymentId - The unique ID of the payment.
 * @param {string} status - The new status (e.g., 'APPROVED', 'REJECTED').
 * @returns {Promise<Object>} The updated payment record.
 */
export async function updatePaymentStatus(paymentId, status) {
  try {
    return await prisma.payment.update({
      where: { id: paymentId },
      data: { status: status }
    });
  } catch (error) {
    console.error(`[DB ERROR] updatePaymentStatus (Payment ID: ${paymentId}):`, error);
    throw error;
  }
}

/**
 * Retrieves all pending payment requests.
 * @returns {Promise<Array<Object>>} An array of pending payment records.
 */
export async function getPendingPayments() {
  try {
    return await prisma.payment.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' }
    });
  } catch (error) {
    console.error(`[DB ERROR] getPendingPayments:`, error);
    throw error;
  }
}
