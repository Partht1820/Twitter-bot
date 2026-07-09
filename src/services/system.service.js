import prisma from '../database.js';

/**
 * Retrieves the global system settings.
 * @returns {Promise<Object|null>} The system settings object.
 */
export async function getSystemSettings() {
  try {
    // Assuming a single configuration row exists; findFirst retrieves it.
    return await prisma.systemSettings.findFirst();
  } catch (error) {
    console.error(`[DB ERROR] getSystemSettings:`, error);
    throw error;
  }
}

/**
 * Updates the global system settings.
 * If no settings exist yet, it creates the initial configuration.
 * @param {Object} data - The settings fields to update.
 * @returns {Promise<Object>} The updated system settings object.
 */
export async function updateSystemSettings(data) {
  try {
    const settings = await prisma.systemSettings.findFirst();

    if (settings) {
      return await prisma.systemSettings.update({
        where: { id: settings.id },
        data
      });
    }

    // Fallback: Create initial settings if the table is empty
    return await prisma.systemSettings.create({
      data
    });
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
    let settings = await prisma.smsSettings.findFirst();

    if (!settings) {
      settings = await prisma.smsSettings.create({
        data: {
          countryId: "",
          operatorId: "",
          serviceId: "",
          maxPrice: 0,
          timeout: 300,
          interval: 10
        }
      });
    }

    return settings;
  } catch (error) {
    console.error(`[DB ERROR] getSmsSettings:`, error);
    throw error;
  }
}
