import prisma from '../database.js';

/**
 * Creates a new order in the database.
 * @param {Object} data - The order details (userId, activationId, phoneNumber, status, etc.).
 * @returns {Promise<Object>} The created order.
 */
export async function createOrder(data) {
  try {
    return await prisma.order.create({
      data
    });
  } catch (error) {
    console.error(`[DB ERROR] createOrder (User: ${data.userId}):`, error);
    throw error;
  }
}

/**
 * Retrieves the currently active order for a specific user.
 * Assumes a user can only have one active order at a time.
 * @param {number|bigint} userId - The Telegram User ID.
 * @returns {Promise<Object|null>} The active order object, or null if none found.
 */
export async function getActiveOrder(userId) {
  try {
    return await prisma.order.findFirst({
      where: {
        userId: userId,
        status: 'ACTIVE'
      }
    });
  } catch (error) {
    console.error(`[DB ERROR] getActiveOrder (User: ${userId}):`, error);
    throw error;
  }
}

/**
 * Retrieves a specific order by its unique ID.
 * @param {string|number} orderId - The unique ID of the order.
 * @returns {Promise<Object|null>} The order object, or null if not found.
 */
export async function getOrderById(orderId) {
  try {
    return await prisma.order.findUnique({
      where: { id: orderId }
    });
  } catch (error) {
    console.error(`[DB ERROR] getOrderById (Order ID: ${orderId}):`, error);
    throw error;
  }
}

/**
 * Updates the number of OTPs received for a specific order.
 * @param {string|number} orderId - The unique ID of the order.
 * @param {number} otpCount - The updated OTP count.
 * @returns {Promise<Object>} The updated order.
 */
export async function updateOrderOtpCount(orderId, otpCount) {
  try {
    return await prisma.order.update({
      where: { id: orderId },
      data: { otpCount: otpCount }
    });
  } catch (error) {
    console.error(`[DB ERROR] updateOrderOtpCount (Order ID: ${orderId}):`, error);
    throw error;
  }
}

/**
 * Marks an order as successfully completed.
 * @param {string|number} orderId - The unique ID of the order.
 * @returns {Promise<Object>} The updated order.
 */
export async function completeOrder(orderId) {
  try {
    return await prisma.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED' }
    });
  } catch (error) {
    console.error(`[DB ERROR] completeOrder (Order ID: ${orderId}):`, error);
    throw error;
  }
}

/**
 * Marks an order as cancelled.
 * @param {string|number} orderId - The unique ID of the order.
 * @returns {Promise<Object>} The updated order.
 */
export async function cancelOrder(orderId) {
  try {
    return await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' }
    });
  } catch (error) {
    console.error(`[DB ERROR] cancelOrder (Order ID: ${orderId}):`, error);
    throw error;
  }
}
