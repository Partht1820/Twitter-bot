import prisma from '../database.js';

/**
 * Creates a new wallet transaction record for a user.
 * @param {number|bigint} userId - The Telegram User ID.
 * @param {string} type - The transaction type (e.g., 'DEPOSIT', 'NUMBER_PURCHASE', 'REFUND').
 * @param {number} amount - The transaction amount (positive for additions, negative for deductions).
 * @param {string} [description] - Optional description of the transaction.
 * @returns {Promise<Object>} The created transaction record.
 */
export async function addWalletTransaction(userId, type, amount, description = null) {
  try {
    return await prisma.walletTransaction.create({
      data: {
        userId: userId,
        type: type,
        amount: amount,
        description: description
      }
    });
  } catch (error) {
    console.error(`[DB ERROR] addWalletTransaction (User: ${userId}):`, error);
    throw error;
  }
}

/**
 * Retrieves the recent wallet transactions for a specific user.
 * @param {number|bigint} userId - The Telegram User ID.
 * @param {number} [limit=10] - The maximum number of transactions to return.
 * @returns {Promise<Array<Object>>} An array of transaction records, ordered by newest first.
 */
export async function getWalletTransactions(userId, limit = 10) {
  try {
    return await prisma.walletTransaction.findMany({
      where: { userId: userId },
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error(`[DB ERROR] getWalletTransactions (User: ${userId}):`, error);
    throw error;
  }
}
