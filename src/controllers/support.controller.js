import { MESSAGES } from '../messages.js';
import { getSupportMenu } from '../keyboards.js';
import { sendMessage } from '../telegram.js';
import { isUserBanned } from '../services/user.service.js';
import { getSystemSettings } from '../services/system.service.js';

/**
 * Handles the "📞 Support" request.
 * Displays the support contact information and inline button.
 *
 * @param {number} chatId - The chat ID to send the message to.
 * @param {number} userId - The Telegram User ID requesting support.
 */
export async function handleSupport(chatId, userId) {
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

    // 3. Fetch Support Username from Settings
    const supportUsername = settings?.supportUsername;
    
    // 4. Handle Missing Configuration
    if (!supportUsername) {
      console.warn(`[SUPPORT] Support username is not configured in system settings.`);
      return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    }

    // 5. Send Support Message with Inline Keyboard
    return await sendMessage(
      chatId, 
      MESSAGES.CONTACT_SUPPORT, 
      getSupportMenu(supportUsername)
    );

  } catch (error) {
    console.error(`[SUPPORT ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
