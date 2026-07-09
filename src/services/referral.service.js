import prisma from '../database.js';

/**
 * Processes a new user referral.
 * @param {number|bigint} newUserId - The Telegram User ID of the newly joined user.
 * @param {string} payload - The referral payload, typically the referrer's user ID.
 * @returns {Promise<boolean>} True if the referral was successfully processed, false otherwise.
 */
export async function processReferral(newUserId, payload) {
  try {
    const referrerId = Number(payload);

    // 1. Validate referral payload
    if (isNaN(referrerId) || referrerId <= 0) {
      return false;
    }

    // 2. Prevent self-referral
    if (referrerId === Number(newUserId)) {
      return false;
    }

    // 3. Execute inside a Prisma transaction for atomicity
    return await prisma.$transaction(async (tx) => {
      // 4. Verify referrer exists in the database
      const referrer = await tx.user.findUnique({
        where: { telegramId: referrerId }
      });

      if (!referrer) {
        return false;
      }

      // 5. Prevent duplicate referrals (ensure new user hasn't been referred before)
      const existingReferral = await tx.referral.findFirst({
        where: { referredId: newUserId }
      });

      if (existingReferral) {
        return false;
      }

      // Fetch the referral bonus amount from System Settings
      const settings = await tx.systemSettings.findFirst();
      const bonusAmount = settings?.referralBonus || 0;

      // 6. Create the referral record
      await tx.referral.create({
        data: {
          referrerId: referrerId,
          referredId: newUserId
        }
      });

      // 7. Update referrer's stats and wallet balance
      await tx.user.update({
        where: { telegramId: referrerId },
        data: {
          totalReferrals: { increment: 1 },
          referralEarnings: { increment: bonusAmount },
          balance: { increment: bonusAmount }
        }
      });

      // 8. Create a wallet transaction record if a bonus was awarded
      if (bonusAmount > 0) {
        await tx.walletTransaction.create({
          data: {
            userId: referrerId,
            type: 'REFERRAL_BONUS',
            amount: bonusAmount,
            description: `Referral bonus for inviting user ${newUserId}`
          }
        });
      }

      return true;
    });
  } catch (error) {
    console.error(`[DB ERROR] processReferral (New User: ${newUserId}, Payload: ${payload}):`, error);
    throw error;
  }
}
