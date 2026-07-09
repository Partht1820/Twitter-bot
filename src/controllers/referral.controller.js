import { MESSAGES } from '../messages.js';
import { sendMessage } from '../telegram.js';
import { getUser, isUserBanned } from '../services/user.service.js';
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
 * Handles the "🎁 Refer & Earn" request.
 * Displays the user's referral link and performance statistics.
 * * @param {number} chatId - The chat ID to send the message to.
 * @param {number} userId - The Telegram User ID requesting the referral info.
 */
export async function handleReferral(chatId, userId) {
  try {
    // 1. Check System Maintenance Mode
    const settings = await getSystemSettings();
    if (settings?.isMaintenanceMode) {
      return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    // 2. Check User Ban Status
    const isBanned = await isUserBanned(userId);
    if (isBanned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    // 3. Fetch User Details from Database
    const user = await getUser(userId);
    if (!user) {
      console.warn(`[REFERRAL] User not found in database: ${userId}`);
      return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    }

    // 4. Extract Referral Settings and Bot Username
    const referralBonus = settings?.referralBonus || 0;
    const botUsername = CONFIG?.telegram?.botUsername || CONFIG?.telegram?.username || 'YourBot';
    
    // 5. Generate Referral Link
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;

    // 6. Replace Placeholders in the Template
    let messageText = MESSAGES.REFER_AND_EARN_INFORMATION
      .replace('{amount}', escapeForCodeBlock(referralBonus))
      .replace('{referralLink}', escapeForCodeBlock(referralLink));

    // 7. Append Statistics (Total Referrals & Total Earnings)
    const totalReferrals = user.totalReferrals || 0;
    const referralEarnings = user.referralEarnings || 0;

    messageText += `\n\n📊 *Your Stats*\n`;
    messageText += `👥 *Total Referrals:* \`${escapeForCodeBlock(totalReferrals)}\`\n`;
    messageText += `💰 *Total Earnings:* \`₹${escapeForCodeBlock(referralEarnings)}\``;

    // 8. Send the Referral Information Message
    return await sendMessage(chatId, messageText);

  } catch (error) {
    console.error(`[REFERRAL ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
