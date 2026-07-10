import { CONFIG } from './config.js';

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${CONFIG.telegram.token}`;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_RETRIES = 3;

/**
 * Custom Error class for Telegram API errors.
 */
export class TelegramApiError extends Error {
  constructor(method, httpStatus, errorCode, description) {
    super(`Telegram API Error (${method}): ${errorCode} - ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.description = description;
  }
}

/**
 * Generic Telegram API request handler with automatic retries and timeout.
 * @param {string} method - The Telegram API method to call.
 * @param {Object|FormData} payload - The payload to send.
 * @returns {Promise<any>} - The normalized result from Telegram.
 */
export async function apiRequest(method, payload = {}) {
  const url = `${TELEGRAM_API_BASE}/${method}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const isFormData = payload instanceof FormData;
      
      const options = {
        method: 'POST',
        headers: isFormData ? {} : { 'Content-Type': 'application/json' },
        body: isFormData ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      };

      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        const errorCode = data.error_code || response.status;
        const description = data.description || response.statusText || 'Unknown Telegram API Error';
        
        // Log the failed request
        console.error(`[TELEGRAM API ERROR] Method: ${method} | Retry Count: ${attempt}/${MAX_RETRIES} | HTTP Status: ${response.status} | Description: ${description}`);

        // Handle rate limiting specifically
        if (response.status === 429) {
          const retryAfter = data.parameters?.retry_after || 3;
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
        }
        
        throw new TelegramApiError(method, response.status, errorCode, description);
      }

      return data.result;
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.cause?.code === 'ECONNRESET') {
        console.error(`[TELEGRAM NETWORK ERROR] Method: ${method} | Retry Count: ${attempt}/${MAX_RETRIES} | Error: ${error.message}`);
        if (attempt < MAX_RETRIES) {
          // Exponential backoff for network or timeout issues
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
      
      // If we've exhausted retries or it's an unrecoverable error, throw it
      if (attempt === MAX_RETRIES) {
        throw error;
      }
    }
  }
}

/**
 * Sends a text message to a chat.
 * Intelligently handles the 3rd argument being either a keyboard or generic options.
 */
export async function sendMessage(chatId, text, optionsOrMarkup = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true
  };

  if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
    payload.reply_markup = optionsOrMarkup;
  } else {
    Object.assign(payload, optionsOrMarkup);
  }

  return apiRequest('sendMessage', payload);
}

/**
 * Edits an existing text message.
 * Intelligently handles the 4th argument being either a keyboard or generic options.
 */
export async function editMessage(chatId, messageId, text, optionsOrMarkup = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'MarkdownV2'
  };

  if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
    payload.reply_markup = optionsOrMarkup;
  } else {
    Object.assign(payload, optionsOrMarkup);
  }

  return apiRequest('editMessageText', payload);
}

export async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  return apiRequest('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup
  });
}

/**
 * Deletes a message from a chat.
 */
export async function deleteMessage(chatId, messageId) {
  return apiRequest('deleteMessage', {
    chat_id: chatId,
    message_id: messageId
  });
}

/**
 * Answers a callback query from an inline keyboard.
 */
export async function answerCallbackQuery(callbackQueryId, options = {}) {
  return apiRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...options
  });
}

/**
 * Sends a photo to a chat.
 */
export async function sendPhoto(chatId, photo, optionsOrMarkup = {}) {
  const payload = {
    chat_id: chatId,
    photo,
    parse_mode: 'MarkdownV2'
  };

  if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
    payload.reply_markup = optionsOrMarkup;
  } else {
    Object.assign(payload, optionsOrMarkup);
  }

  return apiRequest('sendPhoto', payload);
}

/**
 * Sends a document to a chat.
 */
export async function sendDocument(chatId, document, optionsOrMarkup = {}) {
  const payload = {
    chat_id: chatId,
    document,
    parse_mode: 'MarkdownV2'
  };

  if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
    payload.reply_markup = optionsOrMarkup;
  } else {
    Object.assign(payload, optionsOrMarkup);
  }

  return apiRequest('sendDocument', payload);
}

/**
 * Gets information about a member of a chat (used for forced join verification).
 */
export async function getChatMember(chatId, userId) {
  return apiRequest('getChatMember', {
    chat_id: chatId,
    user_id: userId
  });
}

/**
 * Sets the webhook URL for the bot.
 */
export async function setWebhook(url, secret) {
  return apiRequest('setWebhook', {
    url,
    secret_token: secret
  });
}

/**
 * Deletes the webhook setup for the bot.
 */
export async function deleteWebhook(options = {}) {
  return apiRequest('deleteWebhook', options);
}

/**
 * Gets the current webhook status.
 */
export async function getWebhookInfo() {
  return apiRequest('getWebhookInfo');
}
