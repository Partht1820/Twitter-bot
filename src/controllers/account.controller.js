import { MESSAGES } from '../messages.js';
import { sendMessage } from '../telegram.js';
import { getUser, isUserBanned } from '../services/user.service.js';
import { getSystemSettings } from '../services/system.service.js';

/**
 * Escapes specific characters for Telegram MarkdownV2 code blocks.
 * Since the placeholders in MESSAGES.MY_ACCOUNT are wrapped in backticks (`),
 * we only need to escape backslashes and backticks inside the dynamic values.
 * @param {string|number} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeForCodeBlock(text) {
  if (text === null || text === undefined) return 'None';
  return text.toString().replace(/([`\\])/g, '\\$1');
}

/**
 * Handles the "👤 My Account" request.
 * Displays a read-only summary of the user's account information.
 * * @param {number} chatId - The chat ID to send the message to.
 * @param {number} userId - The Telegram User ID requesting the account details.
 */
export async function handleMyAccount(chatId, userId) {
  try {
    // 1. Check System Maintenance Mode
    const systemSettings = await getSystemSettings();
    if (systemSettings?.isMaintenanceMode) {
      return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    // 2. Check User Ban Status
    const isBanned = await isUserBanned(userId);
    if (isBanned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    // 3. Fetch User Details from Database
    const user = await getUser(userId);
    
    // 4. Handle edge case: User does not exist in the database
    if (!user) {
      console.warn(`[MY ACCOUNT] User not found in database: ${userId}`);
      return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    }

    // 5. Format User Data
    const firstName = user.firstName || 'Unknown';
    const username = user.username ? `@${user.username}` : 'None';
    const balance = typeof user.balance === 'number' ? user.balance.toString() : '0';
    const totalReferrals = typeof user.totalReferrals === 'number' ? user.totalReferrals.toString() : '0';
    
    // Format Join Date to a clean, readable string (e.g., "09 Jul 2026")
    const joinDate = user.createdAt 
      ? new Date(user.createdAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      : 'Unknown';

    // 6. Replace Placeholders in the Message Template
    const accountMessage = MESSAGES.MY_ACCOUNT
      .replace('{userId}', escapeForCodeBlock(userId))
      .replace('{firstName}', escapeForCodeBlock(firstName))
      .replace('{username}', escapeForCodeBlock(username))
      .replace('{balance}', escapeForCodeBlock(balance))
      .replace('{referrals}', escapeForCodeBlock(totalReferrals))
      .replace('{date}', escapeForCodeBlock(joinDate));

    // 7. Send the Account Information Message (No inline keyboards attached)
    return await sendMessage(chatId, accountMessage);

  } catch (error) {
    console.error(`[MY ACCOUNT ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
