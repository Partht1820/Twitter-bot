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

// Prisma initialization with slow query logging extension (Requirement 5)
const basePrisma = globalThis.prisma || new PrismaClient();
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        const start = performance.now();
        const result = await query(args);
        const time = performance.now() - start;
        if (time > 300) {
          console.warn(`[PRISMA SLOW QUERY] ${model}.${operation} took ${time.toFixed(2)}ms`);
        }
        return result;
      }
    }
  }
});
if (process.env.NODE_ENV !== 'production') globalThis.prisma = basePrisma;

const server = Fastify({ logger: true, trustProxy: true });
server.register(formbody);

// In-memory store for pending referrals awaiting Force Join verification
const pendingReferrals = new Map();

// In-memory store to track and prevent duplicate callback queries
const answeredCallbacks = new Set();

// In-memory store to prevent duplicate OTP polling loops
const activePollingOrders = new Set();

// ==========================================
// 1.5. IN-MEMORY CACHE IMPLEMENTATION
// ==========================================

const CACHE = {
  messages: { data: null, expiry: 0 },
  partner: { data: null, expiry: 0 },
  reseller: { data: null, expiry: 0 },
  sys: { data: null, expiry: 0 },
  sms: { data: null, expiry: 0 },
  pay: { data: null, expiry: 0 },
  forceJoin: new Map() // telegramId -> { status: boolean, expiry: number }
};

// ==========================================
// 2. CONSTANTS: MESSAGES & KEYBOARDS
// ==========================================

const MSG = {
  WELCOME: "👋 <b>Welcome to our Premium OTP Service!</b>\n\nPlease use the menu below to navigate.",
  ACTIVE_ORDER_EXISTS: "⚠️ <b>Active Number Detected</b>\n\nYou already have an active Twitter number.\n\nBefore purchasing another number, please:\n\n• Cancel your current number\n\nOR\n\n• Wait until all 3 OTPs are received\n\nOR\n\n• Wait for the number to expire automatically.\n\nYou cannot purchase another number until the current order is finished.",
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
  main: (isPartner, isReseller) => {
    const kb = [
      [{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], 
      [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], 
      [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}]
    ];
    if (isPartner) kb.push([{text: "🤝 Partner Panel"}]);
    if (isReseller) kb.push([{text: "👑 Reseller Panel"}]);
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
  },
  adminMain: { keyboard: [
    [{text: "🐦 Get Twitter Number"}, {text: "👤 My Account"}], 
    [{text: "📜 Wallet History"}, {text: "💳 Add Balance"}], 
    [{text: "🎁 Refer & Earn"}, {text: "📞 Support"}], 
    [{text: "📊 Statistics"}, {text: "👥 Users"}, {text: "💳 Payments"}], 
    [{text: "🛒 Orders"}, {text: "📢 Broadcast"}, {text: "⚙️ Settings"}],
    [{text: "🤝 Partners"}, {text: "👑 Reseller Management"}]
  ], resize_keyboard: true, is_persistent: true },
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

function getChatIdForApi(val) {
  if (!val) return null;
  if (val.includes('t.me/')) {
      const parts = val.split('t.me/');
      let id = parts[1].replace(/\//g, '');
      if (id.startsWith('+') || id.startsWith('joinchat')) return val; 
      return '@' + id;
  }
  if (!val.startsWith('@') && !val.startsWith('-')) return '@' + val;
  return val;
}

// ==========================================
// 3. DATABASE HELPER FUNCTIONS
// ==========================================

async function markUserActive(userId) {
  if (!userId) return;
  try {
    await prisma.user.updateMany({
      where: { telegramId: BigInt(userId) },
      data: { updatedAt: new Date() }
    });
  } catch (e) {}
}

async function getPartnerData() {
  if (Date.now() < CACHE.partner.expiry && CACHE.partner.data) return CACHE.partner.data;
  const s = await prisma.setting.findUnique({ where: { key: 'PARTNER_DATA' } });
  const data = s ? JSON.parse(s.value) : {
    partners: {}, // { "tgId": { commission: 20, earned: 0, paid: 0, pending: 0, active: true, upi: "" } }
    users: {},    // { "userTgId": "partnerTgId" }
    stats: {}     // { "partnerTgId": { joined: 0, deposits: 0 } }
  };
  CACHE.partner.data = data;
  CACHE.partner.expiry = Date.now() + 30 * 1000;
  return data;
}

async function savePartnerData(data) {
  await prisma.setting.upsert({
    where: { key: 'PARTNER_DATA' },
    update: { value: JSON.stringify(data) },
    create: { key: 'PARTNER_DATA', value: JSON.stringify(data) }
  });
  CACHE.partner.expiry = 0; // Invalidate cache
}

async function getResellerData() {
  if (Date.now() < CACHE.reseller.expiry && CACHE.reseller.data) return CACHE.reseller.data;
  const s = await prisma.setting.findUnique({ where: { key: 'RESELLER_DATA' } });
  const data = s ? JSON.parse(s.value) : {
    resellers: {}, // { "tgId": { price: 2.50, earned: 0, paid: 0, pending: 0, active: true, upi: "", welcomeMsg: "", channel: "", group: "" } }
    users: {},     // { "userTgId": "resellerTgId" }
    stats: {}      // { "resellerTgId": { joined: 0, deposits: 0, sales: 0 } }
  };
  CACHE.reseller.data = data;
  CACHE.reseller.expiry = Date.now() + 30 * 1000;
  return data;
}

async function saveResellerData(data) {
  await prisma.setting.upsert({
    where: { key: 'RESELLER_DATA' },
    update: { value: JSON.stringify(data) },
    create: { key: 'RESELLER_DATA', value: JSON.stringify(data) }
  });
  CACHE.reseller.expiry = 0; // Invalidate cache
}

async function getMessages() {
  if (Date.now() < CACHE.messages.expiry && CACHE.messages.data) return CACHE.messages.data;
  let dbMsgs = await prisma.setting.findUnique({ where: { key: 'CUSTOM_MESSAGES' } });
  
  if (!dbMsgs) {
    dbMsgs = await prisma.setting.create({ 
      data: { key: 'CUSTOM_MESSAGES', value: JSON.stringify(MSG) } 
    });
  }
  
  const data = { ...MSG, ...JSON.parse(dbMsgs.value) };
  CACHE.messages.data = data;
  CACHE.messages.expiry = Date.now() + 5 * 60 * 1000;
  return data;
}

async function getPaymentSettings() {
  if (Date.now() < CACHE.pay.expiry && CACHE.pay.data) return CACHE.pay.data;
  const s = await prisma.setting.findUnique({ where: { key: 'PAYMENT_SETTINGS' } });
  const data = s ? JSON.parse(s.value) : { upiId: "Skywardstudio@ybl", qrFileId: null, minDeposit: 10 };
  CACHE.pay.data = data;
  CACHE.pay.expiry = Date.now() + 30 * 1000;
  return data;
}

async function savePaymentSettings(newSet) {
  await prisma.setting.upsert({
    where: { key: 'PAYMENT_SETTINGS' },
    update: { value: JSON.stringify(newSet) },
    create: { key: 'PAYMENT_SETTINGS', value: JSON.stringify(newSet) }
  });
  CACHE.pay.expiry = 0; // Invalidate cache
}

async function getSysSettings() {
  if (Date.now() < CACHE.sys.expiry && CACHE.sys.data) return CACHE.sys.data;
  const s = await prisma.setting.findUnique({ where: { key: 'SYSTEM_SETTINGS' } });
  const data = s ? JSON.parse(s.value) : { referralBonus: 0.5 };
  CACHE.sys.data = data;
  CACHE.sys.expiry = Date.now() + 30 * 1000;
  return data;
}

async function getSmsSettings() {
  if (Date.now() < CACHE.sms.expiry && CACHE.sms.data) return CACHE.sms.data;
  const s = await prisma.setting.findUnique({ where: { key: 'SMS_SETTINGS' } });
  let data;
  if (s) {
    data = JSON.parse(s.value);
  } else {
    const def = { countryId: "1", operatorId: "any", serviceId: "tw", maxPrice: 15, timeout: 300, interval: 10 };
    const n = await prisma.setting.create({ data: { key: 'SMS_SETTINGS', value: JSON.stringify(def) } });
    data = JSON.parse(n.value);
  }
  CACHE.sms.data = data;
  CACHE.sms.expiry = Date.now() + 30 * 1000;
  return data;
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

async function checkForceJoin(userId, admin, sys, rData) {
  if (admin) return true;
  if (await isBypassed(userId)) return true;

  const cached = CACHE.forceJoin.get(userId.toString());
  if (cached && cached.expiry > Date.now()) {
    return cached.status;
  }
  
  let isJoined = true;
  const rId = rData.users[userId.toString()];

  if (rId && rData.resellers[rId]) {
    const r = rData.resellers[rId];
    if (!r.channel && !r.group) {
       isJoined = true;
    } else {
      try {
        const checks = [];
        if (r.channel) {
           const cApi = getChatIdForApi(r.channel);
           checks.push(tg.getChatMember(cApi, userId));
        } else { checks.push(Promise.resolve(null)); }
        if (r.group) {
           const gApi = getChatIdForApi(r.group);
           checks.push(tg.getChatMember(gApi, userId));
        } else { checks.push(Promise.resolve(null)); }
        
        const [c, g] = await Promise.all(checks);
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        if (r.channel && !validStatuses.includes(c?.status)) isJoined = false;
        if (r.group && !validStatuses.includes(g?.status)) isJoined = false;
      } catch(e) { 
        server.log.error(`[FORCE JOIN RESELLER ERROR] Channel: ${r.channel} | Group: ${r.group} | Error: ${e.message}`);
        isJoined = false; 
      }
    }
  } else {
    if (sys?.forceJoinEnabled === false) {
       isJoined = true;
    } else {
      const channel = sys?.forceJoinChannel || CONFIG.telegram.forceJoinChannel;
      const group = sys?.forceJoinGroup || CONFIG.telegram.forceJoinGroup;

      if (!channel || !group) {
         isJoined = true;
      } else {
        try {
          const [c, g] = await Promise.all([
            tg.getChatMember(channel, userId),
            tg.getChatMember(group, userId)
          ]);
          const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
          isJoined = validStatuses.includes(c?.status) && validStatuses.includes(g?.status);
        } catch (e) {
          isJoined = false;
        }
      }
    }
  }

  CACHE.forceJoin.set(userId.toString(), { status: isJoined, expiry: Date.now() + 5 * 60 * 1000 });
  return isJoined;
}

async function verifyAccess(chatId, userId, admin, sys, M, rData) {
  if (await isBanned(userId)) { await tg.sendMessage(chatId, M.BANNED); return false; }
  if (sys?.isMaintenanceMode && !admin) { await tg.sendMessage(chatId, M.MAINTENANCE_MODE); return false; }
  
  const isJoined = await checkForceJoin(userId, admin, sys, rData);
  if (!isJoined) {
    let channel, group;
    const rId = rData.users[userId.toString()];

    if (rId && rData.resellers[rId]) {
       channel = rData.resellers[rId].channel;
       group = rData.resellers[rId].group;
    } else {
       channel = sys?.forceJoinChannel || CONFIG.telegram.forceJoinChannel;
       group = sys?.forceJoinGroup || CONFIG.telegram.forceJoinGroup;
    }

    let buttons = [];
    if (channel) buttons.push([BTN.url("📢 Join Channel", channel.startsWith('http') ? channel : `https://t.me/${channel.replace("@","")}`)]);
    if (group) buttons.push([BTN.url("👥 Join Group", group.startsWith('http') ? group : `https://t.me/${group.replace("@","")}`)]);
    buttons.push([BTN.inline("✅ I've Joined", "verify_join")]);

    await tg.sendMessage(chatId, M.FORCE_JOIN, { inline_keyboard: buttons });
    return false;
  }
  return true;
}

async function processReferral(newUserId, referrerPayload, admin, sys, rData) {
  if (!/^\d+$/.test(referrerPayload)) return false;
  const referrerId = BigInt(referrerPayload);
  const newTgId = BigInt(newUserId);
  if (referrerId === newTgId) return false;

  const res = await prisma.$transaction(async (tx) => {
    const referrer = await tx.user.findUnique({ where: { telegramId: referrerId } });
    const newUser = await tx.user.findUnique({ where: { telegramId: newTgId } });
    if (!referrer || !newUser) return false;

    // Verify Force Join before counting referral
    if (!(await checkForceJoin(newTgId, admin, sys, rData))) return false;

    const existing = await tx.referral.findUnique({ where: { referredId: newUser.id } });
    if (existing) return false;

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

async function fetchWithTimeout(url, options = {}) {
  const timeout = options.timeout || 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('API_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

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
    
    const res = await fetchWithTimeout(buildSmsUrl(params));
    const txt = (await res.text()).trim();
    if (txt.startsWith('ACCESS_NUMBER')) {
      const [, activationId, phoneNumber] = txt.split(':');
      return { success: true, activationId, phoneNumber };
    }
    return { success: false, error: txt };
  } catch (err) { 
    server.log.error(`[API ERROR] purchaseSms: ${err.message}`);
    return { success: false, error: err.message }; 
  }
}

async function getSmsStatus(activationId) {
  try {
    const res = await fetchWithTimeout(buildSmsUrl({ action: 'getStatus', id: activationId }));
    const txt = (await res.text()).trim();
    if (txt.startsWith('STATUS_OK')) return { status: 'RECEIVED', code: txt.split(':')[1] };
    return { status: txt };
  } catch (err) { 
    server.log.error(`[API ERROR] getSmsStatus: ${err.message}`);
    return { status: 'ERROR', error: err.message }; 
  }
}

async function cancelSms(activationId) {
  try {
    const res = await fetchWithTimeout(buildSmsUrl({ action: 'setStatus', status: 8, id: activationId }));
    return (await res.text()).trim().startsWith('ACCESS_CANCEL');
  } catch (err) { 
    server.log.error(`[API ERROR] cancelSms: ${err.message}`);
    return false; 
  }
}

// ==========================================
// 5. CORE BUSINESS LOGIC
// ==========================================

async function startOtpPolling(chatId, userDbId, orderId, activationId, phone, price, msgId, interval) {
  if (activePollingOrders.has(orderId)) return;
  activePollingOrders.add(orderId);
  server.log.info(`[POLL START] Started OTP polling for order: ${orderId}`);

  const processedOtps = new Set();
  
  try {
    const M = await getMessages();

    while (true) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'ACTIVE') break;

      if (new Date() >= order.expiresAt) break;

      const stat = await getSmsStatus(activationId);
      const code = stat.code || stat.otpCode || stat.text;
      
      if (stat.status === 'RECEIVED' && code && !processedOtps.has(code)) {
        processedOtps.add(code);
        
        const otpsReceived = order.otpCount + 1;
        await prisma.order.update({ where: { id: orderId }, data: { otpCount: otpsReceived } });

        await tg.sendMessage(chatId, M.OTP_RECEIVED.replace('{count}', otpsReceived).replace('{otp}', esc(code))).catch(()=>{});
        server.log.info(`[OTP RECEIVED] Order: ${orderId} | Count: ${otpsReceived}`);

        // --- RESELLER PROFIT LOGIC (UPDATED) ---
        if (otpsReceived === 1) {
           const rDataApprove = await getResellerData();
           const rId = rDataApprove.users[chatId];
           if (rId && rDataApprove.resellers[rId] && rDataApprove.resellers[rId].active) {
              if (!rDataApprove.stats[rId]) rDataApprove.stats[rId] = {joined:0, deposits:0, sales:0};
              rDataApprove.stats[rId].sales += 1;
              await saveResellerData(rDataApprove);

              const ptUser = await prisma.user.findUnique({ where: { id: userDbId } });
              const username = ptUser?.username ? `@${ptUser.username}` : ptUser?.telegramId.toString();

              const resMsg = `📦 <b>New Sale Made</b>\n\n👤 <b>User:</b>\n${esc(username)}\n\n💰 <b>Number Price:</b>\n₹${order.price.toFixed(2)}\n\n<i>(Profit was already credited to you when this user deposited balance)</i>`;
              await tg.sendMessage(rId, resMsg).catch(()=>{});
           }
        }
        // ------------------------------

        try {
          await fetchWithTimeout(buildSmsUrl({ action: 'setStatus', status: 3, id: activationId }));
        } catch (e) {
          server.log.error(`[API ERROR] setStatus (status 3): ${e.message}`);
        }

        if (otpsReceived >= 3) {
          await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
          if (msgId) await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
          if (M.MAX_OTP_REACHED) await tg.sendMessage(chatId, M.MAX_OTP_REACHED).catch(()=>{});
          break;
        }
      }
      
      await new Promise(r => setTimeout(r, interval * 1000));
    }

    const fOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!fOrder || fOrder.status !== 'ACTIVE') return;

    if (fOrder.otpCount === 0) {
      server.log.info(`[POLL TIMEOUT] Order: ${orderId} | Refunding`);
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
      server.log.info(`[POLL TIMEOUT] Order: ${orderId} | Completing (No Refund)`);
      await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      
      if (msgId) {
        await tg.editMessage(chatId, msgId, M.OTP_TIMEOUT_NO_REFUND, { inline_keyboard: [] }).catch(()=>{});
      } else {
        await tg.sendMessage(chatId, M.OTP_TIMEOUT_NO_REFUND).catch(()=>{});
      }
    }
  } catch (error) { 
    server.log.error(`[POLLING ERR] Order: ${orderId}`, error); 
  } finally {
    activePollingOrders.delete(orderId);
    server.log.info(`[POLL STOPPED] Order: ${orderId}`);
  }
}

// ==========================================
// 6. WEBHOOK ROUTES & HANDLERS
// ==========================================

async function handleUpdate(update) {
  const tStart = performance.now();
  const updateId = update.update_id || 'UNKNOWN';
  server.log.info(`[START UPDATE] Update ID: ${updateId}`);

  try {
    // PRE-LOAD GLOBALS TO REDUCE DB/CACHE QUERIES
    const [M, pDataGlobal, rDataGlobal, sys, pSetGlobal, smsSetGlobal] = await Promise.all([
      getMessages(), getPartnerData(), getResellerData(), getSysSettings(), getPaymentSettings(), getSmsSettings()
    ]);

    // --- MESSAGE ROUTER ---
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat?.id;
      const userId = msg.from?.id;
      if (!chatId || !userId) return;

      // Block non-private chats completely
      if (msg.chat?.type !== 'private') {
        if (msg.text && msg.text.startsWith('/')) {
          await tg.sendMessage(chatId, "⚠️ Please use this bot in private chat.").catch(()=>{});
        }
        return;
      }

      // Track active user activity silently
      await markUserActive(userId);

      const admin = String(userId) === String(sys?.adminChatId || CONFIG?.telegram?.adminId);
      const isPart = !!pDataGlobal.partners[userId.toString()];
      const isRes = !!rDataGlobal.resellers[userId.toString()];

      // Handle Photos (QR Code Upload or Payment Screenshots)
      if (msg.photo?.length > 0) {
        if (!(await verifyAccess(chatId, userId, admin, sys, M, rDataGlobal))) return;

        // Handle QR Code upload for admin
        if (admin && msg.reply_to_message?.text?.includes('Send the QR Code image')) {
          const photoId = msg.photo[msg.photo.length - 1].file_id;
          pSetGlobal.qrFileId = photoId;
          await savePaymentSettings(pSetGlobal);
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
        
        if (amount < pSetGlobal.minDeposit) {
          return await tg.sendMessage(chatId, `❌ The minimum deposit amount is ₹${pSetGlobal.minDeposit}.`);
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
        
        const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
        if (aId) {
          const caption = `💳 <b>New Payment Request</b>\n\n🆔 <b>User ID:</b> <code>${userId}</code>\n🧾 <b>Payment ID:</b> <code>${p.id}</code>\n💰 <b>Amount:</b> <code>₹${amount}</code>`;
          await tg.sendPhoto(aId, photoId, { caption, reply_markup: KB.approveReject(p.id, userId) }).catch(()=>{});
        }
        return await tg.sendMessage(chatId, M.PAYMENT_SUBMITTED);
      }

      if (!msg.text) return;
      const txt = msg.text.trim();

      // Handle ForceReplies
      if (msg.reply_to_message?.text) {
        const promptText = msg.reply_to_message.text;

        // Admin replies
        if (admin) {
          if (promptText.includes('Enter Telegram User ID to make them a Partner:')) {
            if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.');
            await tg.sendMessage(chatId, `🤝 Enter Commission Percentage for Partner ${txt} (e.g., 20):\n[KEY_PARTNER:${txt}]`, { reply_markup: { force_reply: true, selective: true } });
            return;
          }

          if (promptText.includes('Enter Commission Percentage for Partner')) {
            const keyMatch = promptText.match(/\[KEY_PARTNER:\s*(\d+)\]/);
            if (!keyMatch) return;
            const targetPId = keyMatch[1];
            const comm = Number(txt);
            if (isNaN(comm) || comm <= 0 || comm > 100) return await tg.sendMessage(chatId, '❌ Invalid commission percentage.');
            
            if(!pDataGlobal.partners[targetPId]) {
               pDataGlobal.partners[targetPId] = { commission: comm, earned: 0, paid: 0, pending: 0, active: true, upi: "" };
               if(!pDataGlobal.stats[targetPId]) pDataGlobal.stats[targetPId] = { joined: 0, deposits: 0 };
            } else {
               pDataGlobal.partners[targetPId].commission = comm;
            }
            await savePartnerData(pDataGlobal);
            return await tg.sendMessage(chatId, `✅ <b>Partner Added/Updated!</b>\n\nUser ID: <code>${targetPId}</code>\nCommission: <code>${comm}%</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Partners", "admin_partners")]] });
          }

          if (promptText.includes('Enter Telegram User ID to make them a Reseller:')) {
            if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_resellers")]] });
            await tg.sendMessage(chatId, `👑 Enter Starting Number Price for Reseller ${txt}:\n(Minimum: ₹1.00)\n[KEY_RES_PRICE:${txt}]`, { reply_markup: { force_reply: true, selective: true } });
            return;
          }

          if (promptText.includes('Enter Starting Number Price for Reseller')) {
            const keyMatch = promptText.match(/\[KEY_RES_PRICE:\s*(\d+)\]/);
            if (!keyMatch) return;
            const targetRId = keyMatch[1];
            const price = Number(txt);
            if (isNaN(price) || price < 1) return await tg.sendMessage(chatId, '❌ Invalid price. Minimum allowed is ₹1.00.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_resellers")]] });
            
            if(!rDataGlobal.resellers[targetRId]) {
               rDataGlobal.resellers[targetRId] = { price: price, earned: 0, paid: 0, pending: 0, active: true, upi: "", welcomeMsg: "", channel: "", group: "" };
               if(!rDataGlobal.stats[targetRId]) rDataGlobal.stats[targetRId] = { joined: 0, deposits: 0, sales: 0 };
            } else {
               rDataGlobal.resellers[targetRId].price = price;
               rDataGlobal.resellers[targetRId].active = true;
            }
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ <b>Reseller Added/Updated!</b>\n\nUser ID: <code>${targetRId}</code>\nPrice: <code>₹${price.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Resellers", "admin_resellers")]] });
          }

          if (promptText.includes('Enter new Number Price for Reseller')) {
            const keyMatch = promptText.match(/\[KEY_RES_PRICE_EDIT_ADMIN:\s*(\d+)\]/);
            if (!keyMatch) return;
            const targetRId = keyMatch[1];
            const price = Number(txt);
            if (isNaN(price) || price < 1) return await tg.sendMessage(chatId, '❌ Invalid price. Minimum allowed is ₹1.00.', { inline_keyboard: [[BTN.inline("🔙 Back", `admin_view_reseller_det:${targetRId}`)]] });
            
            if(rDataGlobal.resellers[targetRId]) {
               rDataGlobal.resellers[targetRId].price = price;
               await saveResellerData(rDataGlobal);
               return await tg.sendMessage(chatId, `✅ <b>Price Updated!</b>\n\nReseller: <code>${targetRId}</code>\nNew Price: <code>₹${price.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back", `admin_view_reseller_det:${targetRId}`)]] });
            }
          }

          if (promptText.includes('Enter new UPI ID:')) {
            pSetGlobal.upiId = txt;
            await savePaymentSettings(pSetGlobal);
            return await tg.sendMessage(chatId, `✅ UPI ID updated to <code>${esc(txt)}</code>.`, { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
          }

          if (promptText.includes('Enter Minimum Deposit amount:')) {
            const amt = Number(txt);
            if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.', { inline_keyboard: [[BTN.inline("🔙 Back to Payment Settings", "pay_settings")]] });
            pSetGlobal.minDeposit = amt;
            await savePaymentSettings(pSetGlobal);
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
            CACHE.messages.expiry = 0;
            return await tg.sendMessage(chatId, `✅ Message for <b>${key}</b> updated.`, { inline_keyboard: [[BTN.inline("🔙 Back to Editor", "msg_editor")]] });
          }

          if (promptText.includes('Enter broadcast message:')) {
            const allUsers = await prisma.user.findMany({ select: { telegramId: true } });
            await tg.sendMessage(chatId, `⏳ Sending broadcast to ${allUsers.length} users in the background...`);

            (async () => {
              let sent = 0;
              for (const u of allUsers) {
                try {
                  await tg.sendMessage(u.telegramId.toString(), txt);
                  sent++;
                  await new Promise(r => setTimeout(r, 50));
                } catch (err) {}
              }
              await tg.sendMessage(chatId, `✅ Broadcast finished. Sent to ${sent}/${allUsers.length} users.`, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] }).catch(()=>{});
            })();
            return;
          }

          if (promptText.includes('Enter Telegram User ID to manage:')) {
            if (!/^\d+$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid User ID.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_users_menu")]] });
            const targetTgId = BigInt(txt);
            
            const uTarget = await prisma.user.findUnique({ where: { telegramId: targetTgId } });
            if (!uTarget) return await tg.sendMessage(chatId, '❌ User not found in database.', { inline_keyboard: [[BTN.inline("🔙 Back", "admin_users_menu")]] });
            
            const [isBan, totOrders, totSpentAgg, totDepositsAgg] = await Promise.all([
              isBanned(targetTgId),
              prisma.order.count({ where: { userId: uTarget.id } }),
              prisma.order.aggregate({
                 _sum: { price: true },
                 where: { userId: uTarget.id, status: { in: ['ACTIVE', 'COMPLETED'] } }
              }),
              prisma.walletHistory.aggregate({
                 _sum: { amount: true },
                 where: { userId: uTarget.id, type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS'] } }
              })
            ]);
            
            const totSpent = Number(totSpentAgg._sum.price || 0);
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
            await tg.sendMessage(targetUId, `💰 <b>Balance Added</b>\n\nAn admin has added <code>₹${amt}</code> to your wallet.`).catch(()=>{});
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
            
            const numFields = ['maxPrice', 'timeout', 'interval'];
            const val = numFields.includes(field) ? Number(txt) : txt;
            
            if (numFields.includes(field) && (isNaN(val) || val <= 0)) {
              return await tg.sendMessage(chatId, '❌ Invalid number.');
            }

            const newSet = { ...smsSetGlobal, [field]: val };
            await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(newSet) } });
            CACHE.sms.expiry = 0;
            return await tg.sendMessage(chatId, `✅ SMS Setting <code>${field}</code> updated to <code>${txt}</code>.`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
          }

          if (promptText.includes('Enter new Number Price:')) {
            const amt = Number(txt);
            if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid price.', { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
            const newSet = { ...smsSetGlobal, maxPrice: amt };
            await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(newSet) } });
            CACHE.sms.expiry = 0;
            return await tg.sendMessage(chatId, `✅ <b>Number Price</b> updated to <code>₹${amt}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
          }

          if (promptText.includes('Enter new Referral Reward:')) {
            const amt = Number(txt);
            if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid reward amount.', { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "admin_settings")]] });
            const newSet = { ...sys, referralBonus: amt };
            await prisma.setting.upsert({ where: { key: 'SYSTEM_SETTINGS' }, update: { value: JSON.stringify(newSet) }, create: { key: 'SYSTEM_SETTINGS', value: JSON.stringify(newSet) } });
            CACHE.sys.expiry = 0;
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

          if (promptText.includes('Enter new UPI for Partner')) {
            const keyMatch = promptText.match(/\[KEY_PART_UPI_ADMIN:\s*(\d+)\]/);
            if (!keyMatch) return;
            const targetPId = keyMatch[1];
            if (pDataGlobal.partners[targetPId]) {
              pDataGlobal.partners[targetPId].upi = txt;
              await savePartnerData(pDataGlobal);
              return await tg.sendMessage(chatId, `✅ UPI updated for Partner ${targetPId}: <code>${esc(txt)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Partners", "admin_partners")]] });
            }
          }
        }

        // Partner replies
        if (promptText.includes('[KEY_PART_UPI]')) {
          if (pDataGlobal.partners[userId.toString()]) {
            pDataGlobal.partners[userId.toString()].upi = txt;
            await savePartnerData(pDataGlobal);
            return await tg.sendMessage(chatId, `✅ UPI ID saved: <code>${esc(txt)}</code>\n\nYou can now request a withdrawal from the Partner Panel.`);
          }
        }

        if (promptText.includes('[KEY_PART_WITHDRAW]')) {
          const amt = Number(txt);
          if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
          const myPP = pDataGlobal.partners[userId.toString()];
          if (!myPP) return;
          if (amt > (myPP.pending || 0)) return await tg.sendMessage(chatId, `❌ Insufficient pending balance. Your available balance is ₹${(myPP.pending || 0).toFixed(2)}.`);
          
          const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
          if (aId) {
            const reqMsg = `💸 <b>New Partner Withdrawal Request</b>\n\n👤 <b>Partner ID:</b> <code>${userId}</code>\n💰 <b>Amount:</b> ₹${amt}\n🏦 <b>UPI:</b> <code>${esc(myPP.upi)}</code>`;
            await tg.sendMessage(aId, reqMsg, { inline_keyboard: [[BTN.inline("View Partner", `admin_view_partner_det:${userId}`)]] }).catch(()=>{});
          }
          return await tg.sendMessage(chatId, `✅ Withdrawal request for ₹${amt} sent to admin.`);
        }

        // Reseller replies
        if (promptText.includes('[KEY_RES_PRICE_EDIT_SELF]')) {
          const amt = Number(txt);
          if (isNaN(amt) || amt < 1) return await tg.sendMessage(chatId, '❌ Invalid price. Minimum allowed is ₹1.00.', { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
          if (rDataGlobal.resellers[userId.toString()]) {
            rDataGlobal.resellers[userId.toString()].price = amt;
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ <b>Number Price Updated!</b>\n\nNew Price: <code>₹${amt.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
          }
        }

        if (promptText.includes('[KEY_RES_WELCOME]')) {
          if (rDataGlobal.resellers[userId.toString()]) {
            rDataGlobal.resellers[userId.toString()].welcomeMsg = txt;
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ <b>Custom Welcome Message Saved!</b>`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
          }
        }

        if (promptText.includes('[KEY_RES_CHANNEL]')) {
          if (rDataGlobal.resellers[userId.toString()]) {
            if (txt.toLowerCase() === 'none' || txt.toLowerCase() === 'remove') {
                rDataGlobal.resellers[userId.toString()].channel = null;
            } else {
                rDataGlobal.resellers[userId.toString()].channel = txt;
            }
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ Force Join Channel updated!`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
          }
        }

        if (promptText.includes('[KEY_RES_GROUP]')) {
          if (rDataGlobal.resellers[userId.toString()]) {
            if (txt.toLowerCase() === 'none' || txt.toLowerCase() === 'remove') {
                rDataGlobal.resellers[userId.toString()].group = null;
            } else {
                rDataGlobal.resellers[userId.toString()].group = txt;
            }
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ Force Join Group updated!`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
          }
        }

        if (promptText.includes('[KEY_RES_UPI_SELF]')) {
          if (rDataGlobal.resellers[userId.toString()]) {
            rDataGlobal.resellers[userId.toString()].upi = txt;
            await saveResellerData(rDataGlobal);
            return await tg.sendMessage(chatId, `✅ UPI ID saved: <code>${esc(txt)}</code>\n\nYou can now request a withdrawal from the Reseller Panel.`, { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
          }
        }

        if (promptText.includes('[KEY_RES_WITHDRAW]')) {
          const amt = Number(txt);
          if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
          const myRes = rDataGlobal.resellers[userId.toString()];
          if (!myRes) return;
          if (amt > (myRes.pending || 0)) return await tg.sendMessage(chatId, `❌ Insufficient pending balance. Your available balance is ₹${(myRes.pending || 0).toFixed(2)}.`, { inline_keyboard: [[BTN.inline("🔙 Back", "reseller_panel")]] });
          
          const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
          if (aId) {
            const reqMsg = `💸 <b>New Reseller Withdrawal Request</b>\n\n👑 <b>Reseller ID:</b> <code>${userId}</code>\n💰 <b>Amount:</b> ₹${amt}\n🏦 <b>UPI:</b> <code>${esc(myRes.upi)}</code>`;
            await tg.sendMessage(aId, reqMsg, { inline_keyboard: [[BTN.inline("View Reseller", `admin_view_reseller_det:${userId}`)]] }).catch(()=>{});
          }
          return await tg.sendMessage(chatId, `✅ Withdrawal request for ₹${amt} sent to admin.`, { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
        }
      }

      if (txt.startsWith('/start')) {
        const payload = txt.split(' ')[1];
        
        let isNewUser = false;
        let userInDb = await prisma.user.findUnique({ where: { telegramId: BigInt(userId) } });
        if (!userInDb) {
          isNewUser = true;
          userInDb = await prisma.user.create({ data: { telegramId: BigInt(userId) } });
        }

        if (payload) {
          if (payload.startsWith('p_')) {
            const pTgId = payload.replace('p_', '');
            if (isNewUser && pTgId !== String(userId)) {
              if (pDataGlobal.partners[pTgId]) {
                if (!pDataGlobal.users[String(userId)]) {
                  pDataGlobal.users[String(userId)] = pTgId;
                  if(!pDataGlobal.stats[pTgId]) pDataGlobal.stats[pTgId] = { joined: 0, deposits: 0 };
                  pDataGlobal.stats[pTgId].joined += 1;
                  await savePartnerData(pDataGlobal);
                  
                  await tg.sendMessage(pTgId, `🎉 <b>New Partner Referral</b>\n\nA new user has joined using your link!\nThey are now permanently linked to your account.`).catch(()=>{});
                }
              }
            }
          } else if (payload.startsWith('r_')) {
            const rTgId = payload.replace('r_', '');
            if (isNewUser && rTgId !== String(userId)) {
              if (rDataGlobal.resellers[rTgId]) {
                if (!rDataGlobal.users[String(userId)]) {
                  rDataGlobal.users[String(userId)] = rTgId;
                  if(!rDataGlobal.stats[rTgId]) rDataGlobal.stats[rTgId] = { joined: 0, deposits: 0, sales: 0 };
                  rDataGlobal.stats[rTgId].joined += 1;
                  await saveResellerData(rDataGlobal);
                }
              }
            }
          } else if (/^\d+$/.test(payload) && payload !== String(userId)) {
            const existingRef = await prisma.referral.findUnique({ where: { referredId: userInDb.id } });
            if (!existingRef && !pendingReferrals.has(userId) && isNewUser) {
              pendingReferrals.set(userId, payload);
              await tg.sendMessage(payload, M.REF_PENDING).catch(()=>{});
            }
          }
        }
        
        if (!(await verifyAccess(chatId, userId, admin, sys, M, rDataGlobal))) return;

        if (pendingReferrals.has(userId)) {
          await processReferral(userId, pendingReferrals.get(userId), admin, sys, rDataGlobal);
          pendingReferrals.delete(userId);
        }

        let welcomeMsg = M.WELCOME;
        const myMappedReseller = rDataGlobal.users[userId.toString()];
        if (myMappedReseller) {
           const resInfo = rDataGlobal.resellers[myMappedReseller];
           if (resInfo && resInfo.welcomeMsg) {
               welcomeMsg = resInfo.welcomeMsg;
           }
        }

        return await tg.sendMessage(chatId, welcomeMsg, admin ? KB.adminMain : KB.main(isPart, isRes));
      }

      if (!(await verifyAccess(chatId, userId, admin, sys, M, rDataGlobal))) return;

      switch (txt) {
        case '🐦 Get Twitter Number':
          const uBuy = await getUser(userId);
          const act = await prisma.order.findFirst({ where: { userId: uBuy.id, status: 'ACTIVE' } });
          if (act) return await tg.sendMessage(chatId, M.ACTIVE_ORDER_EXISTS || MSG.ACTIVE_ORDER_EXISTS);
          
          const myResellerId = rDataGlobal.users[userId.toString()];
          let userPrice = smsSetGlobal.maxPrice;

          if (myResellerId && rDataGlobal.resellers[myResellerId] && rDataGlobal.resellers[myResellerId].active) {
              userPrice = rDataGlobal.resellers[myResellerId].price;
          }
          
          if (uBuy.balance.toNumber() < userPrice) return await tg.sendMessage(chatId, M.NO_BALANCE);
          
          const loadMsg = await tg.sendMessage(chatId, M.PURCHASING);
          server.log.info(`[PURCHASE STARTED] User: ${userId} | Price: ${userPrice}`);

          const pr = await purchaseSms(smsSetGlobal);
          if (!pr.success) {
            server.log.warn(`[PURCHASE FAILED] User: ${userId} | Error: ${pr.error}`);
            return await tg.editMessage(chatId, loadMsg?.message_id, M.NUMBER_FAILED).catch(()=>{});
          }

          try {
            const ord = await prisma.$transaction(async (tx) => {
              const currentUser = await tx.user.findUnique({ where: { id: uBuy.id } });
              if (currentUser.balance.toNumber() < userPrice) throw new Error('INSUFFICIENT_BALANCE');
              
              await tx.user.update({
                where: { id: uBuy.id },
                data: { balance: { decrement: userPrice } }
              });
              
              return await tx.order.create({
                data: {
                  userId: uBuy.id,
                  activationId: pr.activationId,
                  phoneNumber: pr.phoneNumber,
                  service: String(smsSetGlobal.serviceId),
                  provider: 'API',
                  price: userPrice, // Store the price paid by user
                  expiresAt: new Date(Date.now() + (15 * 60 * 1000)), // Strict 15 min expiry tracking
                  status: 'ACTIVE'
                }
              });
            });

            let rawPhone = pr.phoneNumber.toString().replace(/^\+?1?\s*/, '');

            const successMsg = M.NUMBER_SUCCESS
              .replace('{phoneNumber}', esc(rawPhone))
              .replace('{amount}', userPrice.toFixed(2));

            await tg.editMessage(chatId, loadMsg?.message_id, successMsg, KB.cancel(pr.activationId)).catch(()=>{});
            server.log.info(`[PURCHASE SUCCESS] Order: ${ord.id} | Phone: ${rawPhone}`);
            
            startOtpPolling(chatId, uBuy.id, ord.id, pr.activationId, pr.phoneNumber, userPrice, loadMsg?.message_id, smsSetGlobal.interval);
          } catch (err) {
            await cancelSms(pr.activationId);
            if (err.message === 'INSUFFICIENT_BALANCE') return await tg.editMessage(chatId, loadMsg?.message_id, M.NO_BALANCE).catch(()=>{});
            return await tg.editMessage(chatId, loadMsg?.message_id, M.NUMBER_FAILED).catch(()=>{});
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
          const addBalTxt = M.ADD_BALANCE
             .replace('{upi}', esc(pSetGlobal.upiId))
             .replace('{minimumDeposit}', pSetGlobal.minDeposit);
             
          if (pSetGlobal.qrFileId) {
             await tg.sendPhoto(chatId, pSetGlobal.qrFileId, { caption: addBalTxt });
          } else {
             await tg.sendMessage(chatId, addBalTxt);
          }
          break;

        case '🎁 Refer & Earn':
          const uRef = await getUser(userId);
          const rLink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=${userId}`;
          const rTxt = M.REFER_INFO.replace('{amount}', esc(sys?.referralBonus || 0.5)).replace('{referralLink}', esc(rLink)) + `\n\n📊 <b>Your Stats</b>\n👥 <b>Referrals:</b> <code>${uRef.totalReferrals}</code>\n💰 <b>Earnings:</b> <code>₹${esc(uRef.referralEarnings)}</code>`;
          await tg.sendMessage(chatId, rTxt);
          break;

        case '📞 Support':
          await tg.sendMessage(chatId, M.SUPPORT, KB.support(sys?.supportUsername || CONFIG.telegram.supportUsername));
          break;

        case '🤝 Partner Panel':
          if (!isPart) return;
          await tg.sendMessage(chatId, "🤝 <b>Partner Panel</b>\n\nSelect an option below:", {
            inline_keyboard: [
              [BTN.inline("🔗 My Referral Link", "part_link")],
              [BTN.inline("📊 Statistics", "part_stats"), BTN.inline("💰 Earnings", "part_earn")],
              [BTN.inline("💸 Withdraw", "part_with")]
            ]
          });
          break;

        case '👑 Reseller Panel':
          if (!isRes) return;
          await tg.sendMessage(chatId, "👑 <b>Reseller Panel</b>\n\nSelect an option below:", {
            inline_keyboard: [
              [BTN.inline("🔗 My Referral Link", "res_link")],
              [BTN.inline("📊 Statistics", "res_stats")],
              [BTN.inline("💵 My Number Price", "res_price"), BTN.inline("✏️ Change Price", "res_edit_price")],
              [BTN.inline("🏦 Edit UPI", "res_upi"), BTN.inline("💸 Withdraw", "res_with")],
              [BTN.inline("⚙️ My Settings", "res_settings")],
              [BTN.inline("⬅️ Back", "close_res_panel")]
            ]
          });
          break;

        case '📊 Statistics':
          if (!admin) return;
          const [totU, actU, succOrders, actO, revAg, walAg, profitAg] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => 'N/A'),
            prisma.order.count({ where: { otpCount: { gte: 1 } } }),
            prisma.order.count({ where: { status: 'ACTIVE' } }),
            prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'APPROVED' } }),
            prisma.user.aggregate({ _sum: { balance: true } }),
            prisma.order.aggregate({ _sum: { price: true }, where: { otpCount: { gte: 1 } } })
          ]);
          
          const revAmt = Number(revAg?._sum?.amount || 0);
          const totWal = Number(walAg?._sum?.balance || 0);
          const totPrice = Number(profitAg?._sum?.price || 0);
          const profit = totPrice - (succOrders * 0.52);

          const statMsg = `📊 <b>Bot Statistics</b>\n\n👥 <b>Total Users:</b>\n${totU}\n\n🟢 <b>Active Users:</b>\n${actU}\n\n📦 <b>Successful Purchases:</b>\n${succOrders}\n\n⏳ <b>Active Orders:</b>\n${actO}\n\n💳 <b>Total Deposits:</b>\n₹${revAmt}\n\n💰 <b>Total Wallet Funds:</b>\n₹${totWal}\n\n📈 <b>Total Profit:</b>\n₹${profit.toFixed(2)}`;
          
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
          
        case '🤝 Partners':
          if (!admin) return;
          await tg.sendMessage(chatId, "🤝 <b>Partner Management</b>\n\nManage partners and view their statistics.", {
            inline_keyboard: [
              [BTN.inline("➕ Add Partner", "admin_add_partner")],
              [BTN.inline("📋 View Partners", "admin_view_partners")],
              [BTN.inline("🔙 Back", "back_to_admin")]
            ]
          });
          break;

        case '👑 Reseller Management':
          if (!admin) return;
          await tg.sendMessage(chatId, "👑 <b>Reseller Management</b>\n\nManage resellers and view their statistics.", {
            inline_keyboard: [
              [BTN.inline("➕ Add Reseller", "admin_add_reseller")],
              [BTN.inline("📋 Reseller List", "admin_view_resellers")],
              [BTN.inline("🔙 Back", "back_to_admin")]
            ]
          });
          break;
      }
    }

    // --- CALLBACK ROUTER ---
    if (update.callback_query) {
      const cb = update.callback_query;

      // Block non-private chats completely for callbacks as well
      if (cb.message?.chat?.type && cb.message.chat.type !== 'private') {
        try { await tg.answerCallbackQuery(cb.id, { text: "⚠️ Please use this bot in private chat.", show_alert: true }); } catch(e){}
        return;
      }
      
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

      // Track active user activity silently
      await markUserActive(userId);

      const dataParts = cb.data ? cb.data.split(':') : [];
      const action = dataParts[0];
      const args = dataParts.slice(1);
      
      const admin = String(userId) === String(sys?.adminChatId || CONFIG?.telegram?.adminId);
      const isPart = !!pDataGlobal.partners[userId.toString()];
      const isRes = !!rDataGlobal.resellers[userId.toString()];

      switch (action) {
        case 'verify_join':
          CACHE.forceJoin.delete(userId.toString()); // Force recalculation
          const isJoined = await checkForceJoin(userId, admin, sys, rDataGlobal);
          if (isJoined || admin) {
            await tg.deleteMessage(chatId, msgId).catch(()=>{});
            if (pendingReferrals.has(userId)) {
              await processReferral(userId, pendingReferrals.get(userId), admin, sys, rDataGlobal);
              pendingReferrals.delete(userId);
            }
            await tg.sendMessage(chatId, M.WELCOME, admin ? KB.adminMain : KB.main(isPart, isRes));
          } else {
            await tg.sendMessage(chatId, "❌ Please join the required Channel/Group to continue.");
          }
          break;

        case 'cancel_order':
          const uCan = await getUser(userId);
          const oCan = await prisma.order.findFirst({ where: { userId: uCan.id, status: 'ACTIVE', activationId: args[0] } });
          if (!oCan) return await tg.editMessage(chatId, msgId, M.UNKNOWN_ERROR, { inline_keyboard: [] }).catch(()=>{});
          
          await cancelSms(args[0]);

          if (oCan.otpCount === 0) {
            await prisma.$transaction([
              prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } }),
              prisma.user.update({ where: { id: uCan.id }, data: { balance: { increment: oCan.price } } })
            ]);
            await tg.editMessage(chatId, msgId, M.ORDER_CANCELLED_REFUND, { inline_keyboard: [] }).catch(()=>{});
            server.log.info(`[ORDER CANCELLED] Order: ${oCan.id} | Refunded`);
          } else {
            await prisma.order.update({ where: { id: oCan.id }, data: { status: 'CANCELLED' } });
            await tg.editMessage(chatId, msgId, M.ORDER_CANCELLED_NO_REFUND, { inline_keyboard: [] }).catch(()=>{});
            server.log.info(`[ORDER CANCELLED] Order: ${oCan.id} | No Refund`);
          }
          break;

        case 'approve_payment':
          if (!admin) return;
          const pId = args[0];
          const targetTgId = BigInt(args[1]);

          const payment = await prisma.payment.findUnique({ where: { id: pId } });
          if (!payment || payment.status !== 'PENDING') {
            await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
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

          // ==========================================
          // PARTNER COMMISSION LOGIC
          // ==========================================
          const ptIdStr = targetTgId.toString();
          const pRefId = pDataGlobal.users[ptIdStr];
          
          if (pRefId && pDataGlobal.partners[pRefId] && pDataGlobal.partners[pRefId].active) {
              const commRate = pDataGlobal.partners[pRefId].commission;
              const earned = amt * (commRate / 100);
              
              pDataGlobal.partners[pRefId].pending += earned;
              pDataGlobal.partners[pRefId].earned += earned;
              
              if(!pDataGlobal.stats[pRefId]) pDataGlobal.stats[pRefId] = { joined: 0, deposits: 0 };
              pDataGlobal.stats[pRefId].deposits += amt;
              
              await savePartnerData(pDataGlobal);
              await tg.sendMessage(pRefId, `🎉 <b>Partner Commission</b>\n\nA referred user deposited ₹${amt}.\n💰 You earned: <code>₹${earned.toFixed(2)}</code>`).catch(()=>{});
          }

          // ==========================================
          // RESELLER DEPOSIT LOGIC (₹1 FIXED BASE PRICE)
          // ==========================================
          const rDepId = rDataGlobal.users[ptIdStr];
          if (rDepId && rDataGlobal.resellers[rDepId] && rDataGlobal.resellers[rDepId].active) {
             const myReseller = rDataGlobal.resellers[rDepId];
             
             // Reseller ka set kiya hua number price
             const userPaidPrice = myReseller.price; 
             
             // Fixed Base Price = ₹1 (Iske upar sab reseller ka profit)
             const basePrice = 1;
             const profitMargin = Math.max(0, userPaidPrice - basePrice);
             let profitOnDeposit = 0;
             
             if (profitMargin > 0 && userPaidPrice > 0) {
                 // Total deposit me se advance profit nikalna
                 const profitRatio = profitMargin / userPaidPrice;
                 profitOnDeposit = amt * profitRatio;
             }

             if (!rDataGlobal.stats[rDepId]) rDataGlobal.stats[rDepId] = { joined: 0, deposits: 0, sales: 0 };
             rDataGlobal.stats[rDepId].deposits += amt;

             if (profitOnDeposit > 0) {
                 myReseller.pending += profitOnDeposit;
                 myReseller.earned += profitOnDeposit;
                 
                 // Reseller ko turant notification
                 await tg.sendMessage(rDepId, `🎉 <b>Reseller Commission</b>\n\nA referred user deposited ₹${amt}.\n💰 You earned: <code>₹${profitOnDeposit.toFixed(2)}</code>`).catch(()=>{});
             }
             
             await saveResellerData(rDataGlobal);
          }

          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
          await tg.sendMessage(chatId, `✅ Payment <code>${pId}</code> processed. Added <code>₹${amt}</code> to User <code>${args[1]}</code>.`);
          await tg.sendMessage(targetTgId.toString(), M.PAYMENT_APPROVED.replace('{amount}', esc(amt))).catch(()=>{});
          break;

        case 'reject_payment':
          if (!admin) return;
          await prisma.payment.update({ where: { id: args[0] }, data: { status: 'REJECTED' } });
          await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
          await tg.sendMessage(chatId, `❌ Payment <code>${args[0]}</code> Rejected.`);
          await tg.sendMessage(args[1], M.PAYMENT_REJECTED).catch(()=>{});
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
          
          const [allUsers, allOrders, validDeposits] = await Promise.all([
            prisma.user.findMany(),
            prisma.order.findMany({ select: { userId: true, price: true, status: true } }),
            prisma.walletHistory.findMany({
              where: { type: { in: ['DEPOSIT', 'ADMIN_ADDED', 'REFERRAL_BONUS'] } },
              select: { userId: true, amount: true }
            })
          ]);

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

          for (const o of allOrders) {
            if (userStats.has(o.userId)) {
              userStats.get(o.userId).orders += 1;
              if (o.status === 'ACTIVE' || o.status === 'COMPLETED') {
                userStats.get(o.userId).spent += Number(o.price || 0);
              }
            }
          }

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
          await tg.editMessage(chatId, msgId, "⚙️ <b>System Settings</b>", KB.adminSettings()).catch(()=>{});
          break;
          
        case 'pay_settings':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "💳 <b>Payment Settings</b>\n\nConfigure UPI, QR code, and minimum deposit.", {
            inline_keyboard: [
              [BTN.inline("🖼 Upload QR Code", "pay_set_qr"), BTN.inline("🏦 Change UPI ID", "pay_set_upi")],
              [BTN.inline("💵 Minimum Deposit", "pay_set_min"), BTN.inline("👀 Preview Payment", "pay_preview")],
              [BTN.inline("🔙 Back", "admin_settings")]
            ]
          }).catch(()=>{});
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
          const previewTxt = M.ADD_BALANCE
             .replace('{upi}', esc(pSetGlobal.upiId))
             .replace('{minimumDeposit}', pSetGlobal.minDeposit);
          
          if (pSetGlobal.qrFileId) {
             await tg.sendPhoto(chatId, pSetGlobal.qrFileId, { caption: previewTxt }).catch(()=>{});
          } else {
             await tg.sendMessage(chatId, previewTxt).catch(()=>{});
          }
          break;
          
        case 'msg_editor':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "💬 <b>Message Editor</b>\n\nSelect a message to edit. Using variables like {upi} is supported where applicable.", KB.messageEditor()).catch(()=>{});
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
          await tg.editMessage(chatId, msgId, `🚫 <b>Force Join Bypass</b>\n\nCurrent Bypass Users: <code>${bUsers.length}</code>`, KB.bypassMenu()).catch(()=>{});
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
            await tg.editMessage(chatId, msgId, "🚫 <b>Force Join Bypass List</b>\n\nNo users bypassed.", KB.bypassMenu()).catch(()=>{});
          } else {
            let msg = "🚫 <b>Force Join Bypass List</b>\n\n";
            list.forEach(id => msg += `• <code>${id}</code>\n`);
            await tg.editMessage(chatId, msgId, msg, KB.bypassMenu()).catch(()=>{});
          }
          break;

        case 'admin_maintenance':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "🛠️ <b>Maintenance Mode</b>\n\nToggles user access.", KB.maintenance(sys.isMaintenanceMode)).catch(()=>{});
          break;

        case 'toggle_maintenance':
          if (!admin) return;
          const newVal = !sys.isMaintenanceMode;
          await prisma.setting.upsert({ where: { key: 'SYSTEM_SETTINGS' }, update: { value: JSON.stringify({...sys, isMaintenanceMode: newVal}) }, create: { key: 'SYSTEM_SETTINGS', value: JSON.stringify({isMaintenanceMode: newVal}) } });
          CACHE.sys.expiry = 0;
          await tg.editMessage(chatId, msgId, "🛠️ <b>Maintenance Mode</b>\n\nToggles user access.", KB.maintenance(newVal)).catch(()=>{});
          break;
          
        case 'admin_sms_settings':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "📡 <b>SMS Settings</b>\n\nSelect a field to modify.", KB.smsSettings()).catch(()=>{});
          break;

        case 'admin_sms_current':
          if (!admin) return;
          await tg.sendMessage(chatId, `📄 <b>Current Config</b>\nCountry: <code>${smsSetGlobal.countryId}</code>\nOperator: <code>${smsSetGlobal.operatorId}</code>\nService: <code>${smsSetGlobal.serviceId}</code>\nPrice: <code>₹${smsSetGlobal.maxPrice}</code>\nTimeout: <code>${smsSetGlobal.timeout}s</code>\nInterval: <code>${smsSetGlobal.interval}s</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to SMS Settings", "admin_sms_settings")]] });
          break;

        case 'admin_sms_edit':
          if (!admin) return;
          await tg.sendMessage(chatId, `📡 Enter new value for SMS setting: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_num_price':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, `💰 <b>Number Price</b>\n\nCurrent Price: <code>₹${smsSetGlobal.maxPrice}</code>`, KB.numPrice()).catch(()=>{});
          break;

        case 'admin_ref_reward':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, `🎁 <b>Referral Reward</b>\n\nCurrent Reward: <code>₹${sys.referralBonus}</code>`, KB.refReward()).catch(()=>{});
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
          const isBanState = await isBanned(targetBannedId);
          if (isBanState) {
            await prisma.bannedUser.delete({ where: { telegramId: targetBannedId } });
            await tg.sendMessage(chatId, `✅ User <code>${args[0]}</code> unbanned.`);
          } else {
            await prisma.bannedUser.create({ data: { telegramId: targetBannedId } });
            await tg.sendMessage(chatId, `⛔ User <code>${args[0]}</code> banned.`);
          }
          await tg.editMessageReplyMarkup(chatId, msgId, KB.manageUser(args[0], !isBanState)).catch(()=>{});
          break;

        case 'admin_add_bal':
          if (!admin) return;
          await tg.sendMessage(chatId, `➕ Enter amount to add to user: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_ded_bal':
          if (!admin) return;
          await tg.sendMessage(chatId, `➖ Enter amount to deduct from user: ${args[0]}`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_add_partner':
          if (!admin) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, '🤝 Enter Telegram User ID to make them a Partner:', { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_partners':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "🤝 <b>Partner Management</b>\n\nManage partners and view their statistics.", {
            inline_keyboard: [
              [BTN.inline("➕ Add Partner", "admin_add_partner")],
              [BTN.inline("📋 View Partners", "admin_view_partners")],
              [BTN.inline("🔙 Back", "back_to_admin")]
            ]
          }).catch(()=>{});
          break;

        case 'admin_view_partners':
          if (!admin) return;
          const ptIds = Object.keys(pDataGlobal.partners);
          if (ptIds.length === 0) {
             return await tg.editMessage(chatId, msgId, "🤝 No partners found.", { inline_keyboard: [[BTN.inline("🔙 Back", "admin_partners")]] }).catch(()=>{});
          }
          
          let pKbd = [];
          ptIds.forEach(id => {
             pKbd.push([BTN.inline(`👤 ${id} (${pDataGlobal.partners[id].commission}%)`, `admin_view_partner_det:${id}`)]);
          });
          pKbd.push([BTN.inline("🔙 Back", "admin_partners")]);
          await tg.editMessage(chatId, msgId, "📋 <b>Select a Partner to view stats:</b>", { inline_keyboard: pKbd }).catch(()=>{});
          break;
          
        case 'admin_view_partner_det':
          if (!admin) return;
          const dtId = args[0];
          if (!pDataGlobal.partners[dtId]) return;
          
          const ptUser = await prisma.user.findUnique({ where: { telegramId: BigInt(dtId) } });
          let pUserName = ptUser && ptUser.username ? `@${ptUser.username}` : "Not Set";
          
          const myPP = pDataGlobal.partners[dtId];
          const mySS = pDataGlobal.stats[dtId] || { joined: 0, deposits: 0 };
          const plink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=p_${dtId}`;
          
          const pDetMsg = `👤 <b>Partner:</b>\n${esc(pUserName)}\n\n🔗 <b>Referral Link:</b>\n<code>${plink}</code>\n\n👥 <b>Total Joined Users:</b>\n${mySS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(mySS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(myPP.pending || 0).toFixed(2)}\n\n<b>Commission %:</b> ${myPP.commission}%\n<b>Status:</b> ${myPP.active ? 'ACTIVE' : 'INACTIVE'}`;
          
          await tg.editMessage(chatId, msgId, pDetMsg, {
             inline_keyboard: [
               [BTN.inline("💸 Mark Paid", `admin_pay_partner:${dtId}`), BTN.inline(myPP.active ? "❌ Disable Partner" : "✅ Enable Partner", `admin_tog_partner:${dtId}`)],
               [BTN.inline("✏️ Change UPI", `admin_upi_partner:${dtId}`), BTN.inline("🔙 Back", "admin_view_partners")]
             ]
          }).catch(()=>{});
          break;

        case 'admin_upi_partner':
          if (!admin) return;
          const uIdUpi = args[0];
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, `🏦 Enter new UPI for Partner ${uIdUpi}:\n[KEY_PART_UPI_ADMIN:${uIdUpi}]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_pay_partner':
          if (!admin) return;
          const payId = args[0];
          if (pDataGlobal.partners[payId] && pDataGlobal.partners[payId].pending > 0) {
             pDataGlobal.partners[payId].paid += pDataGlobal.partners[payId].pending;
             pDataGlobal.partners[payId].pending = 0;
             await savePartnerData(pDataGlobal);
             try { await tg.answerCallbackQuery(cb.id, { text: "✅ Partner pending balance marked as Paid.", show_alert: true }); } catch(e){}
             
             update.callback_query.data = `admin_view_partner_det:${payId}`;
             return handleUpdate(update);
          } else {
             try { await tg.answerCallbackQuery(cb.id, { text: "⚠️ No pending balance to pay.", show_alert: true }); } catch(e){}
          }
          break;

        case 'admin_tog_partner':
          if (!admin) return;
          const togId = args[0];
          if (pDataGlobal.partners[togId]) {
             pDataGlobal.partners[togId].active = !pDataGlobal.partners[togId].active;
             await savePartnerData(pDataGlobal);
             update.callback_query.data = `admin_view_partner_det:${togId}`;
             return handleUpdate(update);
          }
          break;

        // ================= RESELLER ADMIN ACTIONS =================

        case 'admin_resellers':
          if (!admin) return;
          await tg.editMessage(chatId, msgId, "👑 <b>Reseller Management</b>\n\nManage resellers and view their statistics.", {
            inline_keyboard: [
              [BTN.inline("➕ Add Reseller", "admin_add_reseller")],
              [BTN.inline("📋 Reseller List", "admin_view_resellers")],
              [BTN.inline("🔙 Back", "back_to_admin")]
            ]
          }).catch(()=>{});
          break;

        case 'admin_add_reseller':
          if (!admin) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, '👑 Enter Telegram User ID to make them a Reseller:', { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_view_resellers':
          if (!admin) return;
          const resIds = Object.keys(rDataGlobal.resellers);
          if (resIds.length === 0) {
             return await tg.editMessage(chatId, msgId, "👑 No resellers found.", { inline_keyboard: [[BTN.inline("🔙 Back", "admin_resellers")]] }).catch(()=>{});
          }
          
          let rKbd = [];
          for (const id of resIds) {
             const uObj = await prisma.user.findUnique({ where: { telegramId: BigInt(id) } });
             const un = uObj?.username ? `@${uObj.username}` : id;
             rKbd.push([BTN.inline(`👑 ${un} (₹${rDataGlobal.resellers[id].price.toFixed(2)})`, `admin_view_reseller_det:${id}`)]);
          }
          rKbd.push([BTN.inline("🔙 Back", "admin_resellers")]);
          await tg.editMessage(chatId, msgId, "📋 <b>Select a Reseller to view stats:</b>", { inline_keyboard: rKbd }).catch(()=>{});
          break;
          
        case 'admin_view_reseller_det':
          if (!admin) return;
          const detResId = args[0];
          if (!rDataGlobal.resellers[detResId]) return;
          
          const resUser = await prisma.user.findUnique({ where: { telegramId: BigInt(detResId) } });
          let rUserName = resUser && resUser.username ? `@${resUser.username}` : "Not Set";
          
          const myRP = rDataGlobal.resellers[detResId];
          const myRS = rDataGlobal.stats[detResId] || { joined: 0, deposits: 0, sales: 0 };
          const rlink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=r_${detResId}`;
          
          const rDetMsg = `👑 <b>Reseller:</b>\n${esc(rUserName)}\n\n🆔 <b>User ID:</b>\n<code>${detResId}</code>\n\n🔗 <b>Referral Link:</b>\n<code>${rlink}</code>\n\n👥 <b>Users:</b>\n${myRS.joined}\n\n📦 <b>Successful Purchases:</b>\n${myRS.sales}\n\n💳 <b>Total Deposits:</b>\n₹${(myRS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(myRP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(myRP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(myRP.pending || 0).toFixed(2)}\n\n💵 <b>Current Number Price:</b>\n₹${myRP.price.toFixed(2)}\n\n<b>Status:</b> ${myRP.active ? 'ACTIVE' : 'INACTIVE'}`;
          
          await tg.editMessage(chatId, msgId, rDetMsg, {
             inline_keyboard: [
               [BTN.inline("💵 Edit Number Price", `admin_edit_reseller_price:${detResId}`)],
               [BTN.inline(myRP.active ? "❌ Disable Reseller" : "✅ Enable Reseller", `admin_tog_reseller:${detResId}`), BTN.inline("💸 Mark Paid", `admin_pay_reseller:${detResId}`)],
               [BTN.inline("🔙 Back", "admin_view_resellers")]
             ]
          }).catch(()=>{});
          break;

        case 'admin_edit_reseller_price':
          if (!admin) return;
          const eRId = args[0];
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, `💵 Enter new Number Price for Reseller ${eRId}:\n(Minimum: ₹1.00)\n[KEY_RES_PRICE_EDIT_ADMIN:${eRId}]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'admin_tog_reseller':
          if (!admin) return;
          const togResId = args[0];
          if (rDataGlobal.resellers[togResId]) {
             rDataGlobal.resellers[togResId].active = !rDataGlobal.resellers[togResId].active;
             await saveResellerData(rDataGlobal);
             update.callback_query.data = `admin_view_reseller_det:${togResId}`;
             return handleUpdate(update);
          }
          break;

        case 'admin_pay_reseller':
          if (!admin) return;
          const payResId = args[0];
          if (rDataGlobal.resellers[payResId] && rDataGlobal.resellers[payResId].pending > 0) {
             rDataGlobal.resellers[payResId].paid += rDataGlobal.resellers[payResId].pending;
             rDataGlobal.resellers[payResId].pending = 0;
             await saveResellerData(rDataGlobal);
             try { await tg.answerCallbackQuery(cb.id, { text: "✅ Reseller pending balance marked as Paid.", show_alert: true }); } catch(e){}
             update.callback_query.data = `admin_view_reseller_det:${payResId}`;
             return handleUpdate(update);
          } else {
             try { await tg.answerCallbackQuery(cb.id, { text: "⚠️ No pending balance to pay.", show_alert: true }); } catch(e){}
          }
          break;

        // ================= PARTNER PANEL CALLBACKS =================
        case 'part_panel':
          if (!isPart) return;
          await tg.editMessage(chatId, msgId, "🤝 <b>Partner Panel</b>\n\nSelect an option below:", {
            inline_keyboard: [
              [BTN.inline("🔗 My Referral Link", "part_link")],
              [BTN.inline("📊 Statistics", "part_stats"), BTN.inline("💰 Earnings", "part_earn")],
              [BTN.inline("💸 Withdraw", "part_with")]
            ]
          }).catch(()=>{});
          break;

        case 'part_link':
          if (!isPart) return;
          const link_myPP = pDataGlobal.partners[userId.toString()];
          const link_myS = pDataGlobal.stats[userId.toString()] || { joined: 0, deposits: 0 };
          const link_myLink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=p_${userId}`;
          
          const link_myPnlTxt = `🔗 <b>Your Referral Link</b>\n\n<code>${link_myLink}</code>\n\n━━━━━━━━━━━━━━\n\n👥 <b>Users Joined:</b>\n${link_myS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(link_myS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(link_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(link_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(link_myPP.pending || 0).toFixed(2)}\n\n━━━━━━━━━━━━━━\n\nShare this link to invite new users.\nYou'll automatically earn your commission whenever your referred users make approved deposits.`;
          
          await tg.editMessage(chatId, msgId, link_myPnlTxt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] }).catch(()=>{});
          break;

        case 'part_stats':
          if (!isPart) return;
          const st_myPP = pDataGlobal.partners[userId.toString()];
          const st_myS = pDataGlobal.stats[userId.toString()] || { joined: 0, deposits: 0 };
          
          const st_txt = `📊 <b>Statistics</b>\n\n👥 <b>Total Users:</b>\n${st_myS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(st_myS.deposits || 0).toFixed(2)}\n\n<b>Commission %:</b>\n${st_myPP.commission}%\n\n💰 <b>Lifetime Earnings:</b>\n₹${(st_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(st_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(st_myPP.pending || 0).toFixed(2)}`;
          await tg.editMessage(chatId, msgId, st_txt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] }).catch(()=>{});
          break;

        case 'part_earn':
          if (!isPart) return;
          const er_myPP = pDataGlobal.partners[userId.toString()];
          
          const er_txt = `💰 <b>Earnings</b>\n\n💰 <b>Lifetime Earnings:</b>\n₹${(er_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(er_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(er_myPP.pending || 0).toFixed(2)}\n\n✅ <b>Available to Withdraw:</b>\n₹${(er_myPP.pending || 0).toFixed(2)}`;
          await tg.editMessage(chatId, msgId, er_txt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] }).catch(()=>{});
          break;

        case 'part_with':
          if (!isPart) return;
          const wi_myPP = pDataGlobal.partners[userId.toString()];
          
          if (!wi_myPP.upi) {
            await tg.deleteMessage(chatId, msgId).catch(()=>{});
            await tg.sendMessage(chatId, "🏦 Please send your UPI ID to receive withdrawals:\n[KEY_PART_UPI]", { reply_markup: { force_reply: true, selective: true } });
          } else {
            await tg.deleteMessage(chatId, msgId).catch(()=>{});
            await tg.sendMessage(chatId, `💸 Enter withdrawal amount:\n(Available: ₹${(wi_myPP.pending || 0).toFixed(2)})\n[KEY_PART_WITHDRAW]`, { reply_markup: { force_reply: true, selective: true } });
          }
          break;

        // ================= RESELLER PANEL CALLBACKS =================
        case 'reseller_panel':
          if (!isRes) return;
          await tg.editMessage(chatId, msgId, "👑 <b>Reseller Panel</b>\n\nSelect an option below:", {
            inline_keyboard: [
              [BTN.inline("🔗 My Referral Link", "res_link")],
              [BTN.inline("📊 Statistics", "res_stats")],
              [BTN.inline("💵 My Number Price", "res_price"), BTN.inline("✏️ Change Price", "res_edit_price")],
              [BTN.inline("🏦 Edit UPI", "res_upi"), BTN.inline("💸 Withdraw", "res_with")],
              [BTN.inline("⚙️ My Settings", "res_settings")],
              [BTN.inline("⬅️ Back", "close_res_panel")]
            ]
          }).catch(()=>{});
          break;

        case 'res_settings':
          if (!isRes) return;
          await tg.editMessage(chatId, msgId, "⚙️ <b>My Settings</b>\n\nConfigure custom features for your referred users.", {
            inline_keyboard: [
              [BTN.inline("📢 Force Join Channel", "res_set_channel")],
              [BTN.inline("👥 Force Join Group", "res_set_group")],
              [BTN.inline("💬 Welcome Message", "res_welcome")],
              [BTN.inline("⬅️ Back", "reseller_panel")]
            ]
          }).catch(()=>{});
          break;

        case 'res_set_channel':
          if (!isRes) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, `📢 Send your Channel Username or Invite Link:\n(Send 'none' to remove)\n\nExample:\n@MyChannel\nhttps://t.me/MyChannel\n\n[KEY_RES_CHANNEL]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'res_set_group':
          if (!isRes) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, `👥 Send your Group Username or Invite Link:\n(Send 'none' to remove)\n\nExample:\n@MyGroup\nhttps://t.me/MyGroup\n\n[KEY_RES_GROUP]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'close_res_panel':
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, "🔙 Returning to Main Menu...", admin ? KB.adminMain : KB.main(isPart, isRes));
          break;

        case 'res_link':
          if (!isRes) return;
          const rlink_url = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=r_${userId}`;
          const rlink_msg = `🔗 <b>Your Referral Link</b>\n\n<code>${rlink_url}</code>\n\n━━━━━━━━━━━━━━\n\nShare this link with your users.\nEvery user joining through this link will permanently belong to you.`;
          await tg.editMessage(chatId, msgId, rlink_msg, { inline_keyboard: [[BTN.inline("⬅️ Back", "reseller_panel")]] }).catch(()=>{});
          break;

        case 'res_stats':
          if (!isRes) return;
          const st_rP = rDataGlobal.resellers[userId.toString()];
          const st_rS = rDataGlobal.stats[userId.toString()] || { joined: 0, deposits: 0, sales: 0 };
          const st_r_msg = `📊 <b>Statistics</b>\n\n👥 <b>Total Users:</b>\n${st_rS.joined}\n\n📦 <b>Successful Purchases:</b>\n${st_rS.sales}\n\n💳 <b>Total Deposits:</b>\n₹${(st_rS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(st_rP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(st_rP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(st_rP.pending || 0).toFixed(2)}\n\n💵 <b>Current Number Price:</b>\n₹${st_rP.price.toFixed(2)}`;
          await tg.editMessage(chatId, msgId, st_r_msg, { inline_keyboard: [[BTN.inline("⬅️ Back", "reseller_panel")]] }).catch(()=>{});
          break;

        case 'res_price':
          if (!isRes) return;
          const pr_rP = rDataGlobal.resellers[userId.toString()];
          await tg.editMessage(chatId, msgId, `💵 <b>My Number Price</b>\n\nYour current number price is: <code>₹${pr_rP.price.toFixed(2)}</code>\n\nAll your users will purchase numbers at this price.`, { inline_keyboard: [[BTN.inline("✏️ Change Price", "res_edit_price")], [BTN.inline("⬅️ Back", "reseller_panel")]] }).catch(()=>{});
          break;

        case 'res_edit_price':
          if (!isRes) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, `💵 Enter your new Number Price:\n(Minimum: ₹1.00)\n[KEY_RES_PRICE_EDIT_SELF]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'res_welcome':
          if (!isRes) return;
          const rw_rP = rDataGlobal.resellers[userId.toString()];
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          let curWel = rw_rP.welcomeMsg ? rw_rP.welcomeMsg : M.WELCOME;
          await tg.sendMessage(chatId, `Current Welcome Message:\n\n${curWel}`);
          await tg.sendMessage(chatId, `💬 Send your new Welcome Message:\n(Or send /start to cancel)\n[KEY_RES_WELCOME]`, { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'res_upi':
          if (!isRes) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, "🏦 Please send your new UPI ID to receive reseller withdrawals:\n[KEY_RES_UPI_SELF]", { reply_markup: { force_reply: true, selective: true } });
          break;

        case 'res_with':
          if (!isRes) return;
          const wi_rP = rDataGlobal.resellers[userId.toString()];
          
          if (!wi_rP.upi) {
            await tg.deleteMessage(chatId, msgId).catch(()=>{});
            await tg.sendMessage(chatId, "🏦 Please send your UPI ID to receive reseller withdrawals:\n[KEY_RES_UPI_SELF]", { reply_markup: { force_reply: true, selective: true } });
          } else {
            await tg.deleteMessage(chatId, msgId).catch(()=>{});
            await tg.sendMessage(chatId, `💸 Enter reseller withdrawal amount:\n(Available: ₹${(wi_rP.pending || 0).toFixed(2)})\n[KEY_RES_WITHDRAW]`, { reply_markup: { force_reply: true, selective: true } });
          }
          break;

        case 'back_to_admin':
          if (!admin) return;
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          await tg.sendMessage(chatId, "🔧 <b>Admin Panel</b>", KB.adminMain);
          break;
      }
    }
  } finally {
    // End of update timing block
    const time = performance.now() - tStart;
    server.log.info(`[END UPDATE] Update ID: ${updateId} | Execution time: ${time.toFixed(2)}ms`);
    if (time > 1000) {
      server.log.warn(`[SLOW UPDATE] Update ID: ${updateId} took ${time.toFixed(2)}ms`);
    }
  }
}

// Health Check Route
server.get('/', async (req, reply) => {
  return reply.send({
    status: 'ok',
    message: 'Bot is running'
  });
});
server.post('/webhook', async (req, reply) => {
  if (req.headers['x-telegram-bot-api-secret-token'] !== CONFIG.webhook.secret) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // Handle updates in background to return 200 immediately (preventing hanging/timeouts)
  handleUpdate(req.body).catch(error => {
    server.log.error(`[WEBHOOK BACKGROUND ERROR] ${error.message}`);
  });
  
  // ALWAYS return 200 instantly
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
      // Change this to true to kill the old pending broadcasts
      await tg.deleteWebhook({ drop_pending_updates: true }); 

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
