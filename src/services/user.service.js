import prisma from '../database.js';

/**
 * Creates a new user in the database.
 * Prevents duplicate creation by checking if the user already exists.
 * @param {Object} data - User data (telegramId, firstName, lastName, username).
 * @returns {Promise<Object>} The created or existing user.
 */
export async function createUser(data) {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: data.telegramId }
    });

    if (existingUser) {
      return existingUser;
    }

    return await prisma.user.create({
      data: {
        telegramId: data.telegramId,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        username: data.username || null
      }
    });
  } catch (error) {
    console.error(`[DB ERROR] createUser (Telegram ID: ${data.telegramId}):`, error);
    throw error;
  }
}

/**
 * Fetches a user by their Telegram ID.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @returns {Promise<Object|null>} The user object, or null if not found.
 */
export async function getUser(telegramId) {
  try {
    return await prisma.user.findUnique({
      where: { telegramId }
    });
  } catch (error) {
    console.error(`[DB ERROR] getUser (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}

/**
 * Updates specific fields for an existing user.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @param {Object} data - Fields to update.
 * @returns {Promise<Object>} The updated user.
 */
export async function updateUser(telegramId, data) {
  try {
    return await prisma.user.update({
      where: { telegramId },
      data
    });
  } catch (error) {
    console.error(`[DB ERROR] updateUser (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}

/**
 * Atomically increments or decrements the user's wallet balance.
 * Uses Prisma's atomic number operations to prevent race conditions.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @param {number} amount - The amount to add (positive) or deduct (negative).
 * @returns {Promise<number>} The updated balance.
 */
export async function updateBalance(telegramId, amount) {
  try {
    return await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { telegramId },
        data: {
          balance: {
            increment: amount
          }
        }
      });

      return updatedUser.balance;
    });
  } catch (error) {
    console.error(`[DB ERROR] updateBalance (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}

/**
 * Checks if a user is currently banned.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @returns {Promise<boolean>} True if banned, false otherwise.
 */
export async function isUserBanned(telegramId) {
  try {
    const banned = await prisma.bannedUser.findUnique({
      where: { telegramId }
    });

    return !!banned;
  } catch (error) {
    console.error(`[DB ERROR] isUserBanned (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}

/**
 * Bans a user by setting isBanned to true.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @returns {Promise<Object>} The updated user.
 */
export async function banUser(telegramId, reason = null) {
  try {
    return await prisma.bannedUser.upsert({
      where: { telegramId },
      update: { reason },
      create: {
        telegramId,
        reason
      }
    });
  } catch (error) {
    console.error(`[DB ERROR] banUser (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}
  

/**
 * Unbans a user by setting isBanned to false.
 * @param {number|bigint} telegramId - The Telegram User ID.
 * @returns {Promise<Object>} The updated user.
 */
export async function unbanUser(telegramId) {
  try {
    return await prisma.bannedUser.delete({
      where: { telegramId }
    }).catch(() => null);
  } catch (error) {
    console.error(`[DB ERROR] unbanUser (Telegram ID: ${telegramId}):`, error);
    throw error;
  }
}
  

/**
 * Retrieves a paginated list of all users.
 * @param {number} limit - The maximum number of users to return.
 * @param {number} skip - The number of users to skip.
 * @returns {Promise<Array<Object>>} Array of user objects.
 */
export async function getAllUsers(limit = 100, skip = 0) {
  try {
    return await prisma.user.findMany({
      take: limit,
      skip: skip,
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error(`[DB ERROR] getAllUsers:`, error);
    throw error;
  }
}

/**
 * Retrieves the total count of users in the database.
 * @returns {Promise<number>} The total user count.
 */
export async function getUserCount() {
  try {
    return await prisma.user.count();
  } catch (error) {
    console.error(`[DB ERROR] getUserCount:`, error);
    throw error;
  }
}
