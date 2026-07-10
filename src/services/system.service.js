import prisma from '../database.js';

const SYSTEM_SETTINGS_KEY = 'SYSTEM_SETTINGS';
const SMS_SETTINGS_KEY = 'SMS_SETTINGS';

/**
 * Retrieves the global system settings.
 * @returns {Promise<Object|null>} The system settings object.
 */
export async function getSystemSettings() {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: SYSTEM_SETTINGS_KEY }
    });
    
    return setting ? JSON.parse(setting.value) : null;
  } catch (error) {
    console.error(`[DB ERROR] getSystemSettings:`, error);
    throw error;
  }
}

/**
 * Updates the global system settings.
 * If no settings exist yet, it creates the initial configuration.
 * Merges new data with existing data.
 * @param {Object} data - The settings fields to update.
 * @returns {Promise<Object>} The updated system settings object.
 */
export async function updateSystemSettings(data) {
  try {
    const existingSetting = await prisma.setting.findUnique({
      where: { key: SYSTEM_SETTINGS_KEY }
    });

    const currentSettings = existingSetting ? JSON.parse(existingSetting.value) : {};
    const updatedSettings = { ...currentSettings, ...data };

    const setting = await prisma.setting.upsert({
      where: { key: SYSTEM_SETTINGS_KEY },
      update: {
        value: JSON.stringify(updatedSettings)
      },
      create: {
        key: SYSTEM_SETTINGS_KEY,
        value: JSON.stringify(updatedSettings)
      }
    });

    return JSON.parse(setting.value);
  } catch (error) {
    console.error(`[DB ERROR] updateSystemSettings:`, error);
    throw error;
  }
}

/**
 * Retrieves the SMS provider configuration settings.
 * Includes countryId, operatorId, serviceId, maxPrice, timeout, and interval.
 * Automatically creates and returns default settings if none exist.
 * @returns {Promise<Object>} The SMS settings object.
 */
export async function getSmsSettings() {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: SMS_SETTINGS_KEY }
    });

    if (!setting) {
      const defaultSettings = {
        countryId: "",
        operatorId: "",
        serviceId: "",
        maxPrice: 0,
        timeout: 300,
        interval: 10
      };

      const newSetting = await prisma.setting.create({
        data: {
          key: SMS_SETTINGS_KEY,
          value: JSON.stringify(defaultSettings)
        }
      });

      return JSON.parse(newSetting.value);
    }

    return JSON.parse(setting.value);
  } catch (error) {
    console.error(`[DB ERROR] getSmsSettings:`, error);
    throw error;
  }
}
