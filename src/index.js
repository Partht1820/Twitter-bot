import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { PrismaClient } from '@prisma/client';
import { CONFIG } from './config.js';
import * as tg from './telegram.js';

// ==========================================
// 1. GLOBAL INITIALIZATION & CONFIGURATION
// ==========================================

// Fix BigInt serialization crash for Fastify/JSON responses
BigInt.prototype.toJSON = function () { return this.toString(); };

const prisma = globalThis.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

const server = Fastify({ logger: true, trustProxy: true });
server.register(formbody);

// In-memory store for pending referrals awaiting Force Join verification
const pendingReferrals = new Map();

// ==========================================
// 2. CONSTANTS: MESSAGES & KEYBOARDS
// ==========================================

const MSG = {
  WELCOME: "👋 <b>Welcome to our Premium OTP Service!</b>\n\nPlease use the menu below to navigate.",
  PLEASE_WAIT: "✋ Please wait a moment before trying again.",
  MAINTENANCE_MODE: "🛠️ <b>Maintenance Mode</b>\n\nOur service is currently undergoing scheduled maintenance.",
  INTERNAL_ERROR: "❌ <b>System Error</b>\n\nAn unexpected error occurred.",
  UNKNOWN_ERROR: "❓ <b>Unknown Error</b>\n\nSomething went wrong. Please try again later.",
  FORCE_JOIN: "🚫 <b>Access Required</b>\n\nTo continue using this bot, please join our official Channel and Group.\n\nAfter joining both, tap the button below to verify your membership.",
  VERIFIED_SUCCESS: "✅ <b>Verification Successful</b>\n\nWelcome aboard! You now have full access to the bot.",
  VERIFIED_FAILED: "❌ <b>Verification Failed</b>\n\nWe couldn't verify your membership.",
  PURCHASING: "🔄 <b>Purchasing Number...</b>\n\nPlease wait while we reserve a number for you.",
  NUMBER_SUCCESS: "✅ <b>Number Activated</b>\n\n🇺🇸 United States • 🐦 Twitter\n\n📞 <code>+{phoneNumber}</code>\n\n💳 ₹{amount}\n\n💡 <b>Refund Policy</b>\n• 0 OTP → Full Refund\n• 1+ OTP → No Refund",
  NUMBER_FAILED: "❌ <b>Purchase Failed</b>\n\nWe couldn't acquire a number at this time. Please try again later.",
  NO_BALANCE: "⚠️ <b>Insufficient Balance</b>\n\nPlease add funds to your wallet to purchase this number.",
  OTP_RECEIVED: "📩 <b>OTP #{count} Received</b>\n\n🔑 <b>OTP:</b>\n<code>{otp}</code>",
  OTP_TIMEOUT_REFUND: "⌛ <b>Number expired.</b>\n\n💰 Full refund has been credited to your wallet.",
  OTP_TIMEOUT_NO_REFUND: "⌛ <b>Number expired.</b>\n\n⚠️ At least one OTP was received.\n\n💰 No refund has been issued.",
  ORDER_CANCELLED_REFUND: "❌ <b>Number Cancelled Successfully</b>\n\n💰 Full refund has been credited to your wallet.",
  ORDER_CANCELLED_NO_REFUND: "❌ <b>Number Cancelled Successfully</b>\n\n⚠️ At least one OTP was already received.\n\n💰 No refund has been issued.",
  PAYMENT_INSTRUCT: "━━━━━━━━━━━━━━━━━━━━\n💳 UPI ID:\n<code>{upi}</code>\n\n📷 After completing the payment, send the payment screenshot.\n\n📝 In the photo caption, write ONLY the payment amount.\n\nExample:\n100\n\n❌ Don't write:\nAmount: 100\nPaid 100\n100 INR\nPayment done\n\n✅ Write only:\n100\n━━━━━━━━━━━━━━━━━━━━",
  PAYMENT_CAPTION_ERROR: "❌ Please send the payment screenshot with only the amount in the caption. Example: 100",
  PAYMENT_SUBMITTED: "📤 <b>Payment Submitted</b>\n\nYour screenshot has been sent to the admin for review. Please wait for approval.",
  PAYMENT_APPROVED: "✅ <b>Payment Approved</b>\n\n<code>₹{amount}</code> has been successfully added to your wallet.",
  PAYMENT_REJECTED: "❌ <b>Payment Rejected</b>\n\nYour recent payment submission was declined. Contact support if you need help.",
  WALLET_EMPTY: "📜 <b>Wallet History</b>\n\nYou have no recent transactions.",
  MY_ACCOUNT: "👤 <b>My Account</b>\n\n🆔 <b>User ID:</b> <code>{userId}</code>\n🗣 <b>Name:</b> {firstName} {username}\n💰 <b>Balance:</b> <code>₹{balance}</code>\n👥 <b>Referrals:</b> <code>{referrals}</code>\n📅 <b>Joined:</b> <code>{date}</code>",
  REFER_INFO: "🎁 <b>Refer & Earn</b>\n\nInvite your friends and earn <code>₹{amount}</code> for every successful signup!\n\n🔗 <b>Your Referral Link:</b>\n{referralLink}",
  SUPPORT: "📞 <b>Support</b>\n\nIf you need assistance, please contact our support team below.",
  BANNED: "⛔ <b>User Banned</b>\n\nYou have been restricted from using the bot."
};

const BTN = { inline: (t, c) => ({text: t, callback_data: c}), url: (t, u) => ({text: t, url: u}) };
const KB = {
  main: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}]], resize_keyboard: true, is_persistent: true },
  adminMain: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}], [{text: "📊 Statistics"}, {text: "👥 Users"}, {text: "💳 Payments"}], [{text: "🛒 Orders"}, {text: "📢 Broadcast"}, {text: "⚙️ Settings"}]], resize_keyboard: true, is_persistent: true },
  forceJoin: (c, g) => ({ inline_keyboard: [[BTN.url("📢 Join Channel", `https://t.me/${c.replace("@","")}`)], [BTN.url("👥 Join Group", `https://t.me/${g.replace("@","")}`)], [BTN.inline("✅ I've Joined", "verify_join")]] }),
  cancel: (id) => ({ inline_keyboard: [[BTN.inline("❌ Cancel Number", `cancel_order:${id}`)]] }),
  approveReject: (pId, uId) => ({ inline_keyboard: [[BTN.inline("✅ Approve", `approve_payment:${pId}:${uId}`), BTN.inline("❌ Reject", `reject_payment:${pId}:${uId}`)]] }),
  support: (u) => ({ inline_keyboard: [[BTN.url("💬 Contact Support", `https://t.me/${u.replace("@","")}`)]] }),
  adminSettings: () => ({ inline_keyboard: [[BTN.inline("🛠️ Maintenance Mode", "admin_maintenance"), BTN.inline("📡 SMS Settings", "admin_sms_settings")]] }),
  maintenance: (isOn) => ({ inline_keyboard: [[BTN.inline(isOn ? "✅ Turn OFF" : "⛔ Turn ON", "toggle_maintenance")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  smsSettings: () => ({ inline_keyboard: [[BTN.inline("🌍 Country", "admin_sms_edit:countryId"), BTN.inline("📡 Operator", "admin_sms_edit:operatorId")], [BTN.inline("🐦 Service", "admin_sms_edit:serviceId"), BTN.inline("💰 Max Price", "admin_sms_edit:maxPrice")], [BTN.inline("⏱ Timeout", "admin_sms_edit:timeout"), BTN.inline("🔄 Interval", "admin_sms_edit:interval")], [BTN.inline("📄 Current Config", "admin_sms_current")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  manageUser: (uId, isBan) => ({ inline_keyboard: [[BTN.inline("➕ Add Balance", `admin_add_bal:${uId}`), BTN.inline("➖ Deduct Balance", `admin_ded_bal:${uId}`)], [BTN.inline(isBan ? "✅ Unban User" : "⛔ Ban User", `toggle_ban:${uId}`)]] })
};

// Safe HTML entity escaping ONLY
function esc(text) { 
  if (text == null) return 'None';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==========================================
// 3. DATABASE HELPER FUNCTIONS
// ==========================================

async function getSysSettings() {
  const s = await prisma.setting.findUnique({ where: { key: 'SYSTEM_SETTINGS' } });
  return s ? JSON.parse(s.value) : {};
}

async function getSmsSettings() {
  const s = await prisma.setting.findUnique({ where: { key: 'SMS_SETTINGS' } });
  if (s) return JSON.parse(s.value);
  const def = { countryId: "1", operatorId: "any", serviceId: "tw", maxPrice: 15, timeout: 300, interval: 10 };
  const n = await prisma.setting.create({ data: { key: 'SMS_SETTINGS', value: JSON.stringify(def) } });
  return JSON.parse(n.value);
}

async function getUser(tgId) {
  let user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
  if (!user) user = await prisma.user.create({ data: { telegramId: BigInt(tgId) } });
  return user;
}

async function isAdmin(tgId) {
  const s = await getSysSettings();
  return String(tgId) === String(s?.adminChatId || CONFIG?.telegram?.adminId);
}

async function isBanned(tgId) {
  const b = await prisma.bannedUser.findUnique({ where: { telegramId: BigInt(tgId) } });
  return b !== null;
}

async function checkForceJoin(userId) {
  if (await isAdmin(userId)) return true;
  const sys = await getSysSettings();
  
  if (sys?.forceJoinEnabled === false) return true;

  const channel = sys?.forceJoinChannel || CONFIG.telegram.forceJoinChannel;
  const group = sys?.forceJoinGroup || CONFIG.telegram.forceJoinGroup;

  if (!channel || !group) return true;

  try {
    const c = await tg.getChatMember(channel, userId);
    const g = await tg.getChatMember(group, userId);
    const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
    return validStatuses.includes(c?.status) && validStatuses.includes(g?.status);
  } catch (e) {
    return false;
  }
}

async function verifyAccess(chatId, userId) {
  if (await isBanned(userId)) { await tg.sendMessage(chatId, MSG.BANNED); return false; }
  const sys = await getSysSettings();
  if (sys?.isMaintenanceMode && !(await isAdmin(userId))) { await tg.sendMessage(chatId, MSG.MAINTENANCE_MODE); return false; }
  
  const isJoined = await checkForceJoin(userId);
  if (!isJoined) {
    const channel = sys?.forceJoinChannel || CONFIG.telegram.forceJoinChannel;
    const group = sys?.forceJoinGroup || CONFIG.telegram.forceJoinGroup;
    await tg.sendMessage(chatId, MSG.FORCE_JOIN, KB.forceJoin(channel, group));
    return false;
  }
  return true;
}

async function processReferral(newUserId, referrerPayload) {
  if (!/^\d+$/.test(referrerPayload)) return false;
  const referrerId = BigInt(referrerPayload);
  const newTgId = BigInt(newUserId);
  if (referrerId === newTgId) return false;

  return await prisma.$transaction(async (tx) => {
    const referrer = await tx.user.findUnique({ where: { telegramId: referrerId } });
    const newUser = await tx.user.findUnique({ where: { telegramId: newTgId } });
    if (!referrer || !newUser) return false;

    const existing = await tx.referral.findUnique({ where: { referredId: newUser.id } });
    if (existing) return false;

    const setObj = await tx.setting.findUnique({ where: { key: 'SYSTEM_SETTINGS' } });
    const sys = setObj ? JSON.parse(setObj.value) : {};
    const bonus = sys.referralBonus || 0;

    await tx.referral.create({ data: { referrerId: referrer.id, referredId: newUser.id, bonus } });
    
    await tx.user.update({
      where: { id: referrer.id },
      data: { totalReferrals: { increment: 1 }, referralEarnings: { increment: bonus }, balance: { increment: bonus } }
    });

    if (bonus > 0) {
      await tx.walletHistory.create({
        data: { userId: referrer.id, type: 'REFERRAL_BONUS', amount: bonus, description: `Referral bonus for ${newUserId}` }
      });
    }
    return true;
  });
}

// ==========================================
// 4. EXTERNAL SMS PROVIDER API HELPERS
// ==========================================

function buildSmsUrl(params = {}) {
  const url = new URL(CONFIG.sms.baseUrl || 'https://api.temporasms.com/stubs/handler_api.php');
  url.searchParams.append('api_key', CONFIG.sms.apiKey);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });
  return url.toString();
}

async function purchaseSms(settings) {
  try {
    const params = { action: 'getNumber', service: settings.serviceId, country: settings.countryId };
    if (settings.operatorId) params.operator = settings.operatorId;
    if (String(settings.operatorId) === '9' && settings.maxPrice) params.maxPrice = settings.maxPrice;
    
    const res = await fetch(buildSmsUrl(params));
    const txt = (await res.text()).trim();
    if (txt.startsWith('ACCESS_NUMBER')) {
      const [, activationId, phoneNumber] = txt.split(':');
      return { success: true, activationId, phoneNumber };
    }
    return { success: false, error: txt };
  } catch (err) { return { success: false }; }
}

async function getSmsStatus(activationId) {
  try {
    const res = await fetch(buildSmsUrl({ action: 'getStatus', id: activationId }));
    const txt = (await res.text()).trim();
    if (txt.startsWith('STATUS_OK')) return { status: 'RECEIVED', code: txt.split(':')[1] };
    return { status: txt };
  } catch (err) { return { status: 'ERROR' }; }
}

async function cancelSms(activationId) {
  try {
    const res = await fetch(buildSmsUrl({ action: 'setStatus', status: 8, id: activationId }));
    return (await res.text()).trim().startsWith('ACCESS_CANCEL');
  } catch (err) { return false; }
}

// ==========================================
// 5. CORE BUSINESS LOGIC
// ==========================================

async function startOtpPolling(chatId, userDbId, orderId, activationId, phone, price, msgId, interval) {
  // IMPLEMENTATION: Auto-expiry set to exactly 15 minutes
  const timeoutInMinutes = 15;
  const endTime = Date.now() + (timeoutInMinutes * 60 * 1000);
  let otpsReceived = 0;
  let lastOtp = null;

  try {
    while (Date.now() < endTime) {
      await new Promise(r => setTimeout(r, interval * 1000));
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'ACTIVE') return;

      const stat = await getSmsStatus(activationId);
      const code = stat.code || stat.otpCode || stat.text;
      
      if (stat.status === 'RECEIVED' && code && code !== lastOtp) {
        lastOtp = code;
        otpsReceived++;
        await prisma.order.update({ where: { id: orderId }, data: { otpCount: otpsReceived } });

        await tg.sendMessage(chatId, MSG.OTP_RECEIVED.replace('{count}', otpsReceived).replace('{otp}', esc(lastOtp)));

        if (otpsReceived >= 3) {
          await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
          return;
        }
      }
    }

    // Auto-expiry Logic: Triggered here if loop exits due to time
    const fOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!fOrder || fOrder.status !== 'ACTIVE') return;

    if (otpsReceived === 0) {
      await cancelSms(activationId);
      
      await prisma.$transaction([
        prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } }),
        prisma.user.update({ where: { id: userDbId }, data: { balance: { increment: price } } }),
        prisma.walletHistory.create({ data: { userId: userDbId, type: 'REFUND', amount: price, description: `Timeout refund: ${phone}` } })
      ]);

      await tg.editMessage(chatId, msgId, MSG.OTP_TIMEOUT_REFUND.replace('{amount}', price), { inline_keyboard: [] });
    } else {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      await tg.editMessage(chatId, msgId, MSG.OTP_TIMEOUT_NO_REFUND, { inline_keyboard: [] });
    }
  } catch (error) { console.error(`[POLLING ERR] Order: ${orderId}`, error); }
}

// ==========================================
// 6. WEBHOOK ROUTES & HANDLERS
// ==========================================

async function handleUpdate(update) {
  // --- MESSAGE ROUTER ---
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    const userId = msg.from?.id;
    if (!chatId || !userId) return;

    const admin = await isAdmin(userId);

    // Handle Photos (Payment Screenshots)
    if (msg.photo?.length > 0) {
      if (!(await verifyAccess(chatId, userId))) return;

      const amountStr = msg.caption ? msg.caption.trim() : '';
      const amount = Number(amountStr);

      if (!amountStr || isNaN(amount) || amount <= 0) {
        server.log.error(`[PAYMENT ERROR] Missing or invalid amount in photo caption for user ${userId}`);
        await tg.sendMessage(chatId, MSG.PAYMENT_CAPTION_ERROR);
        return;
      }

      const u = await getUser(userId);
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      
      const p = await prisma.payment.create({ 
        data: { 
          userId: u.id, 
          photoFileId: photoId, 
          amount: amount,
          status: 'PENDING' 
        } 
      });
      
      const sys = await getSysSettings();
      const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
      if (aId) {
        const caption = `💳 <b>New Payment Request</b>\n\n🆔 <b>User ID:</b> <code>${userId}</code>\n🧾 <b>Payment ID:</b> <code>${p.id}</code>\n💰 <b>Amount:</b> <code>₹${amount}</code>`;
        await tg.sendPhoto(aId, photoId, { caption, reply_markup: KB.approveReject(p.id, userId) });
      }
      return await tg.sendMessage(chatId, MSG.PAYMENT_SUBMITTED);
    }

    if (!msg.text) return;
    const txt = msg.text.trim();

    // Handle Admin ForceReplies
    if (admin && msg.reply_to_message?.text) {
      const promptText = msg.reply_to_message.text;

      if (promptText.includes('Enter broadcast message:')) {
        const allUsers = await prisma.user.findMany({ select: { telegramId: true } });
        let sent = 0;
        await tg.sendMessage(chatId, `⏳ Sending broadcast to ${allUsers.length} users...`);
        for (const u of allUsers) {
          try {
            await tg.sendMessage(u.telegramId.toString(), txt);
            sent++;
          } catch (err) {} 
        }
        return await tg.sendMessage(chatId, `✅ Broadcast finished. Sent to ${sent}/${allUsers.length} users.`);
      }

      if (promptText.includes('Enter Telegram User ID to manage:')) {
        if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.');
        const targetTgId = BigInt(txt);
        const uTarget = await prisma.user.findUnique({ where: { telegramId: targetTgId } });
        if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found in database.');
        
        const isBan = await isBanned(targetTgId);
        const info = `👤 <b>User Info</b>\n\n🆔 <b>ID:</b> <code>${txt}</code>\n💰 <b>Balance:</b> <code>₹${esc(uTarget.balance)}</code>\n👥 <b>Referrals:</b> <code>${uTarget.totalReferrals}</code>\n📅 <b>Joined:</b> <code>${new Date(uTarget.createdAt).toLocaleDateString('en-IN')}</code>`;
        return await tg.sendMessage(chatId, info, KB.manageUser(txt, isBan));
      }

      if (promptText.includes('Enter amount to add to user:')) {
        const uIdMatch = promptText.match(/user:\s*(\d+)/);
        if (!uIdMatch) return await tg.sendMessage(chatId, '❌ Failed to parse user ID.');
        const targetUId = uIdMatch[1];
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
        
        const uTarget = await prisma.user.findUnique({ where: { telegramId: BigInt(targetUId) } });
        if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found.');

        await prisma.$transaction([
          prisma.user.update({ where: { id: uTarget.id }, data: { balance: { increment: amt } } }),
          prisma.walletHistory.create({ data: { userId: uTarget.id, type: 'ADMIN_ADDED', amount: amt, description: `Admin added balance` } })
        ]);
        
        await tg.sendMessage(chatId, `✅ Added <code>₹${amt}</code> to user <code>${targetUId}</code>.`);
        await tg.sendMessage(targetUId, `💰 <b>Balance Added</b>\n\nAn admin has added <code>₹${amt}</code> to your wallet.`);
        return;
      }

      if (promptText.includes('Enter amount to deduct from user:')) {
        const uIdMatch = promptText.match(/user:\s*(\d+)/);
        if (!uIdMatch) return await tg.sendMessage(chatId, '❌ Failed to parse user ID.');
        const targetUId = uIdMatch[1];
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
        
        const uTarget = await prisma.user.findUnique({ where: { telegramId: BigInt(targetUId) } });
        if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found.');

        await prisma.$transaction([
          prisma.user.update({ where: { id: uTarget.id }, data: { balance: { decrement: amt } } }),
          prisma.walletHistory.create({ data: { userId: uTarget.id, type: 'ADMIN_REMOVED', amount: -amt, description: `Admin deducted balance` } })
        ]);
        
        await tg.sendMessage(chatId, `✅ Deducted <code>₹${amt}</code> from user <code>${targetUId}</code>.`);
        return;
      }

      if (promptText.includes('Enter new value for SMS setting:')) {
        const fieldMatch = promptText.match(/setting:\s*(\w+)/);
        if (!fieldMatch) return await tg.sendMessage(chatId, '❌ Failed to parse setting field.');
        const field = fieldMatch[1];
        
        const cur = await getSmsSettings();
        const numFields = ['maxPrice', 'timeout', 'interval'];
        const val = numFields.includes(field) ? Number(txt) : txt;
        
        if (numFields.includes(field) && (isNaN(val) || val <= 0)) {
          return await tg.sendMessage(chatId, '❌ Invalid number.');
        }

        const newSet = { ...cur, [field]: val };
        await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(newSet) } });
        return await tg.sendMessage(chatId, `✅ SMS Setting <code>${field}</code> updated to <code>${txt}</code>.`);
      }
    }

    if (txt.startsWith('/start')) {
      const payload = txt.split(' ')[1];
      if (payload) pendingReferrals.set(userId, payload);
      
      await getUser(userId);

      if (!(await verifyAccess(chatId, userId))) return;

      if (pendingReferrals.has(userId)) {
        await processReferral(userId, pendingReferrals.get(userId));
        pendingReferrals.delete(userId);
      }

      return await tg.sendMessage(chatId, MSG.WELCOME, admin ? KB.adminMain : KB.main);
    }

    if (!(await verifyAccess(chatId, userId))) return;

    switch (txt) {
      case '🐦 Get Twitter Number':
        const uBuy = await getUser(userId);
        const act = await prisma.order.findFirst({ where: { userId: uBuy.id, status: 'ACTIVE' } });
        if (act) return await tg.sendMessage(chatId, MSG.PLEASE_WAIT);
        
        const smsSet = await getSmsSettings();
        if (uBuy.balance.toNumber() < smsSet.maxPrice) return await tg.sendMessage(chatId, MSG.NO_BALANCE);
        
        const loadMsg = await tg.sendMessage(chatId, MSG.PURCHASING);
        const pr = await purchaseSms(smsSet);
        if (!pr.success) return await tg.editMessage(chatId, loadMsg?.message_id, MSG.NUMBER_FAILED);

        try {
          const ord = await prisma.$transaction(async (tx) => {
            const currentUser = await tx.user.findUnique({ where: { id: uBuy.id } });
            if (currentUser.balance.toNumber() < smsSet.maxPrice) throw new Error('INSUFFICIENT_BALANCE');
            
            await tx.user.update({
              where: { id: uBuy.id },
              data: { balance: { decrement: smsSet.maxPrice } }
            });
            
            return await tx.order.create({
              data: {
                userId: uBuy.id,
                activationId: pr.activationId,
                phoneNumber: pr.phoneNumber,
                service: String(smsSet.serviceId),
                provider: 'API',
                price: smsSet.maxPrice,
                expiresAt: new Date(Date.now() + (15 * 60 * 1000)), // Strict 15 min expiry tracking
                status: 'ACTIVE'
              }
            });
          });

          let rawPhone = pr.phoneNumber.toString().replace(/^\+?1?\s*/, '');

          const successMsg = MSG.NUMBER_SUCCESS
            .replace('{phoneNumber}', esc(rawPhone))
            .replace('{amount}', smsSet.maxPrice);

          await tg.editMessage(chatId, loadMsg?.message_id, successMsg, KB.cancel(pr.activationId));
          startOtpPolling(chatId, uBuy.id, ord.id, pr.activationId, pr.phoneNumber, smsSet.maxPrice, loadMsg?.message_id, smsSet.interval);
        } catch (err) {
          await cancelSms(pr.activationId);
          if (err.message === 'INSUFFICIENT_BALANCE') return await tg.editMessage(chatId, loadMsg?.message_id, MSG.NO_BALANCE);
          return await tg.editMessage(chatId, loadMsg?.message_id, MSG.NUMBER_FAILED);
        }
        break;

      case '👤 My Account':
        const uAcc = await getUser(userId);
        const textAcc = MSG.MY_ACCOUNT.replace('{userId}', userId).replace('{firstName}', esc(uAcc.firstName||'')).replace('{username}', esc(uAcc.username?'@'+uAcc.username:'')).replace('{balance}', esc(uAcc.balance)).replace('{referrals}', uAcc.totalReferrals).replace('{date}', new Date(uAcc.createdAt).toLocaleDateString('en-IN'));
        await tg.sendMessage(chatId, textAcc);
        break;

      case '📜 Wallet History':
        const uHist = await getUser(userId);
        const txs = await prisma.walletHistory.findMany({ 
          where: { 
            userId: uHist.id,
            type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS', 'REFUND', 'ADMIN_REMOVED'] } 
          }, 
          take: 10, 
          orderBy: { createdAt: 'desc' } 
        });
        if (!txs.length) return await tg.sendMessage(chatId, MSG.WALLET_EMPTY);
        let hTxt = "📜 <b>Wallet History</b>\n\n";
        txs.forEach(t => hTxt += `📅 <b>${new Date(t.createdAt).toLocaleDateString('en-IN')}</b>\n🔹 <b>Type:</b> ${esc(t.type)}\n💰 <b>Amount:</b> <code>${t.amount>0?'+':''}${esc(t.amount)}</code>\n📝 <b>Note:</b> <i>${esc(t.description)}</i>\n\n`);
        await tg.sendMessage(chatId, hTxt);
        break;

      case '💳 Add Balance':
        const sUpi = await getSysSettings();
        await tg.sendMessage(chatId, MSG.PAYMENT_INSTRUCT.replace('{upi}', esc(sUpi?.upiId || 'Skywardstudio@ybl')));
        break;

      case '🎁 Refer & Earn':
        const uRef = await getUser(userId);
        const sysRef = await getSysSettings();
        const rLink = `https://t.me/${CONFIG.telegram.botUsername}?start=${userId}`;
        const rTxt = MSG.REFER_INFO.replace('{amount}', esc(sysRef?.referralBonus || 0)).replace('{referralLink}', esc(rLink)) + `\n\n📊 <b>Your Stats</b>\n👥 <b>Referrals:</b> <code>${uRef.totalReferrals}</code>\n💰 <b>Earnings:</b> <code>₹${esc(uRef.referralEarnings)}</code>`;
        await tg.sendMessage(chatId, rTxt);
        break;

      case '📞 Support':
        const sSup = await getSysSettings();
        await tg.sendMessage(chatId, MSG.SUPPORT, KB.support(sSup?.supportUsername || CONFIG.telegram.supportUsername));
        break;

      case '📊 Statistics':
        if (!admin) return;
        const totU = await prisma.user.count();
        const actO = await prisma.order.count({ where: { status: 'ACTIVE' } });
        const cmpO = await prisma.order.count({ where: { status: 'COMPLETED' } });
        const rev = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'APPROVED' } });
        const statMsg = `📊 <b>Bot Statistics</b>\n\n👥 <b>Total Users:</b> <code>${totU}</code>\n🔄 <b>Active Orders:</b> <code>${actO}</code>\n✅ <b>Completed Orders:</b> <code>${cmpO}</code>\n💰 <b>Total Revenue:</b> <code>₹${rev._sum.amount || 0}</code>`;
        await tg.sendMessage(chatId, statMsg);
        break;

      case '👥 Users':
        if (!admin) return;
        await tg.sendMessage(chatId, '👤 Enter Telegram User ID to manage:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case '💳 Payments':
        if (!admin) return;
        const pends = await prisma.payment.findMany({ where: { status: 'PENDING' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: true } });
        if (!pends.length) return await tg.sendMessage(chatId, '💳 No pending payments.');
        let pTxt = `💳 <b>Recent Pending Payments</b>\n\n`;
        pends.forEach(p => pTxt += `🧾 <b>ID:</b> <code>${p.id}</code>\n👤 <b>User:</b> <code>${p.user.telegramId}</code>\n📅 <b>Date:</b> <code>${new Date(p.createdAt).toLocaleDateString('en-IN')}</code>\n💰 <b>Amount:</b> <code>₹${esc(p.amount)}</code>\n\n`);
        await tg.sendMessage(chatId, pTxt);
        break;

      case '🛒 Orders':
        if (!admin) return;
        const acts = await prisma.order.findMany({ where: { status: 'ACTIVE' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: true } });
        if (!acts.length) return await tg.sendMessage(chatId, '🛒 No active orders.');
        let oTxt = `🛒 <b>Recent Active Orders</b>\n\n`;
        acts.forEach(o => oTxt += `📱 <b>Number:</b> <code>${o.phoneNumber}</code>\n👤 <b>User:</b> <code>${o.user.telegramId}</code>\n🔑 <b>OTPs:</b> <code>${o.otpCount}</code>\n\n`);
        await tg.sendMessage(chatId, oTxt);
        break;

      case '📢 Broadcast':
        if (!admin) return;
        await tg.sendMessage(chatId, '📢 Enter broadcast message:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case '⚙️ Settings':
        if (admin) await tg.sendMessage(chatId, "⚙️ <b>System Settings</b>", KB.adminSettings());
        break;
    }
  }

  // --- CALLBACK ROUTER ---
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;
    const userId = cb.from?.id;
    if (!chatId || !userId) return;

    try { await tg.answerCallbackQuery(cb.id); } catch(e){}
    const dataParts = cb.data ? cb.data.split(':') : [];
    const action = dataParts[0];
    const args = dataParts.slice(1);
    const admin = await isAdmin(userId);

    switch (action) {
      case 'verify_join':
        const isJoined = await checkForceJoin(userId);
        if (isJoined || admin) {
          await tg.deleteMessage(chatId, msgId);
          if (pendingReferrals.has(userId)) {
            await processReferral(userId, pendingReferrals.get(userId));
            pendingReferrals.delete(userId);
          }
          await tg.sendMessage(chatId, MSG.WELCOME, admin ? KB.adminMain : KB.main);
        } else {
          await tg.answerCallbackQuery(cb.id, { text: "❌ Please join BOTH the Channel and the Group to continue.", show_alert: true });
        }
        break;

      case 'cancel_order':
        const uCan = await getUser(userId);
        const oCan = await prisma.order.findFirst({ where: { userId: uCan.id, status: 'ACTIVE', activationId: args[0] } });
        if (!oCan) return await tg.editMessage(chatId, msgId, MSG.UNKNOWN_ERROR, { inline_keyboard: [] });
        
        await cancelSms(args[0]);

        if (oCan.otpCount === 0) {
          await prisma.$transaction([
            prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } }),
            prisma.user.update({ where: { id: uCan.id }, data: { balance: { increment: oCan.price } } }),
            prisma.walletHistory.create({ data: { userId: uCan.id, type: 'REFUND', amount: oCan.price, description: `Manual refund: ${oCan.phoneNumber}` } })
          ]);
          await tg.editMessage(chatId, msgId, MSG.ORDER_CANCELLED_REFUND, { inline_keyboard: [] });
        } else {
          await prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } });
          await tg.editMessage(chatId, msgId, MSG.ORDER_CANCELLED_NO_REFUND, { inline_keyboard: [] });
        }
        break;

      case 'approve_payment':
        if (!admin) return;
        const pId = args[0];
        const targetTgId = BigInt(args[1]);

        const payment = await prisma.payment.findUnique({ where: { id: pId } });
        if (!payment || payment.status !== 'PENDING') {
          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
          await tg.sendMessage(chatId, '⚠️ Payment not pending or already processed.');
          return;
        }

        const uTargetApprove = await prisma.user.findUnique({ where: { telegramId: targetTgId } });
        if (!uTargetApprove) {
          await tg.sendMessage(chatId, '❌ Target user not found.');
          return;
        }

        const amt = Number(payment.amount);

        await prisma.$transaction([
          prisma.payment.update({ where: { id: payment.id }, data: { status: 'APPROVED' } }),
          prisma.user.update({ where: { id: uTargetApprove.id }, data: { balance: { increment: amt } } }),
          prisma.walletHistory.create({ data: { userId: uTargetApprove.id, type: 'DEPOSIT', amount: amt, description: `Payment approved: ${payment.id}` } })
        ]);

        await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
        await tg.sendMessage(chatId, `✅ Payment <code>${pId}</code> processed. Added <code>₹${amt}</code> to User <code>${args[1]}</code>.`);
        await tg.sendMessage(targetTgId.toString(), MSG.PAYMENT_APPROVED.replace('{amount}', esc(amt)));
        break;

      case 'reject_payment':
        if (!admin) return;
        await prisma.payment.update({ where: { id: args[0] }, data: { status: 'REJECTED' } });
        await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
        await tg.sendMessage(chatId, `❌ Payment <code>${args[0]}</code> Rejected.`);
        await tg.sendMessage(args[1], MSG.PAYMENT_REJECTED);
        break;

      case 'admin_maintenance':
        if (!admin) return;
        const s = await getSysSettings();
        await tg.editMessage(chatId, msgId, "🛠️ <b>Maintenance Mode</b>\n\nToggles user access.", KB.maintenance(s.isMaintenanceMode));
        break;

      case 'toggle_maintenance':
        if (!admin) return;
        const cur = await getSysSettings();
        const newVal = !cur.isMaintenanceMode;
        await prisma.setting.upsert({ where: { key: 'SYSTEM_SETTINGS' }, update: { value: JSON.stringify({...cur, isMaintenanceMode: newVal}) }, create: { key: 'SYSTEM_SETTINGS', value: JSON.stringify({isMaintenanceMode: newVal}) } });
        await tg.editMessage(chatId, msgId, "🛠️ <b>Maintenance Mode</b>\n\nToggles user access.", KB.maintenance(newVal));
        break;
        
      case 'admin_sms_settings':
        if (!admin) return;
        await tg.editMessage(chatId, msgId, "📡 <b>SMS Settings</b>\n\nSelect a field to modify.", KB.smsSettings());
        break;

      case 'admin_sms_current':
        if (!admin) return;
        const smsConf = await getSmsSettings();
        await tg.sendMessage(chatId, `📄 <b>Current Config</b>\nCountry: <code>${smsConf.countryId}</code>\nOperator: <code>${smsConf.operatorId}</code>\nService: <code>${smsConf.serviceId}</code>\nPrice: <code>₹${smsConf.maxPrice}</code>\nTimeout: <code>${smsConf.timeout}s</code>\nInterval: <code>${smsConf.interval}s</code>`);
        break;

      case 'admin_sms_edit':
        if (!admin) return;
        await tg.sendMessage(chatId, `📡 Enter new value for SMS setting: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'toggle_ban':
        if (!admin) return;
        const targetBannedId = BigInt(args[0]);
        const isBan = await isBanned(targetBannedId);
        if (isBan) {
          await prisma.bannedUser.delete({ where: { telegramId: targetBannedId } });
          await tg.sendMessage(chatId, `✅ User <code>${args[0]}</code> unbanned.`);
        } else {
          await prisma.bannedUser.create({ data: { telegramId: targetBannedId } });
          await tg.sendMessage(chatId, `⛔ User <code>${args[0]}</code> banned.`);
        }
        await tg.editMessageReplyMarkup(chatId, msgId, KB.manageUser(args[0], !isBan));
        break;

      case 'admin_add_bal':
        if (!admin) return;
        await tg.sendMessage(chatId, `➕ Enter amount to add to user: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'admin_ded_bal':
        if (!admin) return;
        await tg.sendMessage(chatId, `➖ Enter amount to deduct from user: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
        break;
    }
  }
}

server.post('/webhook', async (req, reply) => {
  if (req.headers['x-telegram-bot-api-secret-token'] !== CONFIG.webhook.secret) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  try {
    await handleUpdate(req.body);
  } catch (error) {
    server.log.error('[WEBHOOK ERROR]', error.message);
  }
  
  // ALWAYS return 200 to prevent Telegram from dropping the webhook
  return reply.code(200).send({ ok: true });
});

// ==========================================
// 7. GLOBAL ERROR HANDLERS
// ==========================================

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ==========================================
// 8. SERVER STARTUP & SHUTDOWN
// ==========================================

async function setupWebhookWithRetry(baseUrl, secret, maxRetries = 5) {
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const finalWebhookUrl = `${cleanBaseUrl}/webhook`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      server.log.info(`[TELEGRAM] Webhook Setup Attempt ${attempt}/${maxRetries}...`);

      const info = await tg.getWebhookInfo();
      if (info && info.url === finalWebhookUrl) {
        server.log.info(`[TELEGRAM] ✅ Webhook is already correctly configured at ${finalWebhookUrl}`);
        return true;
      }

      server.log.info(`[TELEGRAM] Deleting old webhook configuration...`);
      await tg.deleteWebhook({ drop_pending_updates: false });

      server.log.info(`[TELEGRAM] Registering new webhook: ${finalWebhookUrl}`);
      await tg.setWebhook(finalWebhookUrl, secret);

      const verifyInfo = await tg.getWebhookInfo();
      if (verifyInfo && verifyInfo.url === finalWebhookUrl) {
        server.log.info(`[TELEGRAM] ✅ Webhook successfully verified!`);
        return true;
      } else {
        throw new Error('Verification failed. Telegram returned a different URL.');
      }
    } catch (error) {
      server.log.error(`[TELEGRAM] ⚠️ Webhook setup error on attempt ${attempt}: ${error.message}`);
      if (attempt === maxRetries) {
        server.log.error(`[TELEGRAM] ❌ Failed to configure webhook after ${maxRetries} attempts.`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

const start = async () => {
  try {
    await prisma.$connect();
    const host = CONFIG.server.host || '0.0.0.0';
    await server.listen({ port: CONFIG.server.port, host });
    server.log.info(`[SERVER] 🚀 Running on http://${host}:${CONFIG.server.port}`);

    if (CONFIG.webhook.url && CONFIG.webhook.secret) {
      await setupWebhookWithRetry(CONFIG.webhook.url, CONFIG.webhook.secret);
    } else {
      server.log.warn(`[TELEGRAM] ⚠️ Webhook URL or Secret missing from configuration.`);
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

const closeGracefully = async () => {
  await server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

start();
