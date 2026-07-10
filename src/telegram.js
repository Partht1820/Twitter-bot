import { CONFIG } from './config.js';

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${CONFIG.telegram.token}`;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_RETRIES = 3;

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
        
        console.error(`[TELEGRAM API ERROR] Method: ${method} | HTTP: ${response.status} | Desc: ${description}`);

        if (response.status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = data.parameters?.retry_after || 3;
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        throw new TelegramApiError(method, response.status, errorCode, description);
      }
      return data.result;
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

export async function sendMessage(chatId, text, optionsOrMarkup = {}) {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
      payload.reply_markup = optionsOrMarkup;
    } else {
      Object.assign(payload, optionsOrMarkup);
    }
    return await apiRequest('sendMessage', payload);
  } catch (error) {
    console.error(`[sendMessage Failed] Chat: ${chatId} | Error:`, error.message);
    return null;
  }
}

export async function editMessage(chatId, messageId, text, optionsOrMarkup = {}) {
  try {
    if (!messageId) return null;
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML'
    };

    if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
      payload.reply_markup = optionsOrMarkup;
    } else {
      Object.assign(payload, optionsOrMarkup);
    }
    return await apiRequest('editMessageText', payload);
  } catch (error) {
    console.error(`[editMessage Failed] Chat: ${chatId} | Msg: ${messageId} | Error:`, error.message);
    return null;
  }
}

export async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  try {
    if (!messageId) return null;
    return await apiRequest('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  } catch (error) {
    console.error(`[editMessageReplyMarkup Failed] Chat: ${chatId} | Msg: ${messageId} | Error:`, error.message);
    return null;
  }
}

export async function deleteMessage(chatId, messageId) {
  try {
    if (!messageId) return null;
    return await apiRequest('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    });
  } catch (error) {
    console.error(`[deleteMessage Failed] Chat: ${chatId} | Msg: ${messageId} | Error:`, error.message);
    return null;
  }
}

export async function answerCallbackQuery(callbackQueryId, options = {}) {
  try {
    return await apiRequest('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options
    });
  } catch (error) {
    console.warn(`[answerCallbackQuery Failed] ID: ${callbackQueryId} | Error:`, error.message);
    return null;
  }
}

export async function sendPhoto(chatId, photo, optionsOrMarkup = {}) {
  try {
    const payload = {
      chat_id: chatId,
      photo,
      parse_mode: 'HTML'
    };

    if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
      payload.reply_markup = optionsOrMarkup;
    } else {
      Object.assign(payload, optionsOrMarkup);
    }
    return await apiRequest('sendPhoto', payload);
  } catch (error) {
    console.error(`[sendPhoto Failed] Chat: ${chatId} | Error:`, error.message);
    return null;
  }
}

export async function sendDocument(chatId, document, optionsOrMarkup = {}) {
  try {
    const payload = {
      chat_id: chatId,
      document,
      parse_mode: 'HTML'
    };

    if (optionsOrMarkup.inline_keyboard || optionsOrMarkup.keyboard || optionsOrMarkup.force_reply || optionsOrMarkup.remove_keyboard) {
      payload.reply_markup = optionsOrMarkup;
    } else {
      Object.assign(payload, optionsOrMarkup);
    }
    return await apiRequest('sendDocument', payload);
  } catch (error) {
    console.error(`[sendDocument Failed] Chat: ${chatId} | Error:`, error.message);
    return null;
  }
}

export async function getChatMember(chatId, userId) {
  try {
    return await apiRequest('getChatMember', {
      chat_id: chatId,
      user_id: userId
    });
  } catch (error) {
    console.error(`[getChatMember Failed] Chat: ${chatId} | User: ${userId} | Error:`, error.message);
    throw error; // Let the caller handle force-join verification fails
  }
}

export async function setWebhook(url, secret) {
  return apiRequest('setWebhook', { url, secret_token: secret });
}

export async function deleteWebhook(options = {}) {
  return apiRequest('deleteWebhook', options);
}

export async function getWebhookInfo() {
  return apiRequest('getWebhookInfo');
}
