import { MESSAGES } from '../messages.js';
import { getMainMenu, getForceJoinKeyboard, getAdminMainMenu } from '../keyboards.js';
import { sendMessage, editMessage, getChatMember } from '../telegram.js';
import { getUser, createUser, isUserBanned } from '../services/user.service.js';
import { processReferral } from '../services/referral.service.js';
import { getSystemSettings } from '../services/system.service.js';
import { CONFIG } from '../config.js';

/**
 * Helper function to verify if a user is a member of required channels/groups.
 * @param {number} userId - The Telegram User ID.
 * @param {Array<string>} chats - Array of chat usernames/IDs to check.
 * @returns {Promise<boolean>} - True if member of all, false otherwise.
 */
async function verifyForceJoin(userId, chats) {
  for (const chat of chats) {
    if (!chat) continue;
    
    try {
      const member = await getChatMember(chat, userId);
      if (['left', 'kicked'].includes(member.status)) {
        return false;
      }
    } catch (error) {
      console.error(`[FORCE JOIN] Failed to check membership for ${chat}:`, error.message);
      return false; // Assume not joined if API call fails
    }
  }
  return true;
}

/**
 * Handles the /start command.
 * @param {number} chatId - The chat ID.
 * @param {Object} telegramUser - The full Telegram user object (message.from).
 * @param {string} text - The raw message text.
 */
export async function handleStart(chatId, telegramUser, text) {
  const userId = telegramUser.id;

  try {
    // 1. Check Maintenance Mode
    const settings = await getSystemSettings();
    
    const adminId = settings?.adminChatId || CONFIG.telegram.adminId;
    const isAdmin = String(userId) === String(adminId);

    if (settings?.isMaintenanceMode && !isAdmin) {
        return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    // 2 & 3. Fetch or Create User
    let user = await getUser(userId);
    let isNewUser = false;

    if (!user) {
      user = await createUser({
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username
      });
      isNewUser = true;
    }

    // 4. Process Referral Parameter (e.g., /start ref_12345)
    if (isNewUser && text.includes(' ')) {
      const [, payload] = text.split(' ');
      if (payload) {
        await processReferral(userId, payload);
      }
    }

    // 5. Check if User is Banned
    const banned = await isUserBanned(userId);
    if (banned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    // 6 & 7. Verify Force Join
    if (settings?.forceJoinEnabled) {
      const isMember = await verifyForceJoin(userId, [settings.forceJoinChannel, settings.forceJoinGroup]);

      // 8. If not joined, send Force Join message
      if (!isMember) {
        return await sendMessage(
          chatId, 
          MESSAGES.FORCE_JOIN_REQUIRED, 
          getForceJoinKeyboard(settings.forceJoinChannel, settings.forceJoinGroup)
        );
      }
    }

    // 9. Verification succeeds: Show Welcome & Main Menu
    const menu = isAdmin ? getAdminMainMenu() : getMainMenu();

    await sendMessage(chatId, MESSAGES.WELCOME, menu);

  } catch (error) {
    console.error(`[START COMMAND ERROR] Chat: ${chatId} | User: ${userId} | Error:`, error);
    await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the Force Join verification callback (verify_join).
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 * @param {number} messageId - The message ID to edit.
 */
export async function handleVerifyJoin(chatId, userId, messageId) {
  try {
    // Check system states again for security
    const settings = await getSystemSettings();
    
    const adminId = settings?.adminChatId || CONFIG.telegram.adminId;
    const isAdmin = String(userId) === String(adminId);

    if (settings?.isMaintenanceMode && !isAdmin) {
        return await sendMessage(chatId, MESSAGES.MAINTENANCE_MODE);
    }

    const banned = await isUserBanned(userId);
    if (banned) {
      return await sendMessage(chatId, MESSAGES.USER_BANNED);
    }

    // Verify membership
    let isMember = true;
    if (settings?.forceJoinEnabled) {
      isMember = await verifyForceJoin(userId, [settings.forceJoinChannel, settings.forceJoinGroup]);
    }

    if (isMember) {
      // 9. If verification succeeds: update message & show Welcome + Main Menu
      const menu = isAdmin ? getAdminMainMenu() : getMainMenu();

      await editMessage(chatId, messageId, MESSAGES.VERIFICATION_SUCCESSFUL);
      await sendMessage(chatId, MESSAGES.WELCOME, menu);
    } else {
      // If verification fails
      await sendMessage(chatId, MESSAGES.VERIFICATION_FAILED);
    }

  } catch (error) {
    console.error(`[VERIFY JOIN ERROR] Chat: ${chatId} | User: ${userId} | Error:`, error);
    await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
