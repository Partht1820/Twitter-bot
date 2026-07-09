import { MESSAGES } from '../messages.js';
import { getMaintenanceMode, getAdminSmsSettings } from '../keyboards.js';
import { sendMessage, editMessage } from '../telegram.js';
import { getSystemSettings, updateSystemSettings, getSmsSettings } from '../services/system.service.js';
import { CONFIG } from '../config.js';

/**
 * Escapes text specifically for inside MarkdownV2 code blocks (`text`).
 * @param {string|number} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeForCodeBlock(text) {
  if (text === null || text === undefined) return 'None';
  return text.toString().replace(/([`\\])/g, '\\$1');
}

/**
 * Verifies if the user attempting the action is the configured admin.
 * @param {number} userId - The user ID to verify.
 * @returns {Promise<boolean>} - True if admin, false otherwise.
 */
async function isAdmin(userId) {
  const settings = await getSystemSettings();
  const adminId = settings?.adminChatId || CONFIG?.adminId;
  return String(userId) === String(adminId);
}

/**
 * Handles the toggling of System Maintenance Mode.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin pressing the button.
 * @param {number} messageId - The message ID containing the inline keyboard.
 */
export async function handleAdminMaintenance(chatId, adminId, messageId) {
  try {
    if (!(await isAdmin(adminId))) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized.");
    }

    const settings = await getSystemSettings();
    const newState = !settings?.isMaintenanceMode;

    // Update the database
    await updateSystemSettings({ isMaintenanceMode: newState });

    // Update the UI
    const statusText = newState ? '🟢 ON' : '🔴 OFF';
    const text = `⚙️ *System Settings*\n\n🛠️ *Maintenance Mode:* ${statusText}`;

    return await editMessage(chatId, messageId, text, getMaintenanceMode(newState));
  } catch (error) {
    console.error(`[ADMIN MAINTENANCE ERROR] Chat: ${chatId} | Admin: ${adminId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the display of the SMS Provider Settings menu.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin.
 * @param {number} messageId - The message ID to edit.
 */
export async function handleAdminSmsSettings(chatId, adminId, messageId) {
  try {
    if (!(await isAdmin(adminId))) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized.");
    }

    return await editMessage(
      chatId, 
      messageId, 
      MESSAGES.SMS_PROVIDER_SETTINGS, 
      getAdminSmsSettings()
    );
  } catch (error) {
    console.error(`[ADMIN SMS SETTINGS ERROR] Chat: ${chatId} | Admin: ${adminId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the display of the Current SMS Provider Configuration.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin.
 * @param {number} messageId - The message ID to edit.
 */
export async function handleAdminSmsCurrent(chatId, adminId, messageId) {
  try {
    if (!(await isAdmin(adminId))) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized.");
    }

    const smsSettings = await getSmsSettings();

    const currentConfigText = MESSAGES.CURRENT_CONFIGURATION
      .replace('{country}', escapeForCodeBlock(smsSettings?.countryId))
      .replace('{operator}', escapeForCodeBlock(smsSettings?.operatorId))
      .replace('{service}', escapeForCodeBlock(smsSettings?.serviceId))
      .replace('{amount}', escapeForCodeBlock(smsSettings?.maxPrice))
      .replace('{timeout}', escapeForCodeBlock(smsSettings?.timeout))
      .replace('{interval}', escapeForCodeBlock(smsSettings?.interval));

    // Display the current config but keep the settings keyboard visible for easy navigation
    return await editMessage(chatId, messageId, currentConfigText, getAdminSmsSettings());
  } catch (error) {
    console.error(`[ADMIN SMS CURRENT ERROR] Chat: ${chatId} | Admin: ${adminId}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handles the initiation of editing a specific SMS setting by prompting the admin.
 * @param {number} chatId - The admin's chat ID.
 * @param {number} adminId - The user ID of the admin.
 * @param {string} field - The specific setting field being edited (e.g., 'country', 'price').
 * @param {number} messageId - The message ID where the callback originated.
 */
export async function handleAdminSmsEdit(chatId, adminId, field, messageId) {
  try {
    if (!(await isAdmin(adminId))) {
      return await sendMessage(chatId, "⛔ *Access Denied:* You are not authorized.");
    }

    const fieldMap = {
      'country': 'Country ID',
      'operator': 'Operator ID',
      'service': 'Service ID',
      'price': 'Maximum Price',
      'timeout': 'OTP Timeout (sec)',
      'interval': 'Check Interval (sec)'
    };

    const fieldName = fieldMap[field];
    if (!fieldName) {
      return await sendMessage(chatId, MESSAGES.UNKNOWN_ERROR);
    }

    const promptText = `✏️ *Edit SMS Configuration*\n\nPlease reply to this message with the new value for *${fieldName}*\\.`;

    // Send a Force Reply message to collect the admin's input
    return await sendMessage(chatId, promptText, {
      force_reply: true,
      selective: true
    });
  } catch (error) {
    console.error(`[ADMIN SMS EDIT ERROR] Chat: ${chatId} | Admin: ${adminId} | Field: ${field}`, error);
    return await sendMessage(chatId, MESSAGES.INTERNAL_ERROR);
  }
}
