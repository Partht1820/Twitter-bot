import { MESSAGES } from '../messages.js';
import { getPaymentApproveReject } from '../keyboards.js';
import { sendMessage, sendPhoto } from '../telegram.js';
import { getUser, isUserBanned } from '../services/user.service.js';
import { getSystemSettings } from '../services/system.service.js';
import { getWalletTransactions } from '../services/wallet.service.js';
import { createPendingPayment } from '../services/payment.service.js';

/**
 * Escapes specific characters for Telegram MarkdownV2 formatting.
 * @param {string|number} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Escapes text specifically for inside MarkdownV2 code blocks (`text`).
 * @param {string|number} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeForCodeBlock(text) {
  if (text === null || text === undefined) return 'None';
  return text.toString().replace(/([`\\])/g, '\\$1');
}

/**
 * Handles the "💳 Add Balance" request.
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 */
export async function handleAddBalance(chatId, userId) {
  try {
    const settings = await getSystemSettings();
    if (settings?.isMaintenanceMode) {
      return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    const isBanned = await isUserBanned(userId);
    if (isBanned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    const upiId = settings?.upiId || 'Not Configured';
    
    // Replace the {upi} placeholder with the escaped UPI ID
    const instructions = MESSAGES.PAYMENT_INSTRUCTIONS.replace('{upi}', escapeForCodeBlock(upiId));
    
    return await sendMessage(chatId, instructions);
  } catch (error) {
    console.error(`[ADD BALANCE ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the "📜 Wallet History" request.
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 */
export async function handleWalletHistory(chatId, userId) {
  try {
    const settings = await getSystemSettings();
    if (settings?.isMaintenanceMode) {
      return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    const isBanned = await isUserBanned(userId);
    if (isBanned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    const transactions = await getWalletTransactions(userId, 10); // Fetch latest 10 transactions

    if (!transactions || transactions.length === 0) {
      return await sendMessage(chatId, MESSAGES.WALLET_HISTORY_EMPTY);
    }

    let historyText = "📜 *Wallet History*\n\n━━━━━━━━━━━━━━\n\n";
    
    transactions.forEach((tx) => {
      const date = new Date(tx.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const sign = tx.amount > 0 ? '+' : '';
      const amount = `₹${Math.abs(tx.amount)}`;
      const type = tx.type.replace(/_/g, ' ');

      historyText += `📅 *${escapeMarkdown(date)}*\n`;
      historyText += `🔹 *Type:* ${escapeMarkdown(type)}\n`;
      historyText += `💰 *Amount:* \`${sign}${escapeForCodeBlock(amount)}\`\n`;
      if (tx.description) {
        historyText += `📝 *Note:* _${escapeMarkdown(tx.description)}_\n`;
      }
      historyText += `\n━━━━━━━━━━━━━━\n\n`;
    });

    return await sendMessage(chatId, historyText);
  } catch (error) {
    console.error(`[WALLET HISTORY ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the processing of a payment screenshot uploaded by the user.
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 * @param {string} photoFileId - The file ID of the uploaded photo.
 */
export async function handlePaymentScreenshot(chatId, userId, photoFileId) {
  try {
    const settings = await getSystemSettings();
    if (settings?.isMaintenanceMode) {
      return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    const isBanned = await isUserBanned(userId);
    if (isBanned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    // Ensure the user exists
    const user = await getUser(userId);
    if (!user) {
      return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    }

    // Create a pending payment request in the database
    const payment = await createPendingPayment({
      userId,
      photoFileId,
      status: 'PENDING'
    });

    // Notify the admin with the screenshot and approval keyboard
    const adminChatId = settings?.adminChatId;
    if (adminChatId) {
      const safeUserId = escapeForCodeBlock(userId);
      const safeUsername = user.username ? `@${escapeMarkdown(user.username)}` : 'None';
      const safePaymentId = escapeForCodeBlock(payment.id);
      
      const caption = `💳 *New Payment Request*\n\n🆔 *User ID:* \`${safeUserId}\`\n👤 *Username:* ${safeUsername}\n🧾 *Payment ID:* \`${safePaymentId}\``;
      
      await sendPhoto(adminChatId, photoFileId, {
        caption: caption,
        reply_markup: getPaymentApproveReject(payment.id, userId)
      });
    } else {
      console.warn(`[PAYMENT] Admin Chat ID is not configured. Payment ${payment.id} requires manual review via DB.`);
    }

    // Acknowledge successful submission to the user
    return await sendMessage(chatId, MESSAGES.PAYMENT_SUBMITTED_SUCCESSFULLY);
  } catch (error) {
    console.error(`[PAYMENT SCREENSHOT ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
