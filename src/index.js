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

// ==========================================
// 2. CONSTANTS: MESSAGES & KEYBOARDS
// ==========================================

const MSG = {
  WELCOME: "👋 *Welcome to our Premium OTP Service\\!*\n\nPlease use the menu below to navigate\\.",
  PLEASE_WAIT: "✋ Please wait a moment before trying again\\.",
  MAINTENANCE_MODE: "🛠️ *Maintenance Mode*\n\nOur service is currently undergoing scheduled maintenance\\.",
  INTERNAL_ERROR: "❌ *System Error*\n\nAn unexpected error occurred\\.",
  UNKNOWN_ERROR: "❓ *Unknown Error*\n\nSomething went wrong\\. Please try again later\\.",
  FORCE_JOIN: "⚠️ *Access Restricted*\n\nYou must join our official channels to use this bot\\. Please join using the links below, then click *Verify*\\.",
  VERIFIED_SUCCESS: "✅ *Verification Successful*\n\nWelcome aboard\\! You now have full access to the bot\\.",
  VERIFIED_FAILED: "❌ *Verification Failed*\n\nWe couldn't verify your membership\\.",
  PURCHASING: "🔄 *Purchasing Number\\.\\.\\.*\n\nPlease wait while we reserve a number for you\\.",
  NUMBER_SUCCESS: "✅ *Number Purchased successfully\\!*\n\n📱 *Number:* `{phoneNumber}`\n💰 *Price:* `₹{amount}`\n\n_Waiting for OTP\\.\\.\\._",
  NUMBER_FAILED: "❌ *Purchase Failed*\n\nWe couldn't acquire a number at this time\\. Please try again later\\.",
  NO_BALANCE: "⚠️ *Insufficient Balance*\n\nPlease add funds to your wallet to purchase this number\\.",
  OTP_1: "📩 *OTP Received \\(1/3\\)*\n\n📱 *Number:* `{phoneNumber}`\n🔑 *OTP Code:* `{otp}`",
  OTP_2: "📩 *OTP Received \\(2/3\\)*\n\n📱 *Number:* `{phoneNumber}`\n🔑 *OTP Code:* `{otp}`",
  OTP_3: "📩 *Final OTP Received \\(3/3\\)*\n\n📱 *Number:* `{phoneNumber}`\n🔑 *OTP Code:* `{otp}`\n\n_Order completed automatically\\._",
  OTP_TIMEOUT_REFUND: "⏱ *Timeout Reached*\n\nNo OTP was received in time\\. `₹{amount}` has been refunded to your wallet\\.",
  OTP_TIMEOUT_NO_REFUND: "⏱ *Timeout Reached*\n\nSession ended\\. No refund issued as OTPs were received\\.",
  ORDER_CANCELLED: "🛑 *Number Cancelled*\n\nThe number was cancelled and your funds have been refunded\\.",
  PAYMENT_INSTRUCT: "💳 *Add Balance*\n\nPlease send your payment to the UPI ID below and upload a screenshot here\\.\n\n🏦 *UPI ID:* `{upi}`\n\n_Note: Send the screenshot directly in this chat\\._",
  PAYMENT_SUBMITTED: "📤 *Payment Submitted*\n\nYour screenshot has been sent to the admin for review\\. Please wait for approval\\.",
  PAYMENT_APPROVED: "✅ *Payment Approved*\n\n`₹{amount}` has been successfully added to your wallet\\.",
  PAYMENT_REJECTED: "❌ *Payment Rejected*\n\nYour recent payment submission was declined\\. Contact support if you need help\\.",
  WALLET_EMPTY: "📜 *Wallet History*\n\nYou have no recent transactions\\.",
  MY_ACCOUNT: "👤 *My Account*\n\n🆔 *User ID:* `{userId}`\n🗣 *Name:* {firstName} {username}\n💰 *Balance:* `₹{balance}`\n👥 *Referrals:* `{referrals}`\n📅 *Joined:* `{date}`",
  REFER_INFO: "🎁 *Refer & Earn*\n\nInvite your friends and earn `₹{amount}` for every successful signup\\!\n\n🔗 *Your Referral Link:*\n{referralLink}",
  SUPPORT: "📞 *Support*\n\nIf you need assistance, please contact our support team below\\.",
  BANNED: "⛔ *User Banned*\n\nYou have been restricted from using the bot\\."
};

const BTN = { inline: (t, c) => ({text: t, callback_data: c}), url: (t, u) => ({text: t, url: u}) };
const KB = {
  main: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}]], resize_keyboard: true, is_persistent: true },
  adminMain: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}], [{text: "📊 Statistics"}, {text: "👥 Users"}, {text: "💳 Payments"}], [{text: "🛒 Orders"}, {text: "📢 Broadcast"}, {text: "⚙️ Settings"}]], resize_keyboard: true, is_persistent: true },
  forceJoin: (c, g) => ({ inline_keyboard: [[BTN.url("📢 Join Channel", `https://t.me/${c.replace("@","")}`)], [BTN.url("👥 Join Group", `https://t.me/${g.replace("@","")}`)], [BTN.inline("✅ Verify", "verify_join")]] }),
  cancel: (id) => ({ inline_keyboard: [[BTN.inline("🛑 Cancel Number", `cancel_order:${id}`)]] }),
  approveReject: (pId, uId) => ({ inline_keyboard: [[BTN.inline("✅ Approve", `approve_payment:${pId}:${uId}`), BTN.inline("❌ Reject", `reject_payment:${pId}:${uId}`)]] }),
  support: (u) => ({ inline_keyboard: [[BTN.url("💬 Contact Support", `https://t.me/${u.replace("@","")}`)]] }),
  adminSettings: () => ({ inline_keyboard: [[BTN.inline("🛠️ Maintenance Mode", "admin_maintenance"), BTN.inline("📡 SMS Settings", "admin_sms_settings")]] }),
  maintenance: (isOn) => ({ inline_keyboard: [[BTN.inline(isOn ? "✅ Turn OFF" : "⛔ Turn ON", "toggle_maintenance")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  smsSettings: () => ({ inline_keyboard: [[BTN.inline("🌍 Country", "admin_sms_edit:countryId"), BTN.inline("📡 Operator", "admin_sms_edit:operatorId")], [BTN.inline("🐦 Service", "admin_sms_edit:serviceId"), BTN.inline("💰 Max Price", "admin_sms_edit:maxPrice")], [BTN.inline("⏱ Timeout", "admin_sms_edit:timeout"), BTN.inline("🔄 Interval", "admin_sms_edit:interval")], [BTN.inline("📄 Current Config", "admin_sms_current")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  manageUser: (uId, isBan) => ({ inline_keyboard: [[BTN.inline("➕ Add Balance", `admin_add_bal:${uId}`), BTN.inline("➖ Deduct Balance", `admin_ded_bal:${uId}`)], [BTN.inline(isBan ? "✅ Unban User" : "⛔ Ban User", `toggle_ban:${uId}`)]] })
};

function esc(text) { return text == null ? 'None' : text.toString().replace(/([`\\])/g, '\\$1'); }
function escMd(text) { return text == null ? '' : text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'); }

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

async function startOtpPolling(chatId, userDbId, orderId, activationId, phone, price, msgId, timeout, interval) {
  const endTime = Date.now() + (timeout * 1000);
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

        if (otpsReceived === 1) await tg.sendMessage(chatId, MSG.OTP_1.replace('{phoneNumber}', phone).replace('{otp}', esc(lastOtp)));
        else if (otpsReceived === 2) await tg.sendMessage(chatId, MSG.OTP_2.replace('{phoneNumber}', phone).replace('{otp}', esc(lastOtp)));
        else if (otpsReceived >= 3) {
          await tg.sendMessage(chatId, MSG.OTP_3.replace('{phoneNumber}', phone).replace('{otp}', esc(lastOtp)));
          await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
          return await tg.editMessage(chatId, msgId, MSG.NUMBER_SUCCESS.replace('{phoneNumber}', phone).replace('{amount}', price));
        }
      }
    }

    const fOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!fOrder || fOrder.status !== 'ACTIVE') return;

    if (otpsReceived === 0) {
      await cancelSms(activationId);
      
      // DB Consistency: Cancel order, refund money, log transaction atomically
      await prisma.$transaction([
        prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } }),
        prisma.user.update({ where: { id: userDbId }, data: { balance: { increment: price } } }),
        prisma.walletHistory.create({ data: { userId: userDbId, type: 'REFUND', amount: price, description: `Timeout refund: ${phone}` } })
      ]);

      await tg.editMessage(chatId, msgId, MSG.OTP_TIMEOUT_REFUND.replace('{amount}', price));
    } else {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      await tg.editMessage(chatId, msgId, MSG.OTP_TIMEOUT_NO_REFUND);
    }
  } catch (error) { console.error(`[POLLING ERR] Order: ${orderId}`, error); }
}

async function verifyAccess(chatId, userId) {
  if (await isBanned(userId)) { await tg.sendMessage(chatId, MSG.BANNED); return false; }
  const sys = await getSysSettings();
  if (sys?.isMaintenanceMode && !(await isAdmin(userId))) { await tg.sendMessage(chatId, MSG.MAINTENANCE_MODE); return false; }
  if (sys?.forceJoinEnabled && !(await isAdmin(userId))) {
    try {
      const c = await tg.getChatMember(sys.forceJoinChannel, userId);
      const g = await tg.getChatMember(sys.forceJoinGroup, userId);
      if (['left', 'kicked'].includes(c.status) || ['left', 'kicked'].includes(g.status)) {
        await tg.sendMessage(chatId, MSG.FORCE_JOIN, KB.forceJoin(sys.forceJoinChannel, sys.forceJoinGroup));
        return false;
      }
    } catch (e) { 
      await tg.sendMessage(chatId, MSG.FORCE_JOIN, KB.forceJoin(sys.forceJoinChannel, sys.forceJoinGroup));
      return false; 
    }
  }
  return true;
}

// ==========================================
// 6. WEBHOOK ROUTES & HANDLERS
// ==========================================

server.post('/webhook', async (req, reply) => {
  if (req.headers['x-telegram-bot-api-secret-token'] !== CONFIG.webhook.secret) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  reply.status(200).send({ ok: true });

  try {
    const update = req.body;

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
        const u = await getUser(userId);
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const p = await prisma.payment.create({ data: { userId: u.id, photoFileId: photoId, status: 'PENDING' } });
        
        const sys = await getSysSettings();
        const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
        if (aId) {
          const caption = `💳 *New Payment Request*\n\n🆔 *User ID:* \`${userId}\`\n🧾 *Payment ID:* \`${p.id}\``;
          await tg.sendPhoto(aId, photoId, { caption, reply_markup: KB.approveReject(p.id, userId) });
        }
        return await tg.sendMessage(chatId, MSG.PAYMENT_SUBMITTED);
      }

      if (!msg.text) return;
      const txt = msg.text.trim();

      // Handle Admin ForceReplies (Robust Regex Parsing to prevent null crash)
      if (admin && msg.reply_to_message?.text) {
        const promptText = msg.reply_to_message.text;

        // 1. Payment Approval
        if (promptText.includes('Enter deposit amount for payment ID:')) {
          const pIdMatch = promptText.match(/payment ID:\s*(\S+)/);
          const uIdMatch = promptText.match(/User ID:\s*(\d+)/);
          if (!pIdMatch || !uIdMatch) return await tg.sendMessage(chatId, '❌ Failed to parse payment context.');
          
          const pId = pIdMatch[1];
          const targetUId = uIdMatch[1];
          
          const amt = Number(txt);
          if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
          
          const p = await prisma.payment.findUnique({ where: { id: pId } });
          if (!p || p.status !== 'PENDING') return await tg.sendMessage(chatId, '⚠️ Payment not pending or already processed.');

          const uTarget = await prisma.user.findUnique({ where: { telegramId: BigInt(targetUId) } });
          if (!uTarget) return await tg.sendMessage(chatId, '❌ Target user not found.');

          // DB Consistency: Atomic payment resolution and wallet update
          await prisma.$transaction([
            prisma.payment.update({ where: { id: p.id }, data: { status: 'APPROVED', amount: amt } }),
            prisma.user.update({ where: { id: uTarget.id }, data: { balance: { increment: amt } } }),
            prisma.walletHistory.create({ data: { userId: uTarget.id, type: 'DEPOSIT', amount: amt, description: `Payment approved: ${p.id}` } })
          ]);
          
          await tg.sendMessage(chatId, `✅ Payment \`${p.id}\` processed. Added \`₹${amt}\` to User \`${targetUId}\`.`);
          await tg.sendMessage(targetUId, MSG.PAYMENT_APPROVED.replace('{amount}', esc(amt)));
          return;
        }

        // 2. Broadcast Message
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

        // 3. User Lookup
        if (promptText.includes('Enter Telegram User ID to manage:')) {
          if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.');
          const targetTgId = BigInt(txt);
          const uTarget = await prisma.user.findUnique({ where: { telegramId: targetTgId } });
          if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found in database.');
          
          const isBan = await isBanned(targetTgId);
          const info = `👤 *User Info*\n\n🆔 *ID:* \`${txt}\`\n💰 *Balance:* \`₹${esc(uTarget.balance)}\`\n👥 *Referrals:* \`${uTarget.totalReferrals}\`\n📅 *Joined:* \`${new Date(uTarget.createdAt).toLocaleDateString('en-IN')}\``;
          return await tg.sendMessage(chatId, info, KB.manageUser(txt, isBan));
        }

        // 4. Add Balance
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
          
          await tg.sendMessage(chatId, `✅ Added \`₹${amt}\` to user \`${targetUId}\`.`);
          await tg.sendMessage(targetUId, `💰 *Balance Added*\n\nAn admin has added \`₹${amt}\` to your wallet.`);
          return;
        }

        // 5. Deduct Balance
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
          
          await tg.sendMessage(chatId, `✅ Deducted \`₹${amt}\` from user \`${targetUId}\`.`);
          return;
        }

        // 6. SMS Settings Edit
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
          return await tg.sendMessage(chatId, `✅ SMS Setting \`${field}\` updated to \`${txt}\`.`);
        }
      }

      // Start Command
      if (txt.startsWith('/start')) {
        const payload = txt.split(' ')[1];
        if (payload) await processReferral(userId, payload);
        const u = await getUser(userId);
        if (!(await verifyAccess(chatId, userId))) return;
        return await tg.sendMessage(chatId, MSG.WELCOME, admin ? KB.adminMain : KB.main);
      }

      if (!(await verifyAccess(chatId, userId))) return;

      // Regular & Admin Menu Buttons
      switch (txt) {
        // --- USER COMMANDS ---
        case '🐦 Get Twitter Number':
          const uBuy = await getUser(userId);
          const act = await prisma.order.findFirst({ where: { userId: uBuy.id, status: 'ACTIVE' } });
          if (act) return await tg.sendMessage(chatId, MSG.PLEASE_WAIT);
          
          const smsSet = await getSmsSettings();
          if (uBuy.balance.toNumber() < smsSet.maxPrice) return await tg.sendMessage(chatId, MSG.NO_BALANCE);
          
          const loadMsg = await tg.sendMessage(chatId, MSG.PURCHASING);
          const pr = await purchaseSms(smsSet);
          if (!pr.success) return await tg.editMessage(chatId, loadMsg.message_id, MSG.NUMBER_FAILED);

          try {
            // DB Consistency: Strict atomic verification and order creation
            const ord = await prisma.$transaction(async (tx) => {
              const currentUser = await tx.user.findUnique({ where: { id: uBuy.id } });
              if (currentUser.balance.toNumber() < smsSet.maxPrice) {
                throw new Error('INSUFFICIENT_BALANCE');
              }
              const updatedUser = await tx.user.update({
                where: { id: uBuy.id },
                data: { balance: { decrement: smsSet.maxPrice } }
              });
              await tx.walletHistory.create({
                data: { userId: updatedUser.id, type: 'NUMBER_PURCHASE', amount: -smsSet.maxPrice, description: `Purchased: ${pr.phoneNumber}` }
              });
              return await tx.order.create({
                data: { userId: updatedUser.id, activationId: pr.activationId, phoneNumber: pr.phoneNumber, service: String(smsSet.serviceId), provider: 'API', price: smsSet.maxPrice, expiresAt: new Date(Date.now() + (smsSet.timeout * 1000)), status: 'ACTIVE' }
              });
            });

            await tg.editMessage(chatId, loadMsg.message_id, MSG.NUMBER_SUCCESS.replace('{phoneNumber}', pr.phoneNumber).replace('{amount}', smsSet.maxPrice), KB.cancel(pr.activationId));
            startOtpPolling(chatId, uBuy.id, ord.id, pr.activationId, pr.phoneNumber, smsSet.maxPrice, loadMsg.message_id, smsSet.timeout, smsSet.interval);
          } catch (err) {
            await cancelSms(pr.activationId); // Revert provider purchase if DB fails
            if (err.message === 'INSUFFICIENT_BALANCE') return await tg.editMessage(chatId, loadMsg.message_id, MSG.NO_BALANCE);
            return await tg.editMessage(chatId, loadMsg.message_id, MSG.NUMBER_FAILED);
          }
          break;

        case '👤 My Account':
          const uAcc = await getUser(userId);
          const textAcc = MSG.MY_ACCOUNT.replace('{userId}', userId).replace('{firstName}', esc(uAcc.firstName||'')).replace('{username}', esc(uAcc.username?'@'+uAcc.username:'')).replace('{balance}', esc(uAcc.balance)).replace('{referrals}', uAcc.totalReferrals).replace('{date}', new Date(uAcc.createdAt).toLocaleDateString('en-IN'));
          await tg.sendMessage(chatId, textAcc);
          break;

        case '📜 Wallet History':
          const uHist = await getUser(userId);
          const txs = await prisma.walletHistory.findMany({ where: { userId: uHist.id }, take: 10, orderBy: { createdAt: 'desc' } });
          if (!txs.length) return await tg.sendMessage(chatId, MSG.WALLET_EMPTY);
          let hTxt = "📜 *Wallet History*\n\n";
          txs.forEach(t => hTxt += `📅 *${new Date(t.createdAt).toLocaleDateString('en-IN')}*\n🔹 *Type:* ${escMd(t.type)}\n💰 *Amount:* \`${t.amount>0?'+':''}${esc(t.amount)}\`\n📝 *Note:* _${escMd(t.description)}_\n\n`);
          await tg.sendMessage(chatId, hTxt);
          break;

        case '💳 Add Balance':
          const sUpi = await getSysSettings();
          await tg.sendMessage(chatId, MSG.PAYMENT_INSTRUCT.replace('{upi}', esc(sUpi?.upiId || 'skywardstudio@ybl')));
          break;

        case '🎁 Refer & Earn':
          const uRef = await getUser(userId);
          const sysRef = await getSysSettings();
          const rLink = `https://t.me/${CONFIG.telegram.botUsername}?start=${userId}`;
          const rTxt = MSG.REFER_INFO.replace('{amount}', esc(sysRef?.referralBonus || 0)).replace('{referralLink}', esc(rLink)) + `\n\n📊 *Your Stats*\n👥 *Referrals:* \`${uRef.totalReferrals}\`\n💰 *Earnings:* \`₹${esc(uRef.referralEarnings)}\``;
          await tg.sendMessage(chatId, rTxt);
          break;

        case '📞 Support':
          const sSup = await getSysSettings();
          await tg.sendMessage(chatId, MSG.SUPPORT, KB.support(sSup?.supportUsername || CONFIG.telegram.supportUsername));
          break;

        // --- ADMIN COMMANDS ---
        case '📊 Statistics':
          if (!admin) return;
          const totU = await prisma.user.count();
          const actO = await prisma.order.count({ where: { status: 'ACTIVE' } });
          const cmpO = await prisma.order.count({ where: { status: 'COMPLETED' } });
          const rev = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'APPROVED' } });
          const statMsg = `📊 *Bot Statistics*\n\n👥 *Total Users:* \`${totU}\`\n🔄 *Active Orders:* \`${actO}\`\n✅ *Completed Orders:* \`${cmpO}\`\n💰 *Total Revenue:* \`₹${rev._sum.amount || 0}\``;
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
          let pTxt = `💳 *Recent Pending Payments*\n\n`;
          pends.forEach(p => pTxt += `🧾 *ID:* \`${p.id}\`\n👤 *User:* \`${p.user.telegramId}\`\n📅 *Date:* \`${new Date(p.createdAt).toLocaleDateString('en-IN')}\`\n\n`);
          await tg.sendMessage(chatId, pTxt);
          break;

        case '🛒 Orders':
          if (!admin) return;
          const acts = await prisma.order.findMany({ where: { status: 'ACTIVE' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: true } });
          if (!acts.length) return await tg.sendMessage(chatId, '🛒 No active orders.');
          let oTxt = `🛒 *Recent Active Orders*\n\n`;
          acts.forEach(o => oTxt += `📱 *Number:* \`${o.phoneNumber}\`\n👤 *User:* \`${o.user.telegramId}\`\n🔑 *OTPs:* \`${o.otpCount}\`\n\n`);
          await tg.sendMessage(chatId, oTxt);
          break;

        case '📢 Broadcast':
          if (!admin) return;
          await tg.sendMessage(chatId, '📢 Enter broadcast message:', { reply_markup: { force_reply: true, selective: true } });
          break;

        case '⚙️ Settings':
          if (admin) await tg.sendMessage(chatId, "⚙️ *System Settings*", KB.adminSettings());
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
        // User Actions
        case 'verify_join':
          if (await verifyAccess(chatId, userId)) {
            await tg.editMessage(chatId, msgId, MSG.VERIFIED_SUCCESS);
            await tg.sendMessage(chatId, MSG.WELCOME, admin ? KB.adminMain : KB.main);
          }
          break;

        case 'cancel_order':
          const uCan = await getUser(userId);
          const oCan = await prisma.order.findFirst({ where: { userId: uCan.id, status: 'ACTIVE', activationId: args[0] } });
          if (!oCan) return await tg.editMessage(chatId, msgId, MSG.UNKNOWN_ERROR);
          if (oCan.otpCount > 0) return await tg.sendMessage(chatId, MSG.PLEASE_WAIT);
          
          await cancelSms(args[0]);

          // DB Consistency: Cancel order and refund atomically
          await prisma.$transaction([
            prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } }),
            prisma.user.update({ where: { id: uCan.id }, data: { balance: { increment: oCan.price } } }),
            prisma.walletHistory.create({ data: { userId: uCan.id, type: 'REFUND', amount: oCan.price, description: `Manual refund: ${oCan.phoneNumber}` } })
          ]);
          
          await tg.editMessage(chatId, msgId, MSG.ORDER_CANCELLED);
          break;

        // Admin Actions
        case 'approve_payment':
          if (!admin) return;
          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
          await tg.sendMessage(chatId, `💰 Enter deposit amount for payment ID: ${args[0]}\nUser ID: ${args[1]}`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'reject_payment':
          if (!admin) return;
          await prisma.payment.update({ where: { id: args[0] }, data: { status: 'REJECTED' } });
          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
          await tg.sendMessage(chatId, `❌ Payment \`${args[0]}\` Rejected.`);
          await tg.sendMessage(args[1], MSG.PAYMENT_REJECTED);
          break;

        case 'admin_maintenance':
          if (!admin) return;
          const s = await getSysSettings();
          await tg.editMessage(chatId, msgId, "🛠️ *Maintenance Mode*\n\nToggles user access.", KB.maintenance(s.isMaintenanceMode));
          break;

        case 'toggle_maintenance':
          if (!admin) return;
          const cur = await getSysSettings();
          const newVal = !cur.isMaintenanceMode;
          await prisma.setting.upsert({ where: { key: 'SYSTEM_SETTINGS' }, update: { value: JSON.stringify({...cur, isMaintenanceMode: newVal}) }, create: { key: 'SYSTEM_SETTINGS', value: JSON.stringify({isMaintenanceMode: newVal}) } });
          await tg.editMessage(chatId, msgId, "🛠️ *Maintenance Mode*\n\nToggles user access.", KB.maintenance(newVal));
          break;
          
        case 'admin_sms_settings':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "📡 *SMS Settings*\n\nSelect a field to modify.", KB.smsSettings());
          break;

        case 'admin_sms_current':
          if (!admin) return;
          const smsConf = await getSmsSettings();
          await tg.sendMessage(chatId, `📄 *Current Config*\nCountry: \`${smsConf.countryId}\`\nOperator: \`${smsConf.operatorId}\`\nService: \`${smsConf.serviceId}\`\nPrice: \`₹${smsConf.maxPrice}\`\nTimeout: \`${smsConf.timeout}s\`\nInterval: \`${smsConf.interval}s\``);
          break;

        case 'admin_sms_edit':
          if (!admin) return;
          await tg.sendMessage(chatId, `📡 Enter new value for SMS setting: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'toggle_ban':
          if (!admin) return;
          const targetTgId = BigInt(args[0]);
          const isBan = await isBanned(targetTgId);
          if (isBan) {
            await prisma.bannedUser.delete({ where: { telegramId: targetTgId } });
            await tg.sendMessage(chatId, `✅ User \`${args[0]}\` unbanned.`);
          } else {
            await prisma.bannedUser.create({ data: { telegramId: targetTgId } });
            await tg.sendMessage(chatId, `⛔ User \`${args[0]}\` banned.`);
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
  } catch (error) { server.log.error(error); }
});

// ==========================================
// 7. SERVER STARTUP & SHUTDOWN
// ==========================================

const start = async () => {
  try {
    await prisma.$connect();
    const host = CONFIG.server.host || '0.0.0.0';
    await server.listen({ port: CONFIG.server.port, host });
    server.log.info(`[SERVER] 🚀 Running on http://${host}:${CONFIG.server.port}`);

    if (CONFIG.webhook.url && CONFIG.webhook.secret) {
      await tg.setWebhook(CONFIG.webhook.url, CONFIG.webhook.secret);
      server.log.info(`[TELEGRAM] ✅ Webhook set to ${CONFIG.webhook.url}`);
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
