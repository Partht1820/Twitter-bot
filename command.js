import { MESSAGES } from './messages.js';
import { sendMessage } from './telegram.js';

// Import controllers (Delegating business logic as per architecture)
import { handleStart } from './controllers/onboarding.controller.js';
import { handleBuyNumber } from './controllers/order.controller.js';
import { handleMyAccount } from './controllers/account.controller.js';
import { handleWalletHistory, handleAddBalance } from './controllers/wallet.controller.js';
import { handleReferral } from './controllers/referral.controller.js';
import { handleSupport } from './controllers/support.controller.js';

/**
 * Centralized Command & Message Handler
 * Routes incoming text messages and reply keyboard taps to appropriate controllers.
 * * @param {Object} message - The Telegram message object.
 */
export async function commandHandler(message) {
  // Ignore unsupported message types or missing data
  if (!message || !message.text || !message.chat || !message.from) {
    return;
  }

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim().normalize();

  try {
    // Handle parameterized commands (e.g., /start ref_12345)
    if (text.startsWith('/start')) {
      return await handleStart(chatId, userId, text);
    }

    // Route exact string matches from the Reply Keyboard
    switch (text) {
      case '🐦 Get Twitter Number':
        return await handleBuyNumber(chatId, userId);

      case '👤 My Account':
        return await handleMyAccount(chatId, userId);

      case '📜 Wallet History':
        return await handleWalletHistory(chatId, userId);

      case '💳 Add Balance':
        return await handleAddBalance(chatId, userId);

      case '🎁 Refer & Earn':
        return await handleReferral(chatId, userId);

      case '📞 Support':
        return await handleSupport(chatId, userId);

      default:
        // Gracefully handle unrecognized inputs without breaking the flow
        return await sendMessage(
          chatId, 
          MESSAGES.UNKNOWN_ERROR
        );
    }
  } catch (error) {
    console.error(`[COMMAND ERROR] Chat: ${chatId} | User: ${userId} | Input: ${text} | Error:`, error);

    // Ensure the user always receives a response and the permanent menu is restored
    try {
      await sendMessage(
        chatId, 
        MESSAGES.INTERNAL_ERROR
      );
    } catch (fallbackError) {
      console.error(`[FATAL ERROR] Chat: ${chatId} | User: ${userId} | Failed to send fallback error:`, fallbackError);
    }
  }
}
