import { answerCallbackQuery, sendMessage } from './telegram.js';
import { MESSAGES } from './messages.js';

// Import controllers (Delegating business logic as per architecture)
import { handleVerifyJoin } from './controllers/onboarding.controller.js';
import { handleCancelOrder } from './controllers/order.controller.js';
import { handleApprovePayment, handleRejectPayment } from './controllers/payment.controller.js';
import { handleToggleBan } from './controllers/user.controller.js';
import { 
  handleAdminMaintenance, 
  handleAdminSmsSettings, 
  handleAdminSmsCurrent, 
  handleAdminSmsEdit 
} from './controllers/admin.controller.js';

/**
 * Centralized Callback Query Handler
 * Routes inline keyboard button presses to appropriate controllers.
 * * @param {Object} callbackQuery - The Telegram callback query object.
 */
export async function callbackQueryHandler(callbackQuery) {
  if (!callbackQuery || !callbackQuery.data || !callbackQuery.message || !callbackQuery.from) {
    return;
  }

  const { id, data, message, from } = callbackQuery;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const userId = from.id;

  // Acknowledge the callback query immediately to stop the loading spinner
  try {
    await answerCallbackQuery(id);
  } catch (ackError) {
    console.error(`[CALLBACK ACK ERROR] Query ID: ${id} | Error:`, ackError);
  }

  try {
    // Parse the callback data for parameterized actions (e.g., action:param1:param2)
    const [action, ...args] = data.split(':');

    switch (action) {
      case 'verify_join':
        await handleVerifyJoin(chatId, userId, messageId);
        break;

      case 'cancel_order':
        // args[0] = activationId
        await handleCancelOrder(chatId, userId, args[0], messageId);
        break;

      case 'approve_payment':
        // args[0] = paymentId, args[1] = paymentUserId
        await handleApprovePayment(chatId, userId, args[0], args[1], messageId);
        break;

      case 'reject_payment':
        // args[0] = paymentId, args[1] = paymentUserId
        await handleRejectPayment(chatId, userId, args[0], args[1], messageId);
        break;

      case 'admin_maintenance':
        await handleAdminMaintenance(chatId, userId, messageId);
        break;

      case 'admin_sms_settings':
        await handleAdminSmsSettings(chatId, userId, messageId);
        break;

      case 'admin_sms_current':
        await handleAdminSmsCurrent(chatId, userId, messageId);
        break;

      case 'admin_sms_edit':
        // args[0] = 'country' | 'operator' | 'service' | 'price' | 'timeout' | 'interval'
        await handleAdminSmsEdit(chatId, userId, args[0], messageId);
        break;

      case 'toggle_ban':
        // args[0] = targetUserId
        await handleToggleBan(chatId, userId, args[0], messageId);
        break;

      default:
        console.warn(`[CALLBACK UNKNOWN] User: ${userId} | Data: ${data}`);
        await sendMessage(chatId, MESSAGES.UNKNOWN_ERROR);
        break;
    }
  } catch (error) {
    console.error(`[CALLBACK ERROR] Chat: ${chatId} | User: ${userId} | Data: ${data} | Error:`, error);

    try {
      await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    } catch (fallbackError) {
      console.error(`[FATAL ERROR] Chat: ${chatId} | User: ${userId} | Failed to send fallback error:`, fallbackError);
    }
  }
}
