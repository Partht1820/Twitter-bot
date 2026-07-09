import { MESSAGES } from '../messages.js';
import { sendMessage, editMessageReplyMarkup } from '../telegram.js';
import { updateBalance } from '../services/user.service.js';
import { addWalletTransaction } from '../services/wallet.service.js';
import { getPaymentById, updatePaymentStatus } from '../services/payment.service.js';
import { getSystemSettings } from '../services/system.service.js';
import { CONFIG } from '../config.js';

/**
 * Escapes text specifically for inside MarkdownV2 code blocks (`text`).
 * @param {string|number} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeForCodeBlock(text) {
  if (text === null || text === undefined) return '0';
  return text.toString().replace(/([`\\])/g, '\\$1');
}

/**
 * Verifies if the user attempting the action is the configured admin.
 * @param {number} userId - The user ID to verify.
 * @returns {Promise<boolean>} - True if admin, false otherwise.
 */
async function isAdmin(userId) {
  const settings = await getSystemSettings();
  const adminId = settings?.adminChatId || CONFIG?.adminId;
  return String(userId) === String(adminId);
}

/**
 * Removes the inline keyboard from the admin's message to prevent duplicate clicks.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} messageId - The message ID of the payment request.
 */
async function removeAdminKeyboard(chatId, messageId) {
  try {
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
  } catch (error) {
    console.warn(`[PAYMENT] Failed to remove inline keyboard for message ${messageId}:`, error.message);
  }
}

/**
 * Handles the payment approval callback triggered by the admin.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin pressing the button.
 * @param {string|number} paymentId - The unique ID of the payment.
 * @param {string|number} paymentUserId - The user ID of the person who submitted the payment.
 * @param {number} messageId - The message ID containing the inline keyboard.
 */
export async function handleApprovePayment(chatId, adminId, paymentId, paymentUserId, messageId) {
  try {
    // 1. Verify Admin Authorization
    const authorized = await isAdmin(adminId);
    if (!authorized) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized to approve payments.");
    }

    // 2. Fetch Payment Details
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      await removeAdminKeyboard(chatId, messageId);
      return await sendMessage(chatId, `❌ *Error:* Payment \`${paymentId}\` not found in database.`);
    }

    // 3. Prevent Duplicate Approval/Rejection
    if (payment.status !== 'PENDING') {
      await removeAdminKeyboard(chatId, messageId);
      return await sendMessage(chatId, `⚠️ Payment \`${paymentId}\` has already been processed (Status: ${payment.status}).`);
    }

    // 4. Validate Payment Amount (Ensure amount exists before approving)
    const amount = Number(payment.amount);
    if (isNaN(amount) || amount <= 0) {
      return await sendMessage(chatId, `❌ *Error:* Payment \`${paymentId}\` does not have a valid amount set. Please update the amount in the database before approving.`);
    }

    // 5. Execute Approval Workflow
    await updatePaymentStatus(paymentId, 'APPROVED');
    await updateBalance(paymentUserId, amount);
    await addWalletTransaction(paymentUserId, 'DEPOSIT', amount, `Payment approved (ID: ${paymentId})`);

    // 6. Update Admin UI
    await removeAdminKeyboard(chatId, messageId);
    await sendMessage(chatId, `✅ *Payment Approved*\n\nAdded \`₹${amount}\` to User \`${paymentUserId}\`'s wallet.`);

    // 7. Notify User
    const userMessage = MESSAGES.PAYMENT_APPROVED.replace('{amount}', escapeForCodeBlock(amount));
    await sendMessage(paymentUserId, userMessage);

  } catch (error) {
    console.error(`[APPROVE PAYMENT ERROR] Payment: ${paymentId} | Admin: ${adminId}`, error);
    await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the payment rejection callback triggered by the admin.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin pressing the button.
 * @param {string|number} paymentId - The unique ID of the payment.
 * @param {string|number} paymentUserId - The user ID of the person who submitted the payment.
 * @param {number} messageId - The message ID containing the inline keyboard.
 */
export async function handleRejectPayment(chatId, adminId, paymentId, paymentUserId, messageId) {
  try {
    // 1. Verify Admin Authorization
    const authorized = await isAdmin(adminId);
    if (!authorized) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized to reject payments.");
    }

    // 2. Fetch Payment Details
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      await removeAdminKeyboard(chatId, messageId);
      return await sendMessage(chatId, `❌ *Error:* Payment \`${paymentId}\` not found in database.`);
    }

    // 3. Prevent Duplicate Approval/Rejection
    if (payment.status !== 'PENDING') {
      await removeAdminKeyboard(chatId, messageId);
      return await sendMessage(chatId, `⚠️ Payment \`${paymentId}\` has already been processed (Status: ${payment.status}).`);
    }

    // 4. Execute Rejection Workflow
    await updatePaymentStatus(paymentId, 'REJECTED');

    // 5. Update Admin UI
    await removeAdminKeyboard(chatId, messageId);
    await sendMessage(chatId, `❌ *Payment Rejected*\n\nPayment \`${paymentId}\` from User \`${paymentUserId}\` has been successfully rejected.`);

    // 6. Notify User
    await sendMessage(paymentUserId, MESSAGES.PAYMENT_REJECTED);

  } catch (error) {
    console.error(`[REJECT PAYMENT ERROR] Payment: ${paymentId} | Admin: ${adminId}`, error);
    await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
