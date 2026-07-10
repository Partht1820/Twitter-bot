import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { CONFIG } from './config.js';
import { connectDatabase } from './database.js';
import { setWebhook, answerCallbackQuery, sendMessage } from './telegram.js';

// Import Controllers
import { handleStart, handleVerifyJoin } from './controllers/onboarding.controller.js';
import { handleBuyNumber, handleCancelOrder } from './controllers/order.controller.js';
import { handleMyAccount } from './controllers/account.controller.js';
import { handleAddBalance, handleWalletHistory, handlePaymentScreenshot } from './controllers/wallet.controller.js';
import { handleReferral } from './controllers/referral.controller.js';
import { handleSupport } from './controllers/support.controller.js';
import { handleApprovePayment, handleRejectPayment, handlePaymentAmountReply } from './controllers/payment.controller.js';
import { handleAdminMaintenance, handleAdminSmsSettings, handleAdminSmsCurrent, handleAdminSmsEdit } from './controllers/admin.controller.js';

const server = Fastify({
  logger: true,
  trustProxy: true
});

// In-memory store for mapping admin replies to original payment contexts
const pendingPaymentApprovals = new Map();

// Register Plugins
server.register(formbody);

// Global Error Handler
server.setErrorHandler((error, request, reply) => {
  server.log.error(error);
  reply.status(error.statusCode || 500).send({
    success: false,
    message: error.message || 'Internal Server Error'
  });
});

// Not Found Handler
server.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    success: false,
    message: 'Route not found.'
  });
});

// Root Endpoint
server.get('/', async (request, reply) => {
  return {
    success: true,
    message: 'Telegram OTP Bot is running.'
  };
});

// Health Check Endpoint
server.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    uptime: process.uptime()
  };
});

// Telegram Webhook Endpoint
server.post('/webhook', async (request, reply) => {
  // 1. Verify Telegram Secret Token
  const secretToken = request.headers['x-telegram-bot-api-secret-token'];
  if (secretToken !== CONFIG.webhook.secret) {
    server.log.warn('[WEBHOOK] Unauthorized request attempt');
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // 2. Acknowledge Receipt Immediately to Prevent Telegram Retries
  reply.status(200).send({ ok: true });

  const update = request.body;

  try {
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const telegramUser = message.from;
      const userId = telegramUser.id;

      // Handle Text Messages
      if (message.text) {
        const text = message.text;

        // Detect ForceReply for Payment Approval
        if (message.reply_to_message && message.reply_to_message.text && message.reply_to_message.text.includes('Enter deposit amount for this payment')) {
          const pendingApproval = pendingPaymentApprovals.get(userId);
          
          if (pendingApproval) {
            const { paymentId, paymentUserId } = pendingApproval;
            await handlePaymentAmountReply(chatId, userId, text, paymentId, paymentUserId);
            
            // Cleanup context after processing
            pendingPaymentApprovals.delete(userId);
          } else {
            await sendMessage(chatId, '❌ Context lost or payment already processed. Please approve the payment again from the original message.');
          }
        }
        // Normal Commands
        else if (text.startsWith('/start')) {
          await handleStart(chatId, telegramUser);
        } else if (text === '🐦 Get Twitter Number') {
          await handleBuyNumber(chatId, userId);
        } else if (text === '👤 My Account') {
          await handleMyAccount(chatId, userId);
        } else if (text === '💳 Add Balance') {
          await handleAddBalance(chatId, userId);
        } else if (text === '📜 Wallet History') {
          await handleWalletHistory(chatId, userId);
        } else if (text === '🎁 Refer & Earn') {
          await handleReferral(chatId, userId);
        } else if (text === '📞 Support') {
          await handleSupport(chatId, userId);
        } else {
          await sendMessage(chatId, '❌ Unknown command.');
        }
      } 
      // Handle Payment Screenshots
      else if (message.photo && message.photo.length > 0) {
        // Retrieve the highest resolution photo (last in the array)
        const highestResPhoto = message.photo[message.photo.length - 1];
        await handlePaymentScreenshot(chatId, userId, highestResPhoto.file_id);
      }
    } 
    
    // Handle Inline Keyboard Callbacks
    else if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data;
      const message = callbackQuery.message;
      const chatId = message.chat.id;
      const userId = callbackQuery.from.id; // Represents the user or admin clicking the button
      const messageId = message.message_id;

      // Immediately answer the callback query to remove the loading state on the user's client
      await answerCallbackQuery(callbackQuery.id).catch(err => server.log.error('[WEBHOOK] Failed to answer callback query', err));

      if (data === 'verify_join') {
        await handleVerifyJoin(chatId, userId, messageId);
      } else if (data.startsWith('cancel_order_')) {
        const activationId = data.replace('cancel_order_', '');
        await handleCancelOrder(chatId, userId, activationId, messageId);
      } else if (data.startsWith('approve_payment_')) {
        const match = data.match(/^approve_payment_(.+)_(\d+)$/);
        if (match) {
          const paymentId = match[1];
          const paymentUserId = match[2];
          
          // Store payment context for the admin's impending ForceReply
          pendingPaymentApprovals.set(userId, { paymentId, paymentUserId });
          
          try {
            await handleApprovePayment(chatId, userId, paymentId, paymentUserId, messageId);
          } catch (error) {
            // Remove pending context if the controller throws an error
            pendingPaymentApprovals.delete(userId);
            throw error;
          }
        }
      } else if (data.startsWith('reject_payment_')) {
        const match = data.match(/^reject_payment_(.+)_(\d+)$/);
        if (match) {
          const paymentId = match[1];
          const paymentUserId = match[2];
          
          // Cleanup any lingering context if admin rejects instead
          pendingPaymentApprovals.delete(userId);
          
          await handleRejectPayment(chatId, userId, paymentId, paymentUserId, messageId);
        }
      } else if (data === 'admin_maintenance') {
        await handleAdminMaintenance(chatId, userId, messageId);
      } else if (data === 'admin_sms_settings') {
        await handleAdminSmsSettings(chatId, userId, messageId);
      } else if (data === 'admin_sms_current') {
        await handleAdminSmsCurrent(chatId, userId, messageId);
      } else if (data.startsWith('admin_sms_edit_')) {
        const field = data.replace('admin_sms_edit_', '');
        await handleAdminSmsEdit(chatId, userId, field, messageId);
      }
    }
  } catch (error) {
    server.log.error(error, '[WEBHOOK] Error processing update');
  }
});

/**
 * Initializes and starts the Fastify server.
 */
const start = async () => {
  try {
    // 1. Ensure database connection is established
    await connectDatabase();

    // 2. Start Fastify Server
    await server.listen({
      port: CONFIG.server.port,
      host: CONFIG.server.host
    });
    server.log.info(`[SERVER] 🚀 Server started successfully on http://${CONFIG.server.host}:${CONFIG.server.port}`);

    // 3. Set Telegram Webhook
    if (CONFIG.webhook.url && CONFIG.webhook.secret) {
      await setWebhook(CONFIG.webhook.url, CONFIG.webhook.secret);
      server.log.info(`[TELEGRAM] ✅ Webhook successfully set to ${CONFIG.webhook.url}`);
    } else {
      server.log.warn(`[TELEGRAM] ⚠️ Webhook URL or Secret missing from configuration.`);
    }

  } catch (error) {
    server.log.error(error, '[SERVER] ❌ Failed to start the server');
    process.exit(1);
  }
};

// Graceful Shutdown Handler for the HTTP server
const closeGracefully = async (signal) => {
  server.log.info(`\n[SERVER] Received ${signal}. Shutting down HTTP server gracefully...`);
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

start();

export default server;
