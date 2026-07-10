import { MESSAGES } from '../messages.js';
import { getCancelNumberKeyboard } from '../keyboards.js';
import { sendMessage, editMessage } from '../telegram.js';
import { getUser, isUserBanned, updateBalance } from '../services/user.service.js';
import { getSystemSettings, getSmsSettings } from '../services/system.service.js';
import { 
  createOrder, 
  getActiveOrder, 
  updateOrderOtpCount, 
  cancelOrder, 
  completeOrder 
} from '../services/order.service.js';
import { addWalletTransaction } from '../services/wallet.service.js';
import { purchaseNumber, getSmsStatus, cancelSmsNumber } from '../services/sms.service.js';

/**
 * Normalizes any SMS provider response into a standard format.
 * To be updated when the final provider API is implemented.
 * @param {Object} providerResponse - The raw response from the SMS provider.
 * @returns {Object} - Normalized status and OTP code.
 */
function normalizeSmsResponse(providerResponse) {
  if (!providerResponse) {
    return { hasOtp: false, otpCode: null };
  }
  
  // Generic parser logic to adapt multiple potential provider formats
  const isReceived = providerResponse.status === 'RECEIVED' || providerResponse.status === 'STATUS_OK';
  const code = providerResponse.code || providerResponse.text || providerResponse.otp || null;
  
  return {
    hasOtp: isReceived && !!code,
    otpCode: code
  };
}

/**
 * Background polling process for OTPs.
 * Runs independently of the webhook request.
 */
async function startOtpPolling(chatId, userId, orderId, activationId, phoneNumber, price, messageId, timeoutSec, intervalSec) {
  const endTime = Date.now() + (timeoutSec * 1000);
  const intervalMs = intervalSec * 1000;
  
  let otpsReceived = 0;
  let lastOtp = null;

  try {
    const user = await getUser(userId);
    if (!user) return;

    while (Date.now() < endTime) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));

      // 1. Verify order is still ACTIVE (hasn't been manually cancelled)
      const currentOrder = await getActiveOrder(user.id);
      if (!currentOrder || currentOrder.id !== orderId || currentOrder.status !== 'ACTIVE') {
        return; // Polling aborted externally
      }

      // 2. Fetch status from SMS Provider
      const rawSmsResponse = await getSmsStatus(activationId);
      
      // 3. Process new OTP using the generic parser
      const { hasOtp, otpCode } = normalizeSmsResponse(rawSmsResponse);
      
      if (hasOtp && otpCode && otpCode !== lastOtp) {
        lastOtp = otpCode;
        otpsReceived++;

        // Save OTP count to database
        await updateOrderOtpCount(orderId, otpsReceived);

        // 4. Send appropriate message based on OTP count
        if (otpsReceived === 1) {
          await sendMessage(chatId, MESSAGES.OTP_1_RECEIVED
            .replace('{phoneNumber}', phoneNumber)
            .replace('{otp}', lastOtp)
          );
        } else if (otpsReceived === 2) {
          await sendMessage(chatId, MESSAGES.OTP_2_RECEIVED
            .replace('{phoneNumber}', phoneNumber)
            .replace('{otp}', lastOtp)
          );
        } else if (otpsReceived >= 3) {
          await sendMessage(chatId, MESSAGES.OTP_3_RECEIVED
            .replace('{phoneNumber}', phoneNumber)
            .replace('{otp}', lastOtp)
          );
          
          // Complete order automatically after 3 OTPs
          await completeOrder(orderId);
          
          // Remove the cancel button from the original message
          return await editMessage(chatId, messageId, MESSAGES.NUMBER_PURCHASED_SUCCESSFULLY
            .replace('{phoneNumber}', phoneNumber)
            .replace('{amount}', price)
          );
        }
      }
    }

    // ==========================================
    // TIMEOUT HANDLING
    // ==========================================
    const finalOrderCheck = await getActiveOrder(user.id);
    if (!finalOrderCheck || finalOrderCheck.id !== orderId || finalOrderCheck.status !== 'ACTIVE') {
      return;
    }

    if (otpsReceived === 0) {
      // Timeout with 0 OTPs: Cancel at provider, refund user
      await cancelSmsNumber(activationId);
      await cancelOrder(orderId);
      await updateBalance(userId, price);
      await addWalletTransaction(userId, 'REFUND', price, `Timeout refund for ${phoneNumber}`);
      
      return await editMessage(chatId, messageId, MESSAGES.OTP_TIMEOUT_REFUND.replace('{amount}', price));
    } else {
      // Timeout with >= 1 OTPs: Complete order, no refund
      await completeOrder(orderId);
      return await editMessage(chatId, messageId, MESSAGES.OTP_TIMEOUT_NO_REFUND);
    }
  } catch (error) {
    console.error(`[OTP POLLING ERROR] Order: ${orderId} | User: ${userId}`, error);
  }
}

/**
 * Handles the "🐦 Get Twitter Number" purchase flow.
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 */
export async function handleBuyNumber(chatId, userId) {
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

    // 3. Fetch User and Prevent Multiple Active Orders
    const user = await getUser(userId);
    if (!user) {
      return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
    }

    const activeOrder = await getActiveOrder(user.id);
    if (activeOrder) {
      return await sendMessage(chatId, MESSAGES.PLEASE_WAIT);
    }

    // 4. Fetch SMS Settings & Check Wallet Balance
    const smsSettings = await getSmsSettings();
    
    if (user.balance < smsSettings.maxPrice) {
      return await sendMessage(chatId, MESSAGES.INSUFFICIENT_WALLET_BALANCE);
    }

    // 5. Send Loading Status
    const loadingMsg = await sendMessage(chatId, MESSAGES.PURCHASING_NUMBER);

    // 6. Buy Number from SMS Provider
    const purchaseResponse = await purchaseNumber(smsSettings);
    
    if (!purchaseResponse || !purchaseResponse.success) {
      return await editMessage(chatId, loadingMsg.message_id, MESSAGES.PURCHASE_FAILED);
    }

    const { activationId, phoneNumber } = purchaseResponse;
    
    // Current purchase price. In future this can be replaced with the actual provider price.
    const price = smsSettings.maxPrice;

    // 7. Deduct Balance & Update Wallet History
    await updateBalance(userId, -price);
    await addWalletTransaction(userId, 'NUMBER_PURCHASE', -price, `Purchased number: ${phoneNumber}`);

    // 8. Create Order in Database (Price is omitted per schema limits)
    const order = await createOrder({
      userId: user.id,
      activationId,
      phoneNumber,
      status: 'ACTIVE'
    });

    // 9. Send Success Message with Cancel Button
    const successText = MESSAGES.NUMBER_PURCHASED_SUCCESSFULLY
      .replace('{phoneNumber}', phoneNumber)
      .replace('{amount}', price);
      
    await editMessage(chatId, loadingMsg.message_id, successText, getCancelNumberKeyboard(activationId));

    // 10. Start Background OTP Polling
    startOtpPolling(
      chatId, 
      userId, 
      order.id, 
      activationId, 
      phoneNumber, 
      price, 
      loadingMsg.message_id, 
      smsSettings.timeout, 
      smsSettings.interval
    );

  } catch (error) {
    console.error(`[BUY NUMBER ERROR] Chat: ${chatId} | User: ${userId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the manual "🛑 Cancel Number" callback.
 * @param {number} chatId - The chat ID.
 * @param {number} userId - The user ID.
 * @param {string} activationId - The SMS provider's activation ID.
 * @param {number} messageId - The inline keyboard message ID.
 */
export async function handleCancelOrder(chatId, userId, activationId, messageId) {
  try {
    const user = await getUser(userId);
    if (!user) {
      return await editMessage(chatId, messageId, MESSAGES.UNKNOWN_ERROR);
    }

    // 1. Check if order is still active
    const activeOrder = await getActiveOrder(user.id);
    
    if (!activeOrder || activeOrder.activationId !== activationId || activeOrder.status !== 'ACTIVE') {
      return await editMessage(chatId, messageId, MESSAGES.UNKNOWN_ERROR);
    }

    // 2. Prevent cancellation if OTPs have already been received
    if (activeOrder.otpCount && activeOrder.otpCount > 0) {
      return await sendMessage(chatId, MESSAGES.PLEASE_WAIT);
    }

    // 3. Cancel at SMS Provider
    await cancelSmsNumber(activationId);

    // 4. Update Database
    await cancelOrder(activeOrder.id);

    // 5. Fetch current SMS price to refund the deduction
    const smsSettings = await getSmsSettings();
    const refundAmount = smsSettings.maxPrice;

    // 6. Refund User & Update Wallet History
    await updateBalance(userId, refundAmount);
    await addWalletTransaction(userId, 'REFUND', refundAmount, `Manual refund for ${activeOrder.phoneNumber}`);

    // 7. Update UI
    return await editMessage(chatId, messageId, MESSAGES.NUMBER_CANCELLED);

  } catch (error) {
    console.error(`[CANCEL ORDER ERROR] User: ${userId} | Activation: ${activationId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
