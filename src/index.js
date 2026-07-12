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

// In-memory store to track and prevent duplicate callback queries
const answeredCallbacks = new Set();

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
  NUMBER_SUCCESS: "✅ <b>Number Activated</b>\n\n🇺🇸 United States • 🐦 Twitter\n\n📞 <code>+1{phoneNumber}</code>\n\n💳 ₹{amount}\n\n💡 <b>Refund Policy</b>\n• 0 OTP → Full Refund\n• 1+ OTP → No Refund",
  NUMBER_FAILED: "❌ <b>Purchase Failed</b>\n\nWe couldn't acquire a number at this time. Please try again later.",
  NO_BALANCE: "⚠️ <b>Insufficient Balance</b>\n\nPlease add funds to your wallet to purchase this number.",
  OTP_RECEIVED: "📩 <b>OTP #{count} Received</b>\n\n🔑 <b>OTP:</b>\n<code>{otp}</code>",
  MAX_OTP_REACHED: "✅ <b>Maximum OTP Limit Reached</b>\n\nThis number has received the maximum allowed OTPs.\n\nPlease purchase a new number if you need additional OTPs.",
  OTP_TIMEOUT_REFUND: "⌛ <b>Number Expired</b>\n\nNo OTP was received within 15 minutes.\n\n💰 Full refund has been credited to your wallet.",
  OTP_TIMEOUT_NO_REFUND: "⌛ <b>Number Expired</b>\n\nThe 15-minute validity period has ended.\n\n⚠️ At least one OTP was received.\n\n💰 No refund has been issued.",
  ORDER_CANCELLED_REFUND: "❌ <b>Number Cancelled Successfully</b>\n\n💰 Full refund has been credited to your wallet.",
  ORDER_CANCELLED_NO_REFUND: "❌ <b>Number Cancelled Successfully</b>\n\n⚠️ At least one OTP was already received.\n\n💰 No refund has been issued.",
  ADD_BALANCE: "💳 <b>Add Balance</b>\n\n🖼 <b>Scan QR</b>\n\n🏦 <code>{upi}</code>\n\n💵 <b>Min Deposit:</b> <code>₹{minimumDeposit}</code>\n━━━━━━━━━━━━━━\n📷 Send payment screenshot.\n📝 Caption: <code>100</code>\n❌ No text, only amount.",
  PAYMENT_CAPTION_ERROR: "❌ Please send the payment screenshot with only the amount in the caption. Example: 100",
  PAYMENT_SUBMITTED: "📤 <b>Payment Submitted</b>\n\nYour screenshot has been sent to the admin for review. Please wait for approval.",
  PAYMENT_APPROVED: "✅ <b>Payment Approved</b>\n\n<code>₹{amount}</code> has been successfully added to your wallet.",
  PAYMENT_REJECTED: "❌ <b>Payment Rejected</b>\n\nYour recent payment submission was declined. Contact support if you need help.",
  WALLET_EMPTY: "📜 <b>Wallet History</b>\n\nYou have no recent transactions.",
  MY_ACCOUNT: "👤 <b>My Account</b>\n\n🆔 <b>User ID:</b> <code>{userId}</code>\n🗣 <b>Name:</b> {firstName} {username}\n💰 <b>Balance:</b> <code>₹{balance}</code>\n👥 <b>Referrals:</b> <code>{referrals}</code>\n📅 <b>Joined:</b> <code>{date}</code>",
  REFER_INFO: "🎁 <b>Refer & Earn</b>\n\nInvite your friends and earn <code>₹{amount}</code> for every successful signup!\n\n🔗 <b>Your Referral Link:</b>\n{referralLink}",
  SUPPORT: "📞 <b>Support</b>\n\nIf you need assistance, please contact our support team below.",
  BANNED: "⛔ <b>User Banned</b>\n\nYou have been restricted from using the bot.",
  REF_PENDING: "👥 <b>New Referral Joined</b>\n\nA new user has joined using your referral link.\n\n⏳ <b>Status:</b> Pending Verification\n\nThe referral reward will be credited after the user successfully completes Channel & Group verification.",
  REF_COMPLETED: "🎉 <b>Referral Completed</b>\n\nYour referral has been successfully verified.\n\n💰 <b>Reward Added:</b>\n₹{referralReward}\n\nThe reward has been added to your wallet."
};

const BTN = { inline: (t, c) => ({text: t, callback_data: c}), url: (t, u) => ({text: t, url: u}) };
const KB = {
  main: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}]], resize_keyboard: true, is_persistent: true },
  adminMain: { keyboard: [[{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}], [{text: "📊 Statistics"}, {text: "👥 Users"}, {text: "💳 Payments"}], [{text: "🛒 Orders"}, {text: "📢 Broadcast"}, {text: "⚙️ Settings"}]], resize_keyboard: true, is_persistent: true },
  forceJoin: (c, g) => ({ inline_keyboard: [[BTN.url("📢 Join Channel", `https://t.me/${c.replace("@","")}`)], [BTN.url("👥 Join Group", `https://t.me/${g.replace("@","")}`)], [BTN.inline("✅ I've Joined", "verify_join")]] }),
  cancel: (id) => ({ inline_keyboard: [[BTN.inline("❌ Cancel Number", `cancel_order:${id}`)]] }),
  approveReject: (pId, uId) => ({ inline_keyboard: [[BTN.inline("✅ Approve", `approve_payment:${pId}:${uId}`), BTN.inline("❌ Reject", `reject_payment:${pId}:${uId}`)]] }),
  support: (u) => ({ inline_keyboard: [[BTN.url("💬 Contact Support", `https://t.me/${u.replace("@","")}`)]] }),
  adminSettings: () => ({ inline_keyboard: [
    [BTN.inline("💰 Number Price", "admin_num_price"), BTN.inline("🎁 Referral Reward", "admin_ref_reward")],
    [BTN.inline("💳 Payment Settings", "pay_settings"), BTN.inline("💬 Message Editor", "msg_editor")],
    [BTN.inline("🚫 Force Join Bypass", "admin_bypass")],
    [BTN.inline("🛠️ Maintenance Mode", "admin_maintenance"), BTN.inline("📡 SMS Settings", "admin_sms_settings")],
    [BTN.inline("🔙 Back", "back_to_admin")]
  ] }),
  bypassMenu: () => ({ inline_keyboard: [
    [BTN.inline("➕ Add User", "add_bypass"), BTN.inline("📋 View Users", "view_bypass")],
    [BTN.inline("❌ Remove User", "remove_bypass")],
    [BTN.inline("🔙 Back", "admin_settings")]
  ] }),
  maintenance: (isOn) => ({ inline_keyboard: [[BTN.inline(isOn ? "✅ Turn OFF" : "⛔ Turn ON", "toggle_maintenance")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  smsSettings: () => ({ inline_keyboard: [[BTN.inline("🌍 Country", "admin_sms_edit:countryId"), BTN.inline("📡 Operator", "admin_sms_edit:operatorId")], [BTN.inline("🐦 Service", "admin_sms_edit:serviceId"), BTN.inline("💰 Max Price", "admin_sms_edit:maxPrice")], [BTN.inline("⏱ Timeout", "admin_sms_edit:timeout"), BTN.inline("🔄 Interval", "admin_sms_edit:interval")], [BTN.inline("📄 Current Config", "admin_sms_current")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  manageUser: (uId, isBan) => ({ inline_keyboard: [[BTN.inline("➕ Add Balance", `admin_add_bal:${uId}`), BTN.inline("➖ Deduct Balance", `admin_ded_bal:${uId}`)], [BTN.inline(isBan ? "✅ Unban User" : "⛔ Ban User", `toggle_ban:${uId}`)], [BTN.inline("🔙 Back", "admin_users_menu")]] }),
  numPrice: () => ({ inline_keyboard: [[BTN.inline("✏️ Change Price", "edit_num_price")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  refReward: () => ({ inline_keyboard: [[BTN.inline("✏️ Change Reward", "edit_ref_reward")], [BTN.inline("🔙 Back", "admin_settings")]] }),
  messageEditor: () => ({ inline_keyboard: [
    [BTN.inline("👋 Welcome", "edit_msg:WELCOME"), BTN.inline("💳 Add Balance", "edit_msg:ADD_BALANCE")],
    [BTN.inline("📱 Number Activated", "edit_msg:NUMBER_SUCCESS"), BTN.inline("📩 OTP Received", "edit_msg:OTP_RECEIVED")],
    [BTN.inline("⌛ Expired (Refund)", "edit_msg:OTP_TIMEOUT_REFUND"), BTN.inline("⌛ Expired (No Refund)", "edit_msg:OTP_TIMEOUT_NO_REFUND")],
    [BTN.inline("❌ Cancelled (Refund)", "edit_msg:ORDER_CANCELLED_REFUND"), BTN.inline("❌ Cancelled (No Refund)", "edit_msg:ORDER_CANCELLED_NO_REFUND")],
    [BTN.inline("✅ Payment Approved", "edit_msg:PAYMENT_APPROVED"), BTN.inline("❌ Payment Rejected", "edit_msg:PAYMENT_REJECTED")],
    [BTN.inline("👤 My Account", "edit_msg:MY_ACCOUNT"), BTN.inline("📜 Wallet History", "edit_msg:WALLET_EMPTY")],
    [BTN.inline("🎁 Refer & Earn", "edit_msg:REFER_INFO"), BTN.inline("📞 Support", "edit_msg:SUPPORT")],
    [BTN.inline("🚫 Force Join", "edit_msg:FORCE_JOIN"), BTN.inline("🛠 Maintenance", "edit_msg:MAINTENANCE_MODE")],
    [BTN.inline("🔙 Back", "admin_settings")]
  ] })
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

async function getMessages() {
  let dbMsgs = await prisma.setting.findUnique({ where: { key: 'CUSTOM_MESSAGES' } });
  
  // FIRST START RULE: Automatically copy hardcoded message into database if it doesn't exist
  if (!dbMsgs) {
    dbMsgs = await prisma.setting.create({ 
      data: { key: 'CUSTOM_MESSAGES', value: JSON.stringify(MSG) } 
    });
  }
  
  return { ...MSG, ...JSON.parse(dbMsgs.value) };
}

async function getPaymentSettings() {
  const s = await prisma.setting.findUnique({ where: { key: 'PAYMENT_SETTINGS' } });
  return s ? JSON.parse(s.value) : { upiId: "Skywardstudio@ybl", qrFileId: null, minDeposit: 10 };
}

async function savePaymentSettings(newSet) {
  await prisma.setting.upsert({
    where: { key: 'PAYMENT_SETTINGS' },
    update: { value: JSON.stringify(newSet) },
    create: { key: 'PAYMENT_SETTINGS', value: JSON.stringify(newSet) }
  });
}

async function getSysSettings() {
  const s = await prisma.setting.findUnique({ where: { key: 'SYSTEM_SETTINGS' } });
  return s ? JSON.parse(s.value) : { referralBonus: 0.5 };
}

async function getSmsSettings() {
  const s = await prisma.setting.findUnique({ where: { key: 'SMS_SETTINGS' } });
  if (s) return JSON.parse(s.value);
  const def = { countryId: "1", operatorId: "any", serviceId: "tw", maxPrice: 15, timeout: 300, interval: 10 };
  const n = await prisma.setting.create({ data: { key: 'SMS_SETTINGS', value: JSON.stringify(def) } });
  return JSON.parse(n.value);
}

async function getBypassUsers() {
  const s = await prisma.setting.findUnique({ where: { key: 'FORCE_JOIN_BYPASS' } });
  return s ? JSON.parse(s.value) : [];
}

async function updateBypassUsers(list) {
  await prisma.setting.upsert({
    where: { key: 'FORCE_JOIN_BYPASS' },
    update: { value: JSON.stringify(list) },
    create: { key: 'FORCE_JOIN_BYPASS', value: JSON.stringify(list) }
  });
}

async function isBypassed(tgId) {
  const list = await getBypassUsers();
  return list.includes(String(tgId));
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
  if (await isBypassed(userId)) return true;
  
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
  const M = await getMessages();
  if (await isBanned(userId)) { await tg.sendMessage(chatId, M.BANNED); return false; }
  const sys = await getSysSettings();
  if (sys?.isMaintenanceMode && !(await isAdmin(userId))) { await tg.sendMessage(chatId, M.MAINTENANCE_MODE); return false; }
  
  const isJoined = await checkForceJoin(userId);
  if (!isJoined) {
    const channel = sys?.forceJoinChannel || CONFIG.telegram.forceJoinChannel;
    const group = sys?.forceJoinGroup || CONFIG.telegram.forceJoinGroup;
    await tg.sendMessage(chatId, M.FORCE_JOIN, KB.forceJoin(channel, group));
    return false;
  }
  return true;
}

async function processReferral(newUserId, referrerPayload) {
  if (!/^\d+$/.test(referrerPayload)) return false;
  const referrerId = BigInt(referrerPayload);
  const newTgId = BigInt(newUserId);
  if (referrerId === newTgId) return false;

  const res = await prisma.$transaction(async (tx) => {
    const referrer = await tx.user.findUnique({ where: { telegramId: referrerId } });
    const newUser = await tx.user.findUnique({ where: { telegramId: newTgId } });
    if (!referrer || !newUser) return false;

    // Verify Force Join before counting referral
    if (!(await checkForceJoin(newTgId))) return false;

    const existing = await tx.referral.findUnique({ where: { referredId: newUser.id } });
    if (existing) return false;

    const setObj = await tx.setting.findUnique({ where: { key: 'SYSTEM_SETTINGS' } });
    const sys = setObj ? JSON.parse(setObj.value) : { referralBonus: 0.5 };
    const bonus = Number(sys.referralBonus || 0.5);

    await tx.referral.create({ data: { referrerId: referrer.id, referredId: newUser.id, bonus } });
    await tx.user.update({
      where: { id: referrer.id },
      data: { totalReferrals: { increment: 1 }, referralEarnings: { increment: bonus }, balance: { increment: bonus } }
    });

    await tx.walletHistory.create({
      data: { userId: referrer.id, type: 'REFERRAL_BONUS', amount: bonus, description: `Referral bonus for ${newUserId}` }
    });
    
    return { success: true, referrerTgId: referrer.telegramId.toString(), bonus };
  });

  if (res && res.success) {
    const M = await getMessages();
    await tg.sendMessage(res.referrerTgId, M.REF_COMPLETED.replace('{referralReward}', res.bonus)).catch(()=>{});
    return true;
  }
  return false;
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
  const processedOtps = new Set();
  const M = await getMessages();

  try {
    while (true) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'ACTIVE') return;

      if (new Date() >= order.expiresAt) break;

      const stat = await getSmsStatus(activationId);
      const code = stat.code || stat.otpCode || stat.text;
      
      if (stat.status === 'RECEIVED' && code && !processedOtps.has(code)) {
        processedOtps.add(code);
        
        const otpsReceived = order.otpCount + 1;
        await prisma.order.update({ where: { id: orderId }, data: { otpCount: otpsReceived } });

        await tg.sendMessage(chatId, M.OTP_RECEIVED.replace('{count}', otpsReceived).replace('{otp}', esc(code)));

        try {
          await fetch(buildSmsUrl({ action: 'setStatus', status: 3, id: activationId }));
        } catch (e) {}

        if (otpsReceived >= 3) {
          await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
          if (msgId) await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
          if (M.MAX_OTP_REACHED) await tg.sendMessage(chatId, M.MAX_OTP_REACHED).catch(()=>{});
          return;
        }
      }
      
      await new Promise(r => setTimeout(r, interval * 1000));
    }

    const fOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!fOrder || fOrder.status !== 'ACTIVE') return;

    if (fOrder.otpCount === 0) {
      await cancelSms(activationId);
      
      await prisma.$transaction([
        prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } }),
        prisma.user.update({ where: { id: userDbId }, data: { balance: { increment: price } } })
      ]);

      if (msgId) {
        await tg.editMessage(chatId, msgId, M.OTP_TIMEOUT_REFUND, { inline_keyboard: [] }).catch(()=>{});
      } else {
        await tg.sendMessage(chatId, M.OTP_TIMEOUT_REFUND).catch(()=>{});
      }
    } else {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      
      if (msgId) {
        await tg.editMessage(chatId, msgId, M.OTP_TIMEOUT_NO_REFUND, { inline_keyboard: [] }).catch(()=>{});
      } else {
        await tg.sendMessage(chatId, M.OTP_TIMEOUT_NO_REFUND).catch(()=>{});
      }
    }
  } catch (error) { console.error(`[POLLING ERR] Order: ${orderId}`, error); }
}

// ==========================================
// 6. WEBHOOK ROUTES & HANDLERS
// ==========================================

async function handleUpdate(update) {
  const M = await getMessages();

  // --- MESSAGE ROUTER ---
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    const userId = msg.from?.id;
    if (!chatId || !userId) return;

    const admin = await isAdmin(userId);

    // Handle Photos (QR Code Upload or Payment Screenshots)
    if (msg.photo?.length > 0) {
      if (!(await verifyAccess(chatId, userId))) return;

      // Handle QR Code upload for admin
      if (admin && msg.reply_to_message?.text?.includes('Send the QR Code image')) {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const pSet = await getPaymentSettings();
        pSet.qrFileId = photoId;
        await savePaymentSettings(pSet);
        return await tg.sendMessage(chatId, '✅ QR Code updated successfully.', { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
      }

      // Normal payment logic
      const amountStr = msg.caption ? msg.caption.trim() : '';
      const amount = Number(amountStr);

      if (!amountStr || isNaN(amount) || amount <= 0) {
        server.log.error(`[PAYMENT ERROR] Missing or invalid amount in photo caption for user ${userId}`);
        await tg.sendMessage(chatId, M.PAYMENT_CAPTION_ERROR);
        return;
      }
      
      const pSet = await getPaymentSettings();
      if (amount < pSet.minDeposit) {
        return await tg.sendMessage(chatId, `❌ The minimum deposit amount is ₹${pSet.minDeposit}.`);
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
      return await tg.sendMessage(chatId, M.PAYMENT_SUBMITTED);
    }

    if (!msg.text) return;
    const txt = msg.text.trim();

    // Handle Admin ForceReplies
    if (admin && msg.reply_to_message?.text) {
      const promptText = msg.reply_to_message.text;

      if (promptText.includes('Enter new UPI ID:')) {
        const pSet = await getPaymentSettings();
        pSet.upiId = txt;
        await savePaymentSettings(pSet);
        return await tg.sendMessage(chatId, `✅ UPI ID updated to <code>${esc(txt)}</code>.`, { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
      }

      if (promptText.includes('Enter Minimum Deposit amount:')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.', { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
        const pSet = await getPaymentSettings();
        pSet.minDeposit = amt;
        await savePaymentSettings(pSet);
        return await tg.sendMessage(chatId, `✅ Minimum Deposit updated to <code>₹${amt}</code>.`, { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
      }

      if (promptText.includes('Enter new message for')) {
        const keyMatch = promptText.match(/\[KEY:\s*(\w+)\]/);
        if (!keyMatch) return;
        const key = keyMatch[1];
        
        const dbMsgs = await prisma.setting.findUnique({ where: { key: 'CUSTOM_MESSAGES' } });
        const customMsgs = dbMsgs ? JSON.parse(dbMsgs.value) : {};
        customMsgs[key] = txt; 
        
        await prisma.setting.upsert({
           where: { key: 'CUSTOM_MESSAGES' },
           update: { value: JSON.stringify(customMsgs) },
           create: { key: 'CUSTOM_MESSAGES', value: JSON.stringify(customMsgs) }
        });
        return await tg.sendMessage(chatId, `✅ Message for <b>${key}</b> updated.`, { inline_keyboard: [[BTN.inline("🔙 Back to Editor", "msg_editor")]] });
      }

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
        return await tg.sendMessage(chatId, `✅ Broadcast finished. Sent to ${sent}/${allUsers.length} users.`, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
      }

      if (promptText.includes('Enter Telegram User ID to manage:')) {
        if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_users_menu")]] });
        const targetTgId = BigInt(txt);
        const uTarget = await prisma.user.findUnique({ where: { telegramId: targetTgId } });
        if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found in database.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_users_menu")]] });
        
        const isBan = await isBanned(targetTgId);
        
        const totOrders = await prisma.order.count({ where: { userId: uTarget.id } });
        
        const totSpentAgg = await prisma.order.aggregate({
           _sum: { price: true },
           where: { userId: uTarget.id, status: { in: ['ACTIVE', 'COMPLETED'] } }
        });
        const totSpent = Number(totSpentAgg._sum.price || 0);

        const totDepositsAgg = await prisma.walletHistory.aggregate({
           _sum: { amount: true },
           where: { userId: uTarget.id, type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS'] } }
        });
        const totDeposits = Number(totDepositsAgg._sum.amount || 0);
        
        const fn = uTarget.firstName || '';
        const ln = uTarget.lastName || '';
        const name = `${fn} ${ln}`.trim() || 'Not Set';
        const username = uTarget.username ? `@${uTarget.username}` : 'Not Set';

        const info = `👤 <b>User Information</b>\n\n🆔 <b>User ID:</b>\n<code>${txt}</code>\n\n👤 <b>Username:</b>\n${esc(username)}\n\n📝 <b>Name:</b>\n${esc(name)}\n\n💰 <b>Current Balance:</b>\n₹${esc(uTarget.balance)}\n\n💳 <b>Total Deposited:</b>\n₹${totDeposits}\n\n🛒 <b>Total Spent:</b>\n₹${totSpent}\n\n📦 <b>Total Orders:</b>\n${totOrders}\n\n👥 <b>Total Referrals:</b>\n${uTarget.totalReferrals}\n\n📅 <b>Joined:</b>\n${new Date(uTarget.createdAt).toLocaleDateString('en-IN')}`;
        
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
        return await tg.sendMessage(chatId, `✅ SMS Setting <code>${field}</code> updated to <code>${txt}</code>.`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
      }

      if (promptText.includes('Enter new Number Price:')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid price.', { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
        const cur = await getSmsSettings();
        const newSet = { ...cur, maxPrice: amt };
        await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(newSet) } });
        return await tg.sendMessage(chatId, `✅ <b>Number Price</b> updated to <code>₹${amt}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
      }

      if (promptText.includes('Enter new Referral Reward:')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid reward amount.', { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
        const cur = await getSysSettings();
        const newSet = { ...cur, referralBonus: amt };
        await prisma.setting.upsert({ where: { key: 'SYSTEM_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SYSTEM_SETTINGS', value: JSON.stringify(newSet) } });
        return await tg.sendMessage(chatId, `✅ <b>Referral Reward</b> updated to <code>₹${amt}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
      }
      
      if (promptText.includes('Send the Telegram User ID to bypass Force Join:')) {
        if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.', { inline_keyboard: [[BTN.inline("🔙 Back to Bypass Menu", "admin_bypass")]] });
        const list = await getBypassUsers();
        if (!list.includes(txt)) {
          list.push(txt);
          await updateBypassUsers(list);
        }
        return await tg.sendMessage(chatId, `✅ <b>User added successfully.</b>\n\nThis user can now use the bot without joining the Channel or Group.`, { inline_keyboard: [[BTN.inline("🔙 Back to Bypass Menu", "admin_bypass")]] });
      }

      if (promptText.includes('Send the Telegram User ID to remove from bypass:')) {
        if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.', { inline_keyboard: [[BTN.inline("🔙 Back to Bypass Menu", "admin_bypass")]] });
        let list = await getBypassUsers();
        if (list.includes(txt)) {
          list = list.filter(id => id !== txt);
          await updateBypassUsers(list);
          return await tg.sendMessage(chatId, `✅ <b>User removed successfully.</b>\n\nForce Join will now apply to this user again.`, { inline_keyboard: [[BTN.inline("🔙 Back to Bypass Menu", "admin_bypass")]] });
        } else {
          return await tg.sendMessage(chatId, '⚠️ User is not in the bypass list.', { inline_keyboard: [[BTN.inline("🔙 Back to Bypass Menu", "admin_bypass")]] });
        }
      }
    }

    if (txt.startsWith('/start')) {
      const payload = txt.split(' ')[1];
      await getUser(userId); // Ensure user is created/fetched first

      if (payload && /^\d+$/.test(payload) && payload !== String(userId)) {
        const userInDb = await prisma.user.findUnique({ where: { telegramId: BigInt(userId) } });
        if (userInDb) {
          const existingRef = await prisma.referral.findUnique({ where: { referredId: userInDb.id } });
          if (!existingRef && !pendingReferrals.has(userId)) {
            pendingReferrals.set(userId, payload);
            await tg.sendMessage(payload, M.REF_PENDING).catch(()=>{});
          }
        }
      }
      
      if (!(await verifyAccess(chatId, userId))) return;

      if (pendingReferrals.has(userId)) {
        await processReferral(userId, pendingReferrals.get(userId));
        pendingReferrals.delete(userId);
      }

      return await tg.sendMessage(chatId, M.WELCOME, admin ? KB.adminMain : KB.main);
    }

    if (!(await verifyAccess(chatId, userId))) return;

    switch (txt) {
      case '🐦 Get Twitter Number':
        const uBuy = await getUser(userId);
        const act = await prisma.order.findFirst({ where: { userId: uBuy.id, status: 'ACTIVE' } });
        if (act) return await tg.sendMessage(chatId, M.PLEASE_WAIT);
        
        const smsSet = await getSmsSettings();
        if (uBuy.balance.toNumber() < smsSet.maxPrice) return await tg.sendMessage(chatId, M.NO_BALANCE);
        
        const loadMsg = await tg.sendMessage(chatId, M.PURCHASING);
        const pr = await purchaseSms(smsSet);
        if (!pr.success) return await tg.editMessage(chatId, loadMsg?.message_id, M.NUMBER_FAILED);

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

          const successMsg = M.NUMBER_SUCCESS
            .replace('{phoneNumber}', esc(rawPhone))
            .replace('{amount}', smsSet.maxPrice);

          await tg.editMessage(chatId, loadMsg?.message_id, successMsg, KB.cancel(pr.activationId));
          startOtpPolling(chatId, uBuy.id, ord.id, pr.activationId, pr.phoneNumber, smsSet.maxPrice, loadMsg?.message_id, smsSet.interval);
        } catch (err) {
          await cancelSms(pr.activationId);
          if (err.message === 'INSUFFICIENT_BALANCE') return await tg.editMessage(chatId, loadMsg?.message_id, M.NO_BALANCE);
          return await tg.editMessage(chatId, loadMsg?.message_id, M.NUMBER_FAILED);
        }
        break;

      case '👤 My Account':
        const uAcc = await getUser(userId);
        const textAcc = M.MY_ACCOUNT.replace('{userId}', userId).replace('{firstName}', esc(uAcc.firstName||'')).replace('{username}', esc(uAcc.username?'@'+uAcc.username:'')).replace('{balance}', esc(uAcc.balance)).replace('{referrals}', uAcc.totalReferrals).replace('{date}', new Date(uAcc.createdAt).toLocaleDateString('en-IN'));
        await tg.sendMessage(chatId, textAcc);
        break;

      case '📜 Wallet History':
        const uHist = await getUser(userId);
        const txs = await prisma.walletHistory.findMany({ 
          where: { 
            userId: uHist.id,
            type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS'] } 
          }, 
          take: 10, 
          orderBy: { createdAt: 'desc' } 
        });
        if (!txs.length) return await tg.sendMessage(chatId, M.WALLET_EMPTY);
        let hTxt = "📜 <b>Wallet History</b>\n\n";
        txs.forEach(t => hTxt += `📅 <b>${new Date(t.createdAt).toLocaleDateString('en-IN')}</b>\n🔹 <b>Type:</b> ${esc(t.type)}\n💰 <b>Amount:</b> <code>${t.amount>0?'+':''}${esc(t.amount)}</code>\n📝 <b>Note:</b> <i>${esc(t.description)}</i>\n\n`);
        await tg.sendMessage(chatId, hTxt);
        break;

      case '💳 Add Balance':
        const pSet = await getPaymentSettings();
        const addBalTxt = M.ADD_BALANCE
           .replace('{upi}', esc(pSet.upiId))
           .replace('{minimumDeposit}', pSet.minDeposit);
           
        if (pSet.qrFileId) {
           await tg.sendPhoto(chatId, pSet.qrFileId, { caption: addBalTxt });
        } else {
           await tg.sendMessage(chatId, addBalTxt);
        }
        break;

      case '🎁 Refer & Earn':
        const uRef = await getUser(userId);
        const sysRef = await getSysSettings();
        const rLink = `https://t.me/${CONFIG.telegram.botUsername}?start=${userId}`;
        const rTxt = M.REFER_INFO.replace('{amount}', esc(sysRef?.referralBonus || 0.5)).replace('{referralLink}', esc(rLink)) + `\n\n📊 <b>Your Stats</b>\n👥 <b>Referrals:</b> <code>${uRef.totalReferrals}</code>\n💰 <b>Earnings:</b> <code>₹${esc(uRef.referralEarnings)}</code>`;
        await tg.sendMessage(chatId, rTxt);
        break;

      case '📞 Support':
        const sSup = await getSysSettings();
        await tg.sendMessage(chatId, M.SUPPORT, KB.support(sSup?.supportUsername || CONFIG.telegram.supportUsername));
        break;

      case '📊 Statistics':
        if (!admin) return;
        const totU = await prisma.user.count();
        const actO = await prisma.order.count({ where: { status: 'ACTIVE' } });
        const cmpO = await prisma.order.count({ where: { status: 'COMPLETED' } });
        const rev = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'APPROVED' } });
        const statMsg = `📊 <b>Bot Statistics</b>\n\n👥 <b>Total Users:</b> <code>${totU}</code>\n🔄 <b>Active Orders:</b> <code>${actO}</code>\n✅ <b>Completed Orders:</b> <code>${cmpO}</code>\n💰 <b>Total Revenue:</b> <code>₹${rev._sum.amount || 0}</code>`;
        await tg.sendMessage(chatId, statMsg, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
        break;

      case '👥 Users':
        if (!admin) return;
        await tg.sendMessage(chatId, "👥 <b>Users Menu</b>\n\nSelect an option below:", {
          inline_keyboard: [
            [BTN.inline("👤 User Lookup", "admin_user_lookup")],
            [BTN.inline("📊 All Users Wallet", "admin_all_users_page:1")],
            [BTN.inline("🔙 Back", "back_to_admin")]
          ]
        });
        break;

      case '💳 Payments':
        if (!admin) return;
        const pends = await prisma.payment.findMany({ where: { status: 'PENDING' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: true } });
        if (!pends.length) return await tg.sendMessage(chatId, '💳 No pending payments.', { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
        let pTxt = `💳 <b>Recent Pending Payments</b>\n\n`;
        pends.forEach(p => pTxt += `🧾 <b>ID:</b> <code>${p.id}</code>\n👤 <b>User:</b> <code>${p.user.telegramId}</code>\n📅 <b>Date:</b> <code>${new Date(p.createdAt).toLocaleDateString('en-IN')}</code>\n💰 <b>Amount:</b> <code>₹${esc(p.amount)}</code>\n\n`);
        await tg.sendMessage(chatId, pTxt, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
        break;

      case '🛒 Orders':
        if (!admin) return;
        const acts = await prisma.order.findMany({ where: { status: 'ACTIVE' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: true } });
        if (!acts.length) return await tg.sendMessage(chatId, '🛒 No active orders.', { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
        let oTxt = `🛒 <b>Recent Active Orders</b>\n\n`;
        acts.forEach(o => oTxt += `📱 <b>Number:</b> <code>${o.phoneNumber}</code>\n👤 <b>User:</b> <code>${o.user.telegramId}</code>\n🔑 <b>OTPs:</b> <code>${o.otpCount}</code>\n\n`);
        await tg.sendMessage(chatId, oTxt, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
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
    
    // Prevent duplicate processing entirely for the same callback ID
    if (answeredCallbacks.has(cb.id)) return;
    answeredCallbacks.add(cb.id);
    // Cleanup memory after 2 minutes (Telegram callbacks usually expire in ~15s anyway)
    setTimeout(() => answeredCallbacks.delete(cb.id), 120000); 

    // Answer immediately before ANY database queries, network requests, or logic
    try { 
      await tg.answerCallbackQuery(cb.id); 
    } catch (e) {
      // Silently ignore if already answered or expired (HTTP 400)
    }

    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;
    const userId = cb.from?.id;
    if (!chatId || !userId) return;

    const dataParts = cb.data ? cb.data.split(':') : [];
    const action = dataParts[0];
    const args = dataParts.slice(1);
    const admin = await isAdmin(userId);

    switch (action) {
      case 'verify_join':
        const isJoined = await checkForceJoin(userId);
        if (isJoined || admin) {
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          if (pendingReferrals.has(userId)) {
            await processReferral(userId, pendingReferrals.get(userId));
            pendingReferrals.delete(userId);
          }
          await tg.sendMessage(chatId, M.WELCOME, admin ? KB.adminMain : KB.main);
        } else {
          // Replaced answerCallbackQuery with sendMessage to prevent duplicate answer errors
          await tg.sendMessage(chatId, "❌ Please join BOTH the Channel and the Group to continue.");
        }
        break;

      case 'cancel_order':
        const uCan = await getUser(userId);
        const oCan = await prisma.order.findFirst({ where: { userId: uCan.id, status: 'ACTIVE', activationId: args[0] } });
        if (!oCan) return await tg.editMessage(chatId, msgId, M.UNKNOWN_ERROR, { inline_keyboard: [] });
        
        await cancelSms(args[0]);

        if (oCan.otpCount === 0) {
          await prisma.$transaction([
            prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } }),
            prisma.user.update({ where: { id: uCan.id }, data: { balance: { increment: oCan.price } } })
          ]);
          await tg.editMessage(chatId, msgId, M.ORDER_CANCELLED_REFUND, { inline_keyboard: [] });
        } else {
          await prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } });
          await tg.editMessage(chatId, msgId, M.ORDER_CANCELLED_NO_REFUND, { inline_keyboard: [] });
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
        await tg.sendMessage(targetTgId.toString(), M.PAYMENT_APPROVED.replace('{amount}', esc(amt)));
        break;

      case 'reject_payment':
        if (!admin) return;
        await prisma.payment.update({ where: { id: args[0] }, data: { status: 'REJECTED' } });
        await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] });
        await tg.sendMessage(chatId, `❌ Payment <code>${args[0]}</code> Rejected.`);
        await tg.sendMessage(args[1], M.PAYMENT_REJECTED);
        break;

      case 'admin_users_menu':
        if (!admin) return;
        await tg.editMessage(chatId, msgId, "👥 <b>Users Menu</b>\n\nSelect an option below:", {
          inline_keyboard: [
            [BTN.inline("👤 User Lookup", "admin_user_lookup")],
            [BTN.inline("📊 All Users Wallet", "admin_all_users_page:1")],
            [BTN.inline("🔙 Back", "back_to_admin")]
          ]
        }).catch(()=>{});
        break;

      case 'admin_user_lookup':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '👤 Enter Telegram User ID to manage:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'admin_all_users_page':
        if (!admin) return;
        const page = parseInt(args[0]) || 1;
        
        const allUsers = await prisma.user.findMany();
        const userStats = new Map();
        
        for (const u of allUsers) {
          const fn = u.firstName || '';
          const ln = u.lastName || '';
          userStats.set(u.id, {
            telegramId: u.telegramId.toString(),
            name: `${fn} ${ln}`.trim() || 'Not Set',
            username: u.username ? `@${u.username}` : 'Not Set',
            balance: Number(u.balance || 0),
            deposited: 0,
            spent: 0,
            orders: 0
          });
        }

        const allOrders = await prisma.order.findMany({
          select: { userId: true, price: true, status: true }
        });
        for (const o of allOrders) {
          if (userStats.has(o.userId)) {
            userStats.get(o.userId).orders += 1;
            if (o.status === 'ACTIVE' || o.status === 'COMPLETED') {
              userStats.get(o.userId).spent += Number(o.price || 0);
            }
          }
        }

        const validDeposits = await prisma.walletHistory.findMany({
          where: { type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS'] } },
          select: { userId: true, amount: true }
        });
        for (const d of validDeposits) {
          if (userStats.has(d.userId)) {
            userStats.get(d.userId).deposited += Number(d.amount || 0);
          }
        }

        const sortedUsers = Array.from(userStats.values()).sort((a, b) => b.spent - a.spent);
        
        const limit = 20;
        const totalPages = Math.ceil(sortedUsers.length / limit) || 1;
        const validPage = Math.max(1, Math.min(page, totalPages));
        const startIdx = (validPage - 1) * limit;
        const endIdx = startIdx + limit;
        const pageUsers = sortedUsers.slice(startIdx, endIdx);

        let msgTxt = `📊 <b>All Users Wallet (Page ${validPage}/${totalPages})</b>\n\n`;
        let rank = startIdx + 1;
        for (const u of pageUsers) {
          msgTxt += `${rank}.\n`;
          msgTxt += `👤 <b>Name:</b> ${esc(u.name)}\n`;
          msgTxt += `👤 <b>Username:</b> ${esc(u.username)}\n`;
          msgTxt += `🆔 <b>User ID:</b> <code>${u.telegramId}</code>\n`;
          msgTxt += `💰 <b>Balance:</b> ₹${u.balance}\n`;
          msgTxt += `💳 <b>Deposited:</b> ₹${u.deposited}\n`;
          msgTxt += `🛒 <b>Spent:</b> ₹${u.spent}\n`;
          msgTxt += `📦 <b>Orders:</b> ${u.orders}\n`;
          msgTxt += `━━━━━━━━━━━━━━━\n\n`;
          rank++;
        }

        const pageButtons = [];
        if (validPage > 1) pageButtons.push(BTN.inline("⬅️ Previous", `admin_all_users_page:${validPage - 1}`));
        if (validPage < totalPages) pageButtons.push(BTN.inline("➡️ Next", `admin_all_users_page:${validPage + 1}`));
        
        const userKbd = [];
        if (pageButtons.length > 0) userKbd.push(pageButtons);
        userKbd.push([BTN.inline("🔙 Back", "admin_users_menu")]);

        await tg.editMessage(chatId, msgId, msgTxt, { inline_keyboard: userKbd }).catch(()=>{});
        break;

      case 'admin_settings':
        if (!admin) return;
        await tg.editMessage(chatId, msgId, "⚙️ <b>System Settings</b>", KB.adminSettings());
        break;
        
      case 'pay_settings':
        if (!admin) return;
        await tg.editMessage(chatId, msgId, "💳 <b>Payment Settings</b>\n\nConfigure UPI, QR code, and minimum deposit.", {
          inline_keyboard: [
            [BTN.inline("🖼 Upload QR Code", "pay_set_qr"), BTN.inline("🏦 Change UPI ID", "pay_set_upi")],
            [BTN.inline("💵 Minimum Deposit", "pay_set_min"), BTN.inline("👀 Preview Payment", "pay_preview")],
            [BTN.inline("🔙 Back", "admin_settings")]
          ]
        });
        break;
        
      case 'pay_set_qr':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '🖼 Send the QR Code image to save it in the database:', { reply_markup: { force_reply: true, selective: true } });
        break;
        
      case 'pay_set_upi':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '🏦 Enter new UPI ID:', { reply_markup: { force_reply: true, selective: true } });
        break;
        
      case 'pay_set_min':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '💵 Enter Minimum Deposit amount:', { reply_markup: { force_reply: true, selective: true } });
        break;
        
      case 'pay_preview':
        if (!admin) return;
        const previewSet = await getPaymentSettings();
        const previewTxt = M.ADD_BALANCE
           .replace('{upi}', esc(previewSet.upiId))
           .replace('{minimumDeposit}', previewSet.minDeposit);
        
        if (previewSet.qrFileId) {
           await tg.sendPhoto(chatId, previewSet.qrFileId, { caption: previewTxt });
        } else {
           await tg.sendMessage(chatId, previewTxt);
        }
        break;
        
      case 'msg_editor':
        if (!admin) return;
        await tg.editMessage(chatId, msgId, "💬 <b>Message Editor</b>\n\nSelect a message to edit. Using variables like {upi} is supported where applicable.", KB.messageEditor());
        break;
        
      case 'edit_msg':
        if (!admin) return;
        const key = args[0];
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        const currentMsg = M[key] || MSG[key];
        await tg.sendMessage(chatId, `Current message:\n\n${currentMsg}`);
        await tg.sendMessage(chatId, `📝 Enter new message for ${key}:\n(You can use HTML tags)\n\n[KEY: ${key}]`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'admin_bypass':
        if (!admin) return;
        const bUsers = await getBypassUsers();
        await tg.editMessage(chatId, msgId, `🚫 <b>Force Join Bypass</b>\n\nCurrent Bypass Users: <code>${bUsers.length}</code>`, KB.bypassMenu());
        break;

      case 'add_bypass':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '🚫 Send the Telegram User ID to bypass Force Join:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'remove_bypass':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '🚫 Send the Telegram User ID to remove from bypass:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'view_bypass':
        if (!admin) return;
        const list = await getBypassUsers();
        if (list.length === 0) {
          await tg.editMessage(chatId, msgId, "🚫 <b>Force Join Bypass List</b>\n\nNo users bypassed.", KB.bypassMenu());
        } else {
          let msg = "🚫 <b>Force Join Bypass List</b>\n\n";
          list.forEach(id => msg += `• <code>${id}</code>\n`);
          await tg.editMessage(chatId, msgId, msg, KB.bypassMenu());
        }
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
        await tg.sendMessage(chatId, `📄 <b>Current Config</b>\nCountry: <code>${smsConf.countryId}</code>\nOperator: <code>${smsConf.operatorId}</code>\nService: <code>${smsConf.serviceId}</code>\nPrice: <code>₹${smsConf.maxPrice}</code>\nTimeout: <code>${smsConf.timeout}s</code>\nInterval: <code>${smsConf.interval}s</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to SMS Settings", "admin_sms_settings")]] });
        break;

      case 'admin_sms_edit':
        if (!admin) return;
        await tg.sendMessage(chatId, `📡 Enter new value for SMS setting: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'admin_num_price':
        if (!admin) return;
        const sPrice = await getSmsSettings();
        await tg.editMessage(chatId, msgId, `💰 <b>Number Price</b>\n\nCurrent Price: <code>₹${sPrice.maxPrice}</code>`, KB.numPrice());
        break;

      case 'admin_ref_reward':
        if (!admin) return;
        const sSys = await getSysSettings();
        await tg.editMessage(chatId, msgId, `🎁 <b>Referral Reward</b>\n\nCurrent Reward: <code>₹${sSys.referralBonus}</code>`, KB.refReward());
        break;

      case 'edit_num_price':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '💰 Enter new Number Price:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'edit_ref_reward':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '🎁 Enter new Referral Reward:', { reply_markup: { force_reply: true, selective: true } });
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

      case 'back_to_admin':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, "🔧 <b>Admin Panel</b>", KB.adminMain);
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
// 8. SERVER STARTUP, RESUME & SHUTDOWN
// ==========================================

async function resumeActiveOrders() {
  try {
    const activeOrders = await prisma.order.findMany({ where: { status: 'ACTIVE' }, include: { user: true } });
    if (activeOrders.length === 0) return;
    
    const smsSet = await getSmsSettings();
    for (const order of activeOrders) {
      // Re-initialize polling. msgId is null since it's lost from RAM, but text sending fallback is built-in.
      startOtpPolling(
        order.user.telegramId.toString(), 
        order.userId, 
        order.id, 
        order.activationId, 
        order.phoneNumber, 
        order.price, 
        null, 
        smsSet.interval || 10
      );
    }
    server.log.info(`[SERVER] 🔄 Resumed polling for ${activeOrders.length} active orders.`);
  } catch (error) {
    server.log.error('[SERVER] ⚠️ Failed to resume active orders', error);
  }
}

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
    
    // Trigger message database initialization on boot
    await getMessages();

    const host = CONFIG.server.host || '0.0.0.0';
    await server.listen({ port: CONFIG.server.port, host });
    server.log.info(`[SERVER] 🚀 Running on http://${host}:${CONFIG.server.port}`);

    // Resume any orders that were left active before a restart/redeploy
    await resumeActiveOrders();

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
