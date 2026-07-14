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

// In-memory store for Happy Hour creation drafts
const hhDrafts = new Map();

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
    [BTN.inline("⏰ Happy Hour Pricing", "hh_menu")],
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
  ] }),
  happyHourMenu: (hasSchedule) => {
    if (!hasSchedule) {
      return { inline_keyboard: [[BTN.inline("➕ Create Schedule", "hh_create")], [BTN.inline("🔙 Back", "admin_settings")]] };
    }
    return {
      inline_keyboard: [
        [BTN.inline("▶ Start Now", "hh_start"), BTN.inline("⏹ Stop Now", "hh_stop")],
        [BTN.inline("✏ Edit Schedule", "hh_edit"), BTN.inline("💰 Edit Temporary Price", "hh_edit_price")],
        [BTN.inline("🗑 Delete Schedule", "hh_delete")],
        [BTN.inline("🔙 Back", "admin_settings")]
      ]
    };
  }
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
// 3. TIMEZONE & BROADCAST HELPERS
// ==========================================

function getISTDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function getISTTimeStr() {
  const d = getISTDate();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

async function broadcastToAll(text) {
  const allUsers = await prisma.user.findMany({ select: { telegramId: true } });
  (async () => {
    for (const u of allUsers) {
      try {
        await tg.sendMessage(u.telegramId.toString(), text);
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {}
    }
  })();
}

// ==========================================
// 4. DATABASE HELPER FUNCTIONS
// ==========================================

async function getHappyHour() {
  const s = await prisma.setting.findUnique({ where: { key: 'HAPPY_HOUR_DATA' } });
  return s ? JSON.parse(s.value) : null;
}

async function saveHappyHour(data) {
  if (!data) {
    await prisma.setting.deleteMany({ where: { key: 'HAPPY_HOUR_DATA' } });
  } else {
    await prisma.setting.upsert({
      where: { key: 'HAPPY_HOUR_DATA' },
      update: { value: JSON.stringify(data) },
      create: { key: 'HAPPY_HOUR_DATA', value: JSON.stringify(data) }
    });
  }
}

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
  const s = await prisma.setting.findUnique({ where: { key: 'PARTNER_DATA' } });
  return s ? JSON.parse(s.value) : {
    partners: {}, // { "tgId": { commission: 20, earned: 0, paid: 0, pending: 0, active: true, upi: "" } }
    users: {},    // { "userTgId": "partnerTgId" }
    stats: {}     // { "partnerTgId": { joined: 0, deposits: 0 } }
  };
}

async function savePartnerData(data) {
  await prisma.setting.upsert({
    where: { key: 'PARTNER_DATA' },
    update: { value: JSON.stringify(data) },
    create: { key: 'PARTNER_DATA', value: JSON.stringify(data) }
  });
}

async function getResellerData() {
  const s = await prisma.setting.findUnique({ where: { key: 'RESELLER_DATA' } });
  return s ? JSON.parse(s.value) : {
    resellers: {}, // { "tgId": { price: 2.50, earned: 0, paid: 0, pending: 0, active: true, upi: "", welcomeMsg: "", channel: "", group: "" } }
    users: {},     // { "userTgId": "resellerTgId" }
    stats: {}      // { "resellerTgId": { joined: 0, deposits: 0, sales: 0 } }
  };
}

async function saveResellerData(data) {
  await prisma.setting.upsert({
    where: { key: 'RESELLER_DATA' },
    update: { value: JSON.stringify(data) },
    create: { key: 'RESELLER_DATA', value: JSON.stringify(data) }
  });
}

async function getMessages() {
  let dbMsgs = await prisma.setting.findUnique({ where: { key: 'CUSTOM_MESSAGES' } });
  
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
  
  const rData = await getResellerData();
  const rId = rData.users[userId.toString()];

  if (rId && rData.resellers[rId]) {
    const r = rData.resellers[rId];
    if (!r.channel && !r.group) return true;
    try {
      if (r.channel) {
         const cApi = getChatIdForApi(r.channel);
         const c = await tg.getChatMember(cApi, userId);
         if (!['creator', 'administrator', 'member', 'restricted'].includes(c?.status)) return false;
      }
      if (r.group) {
         const gApi = getChatIdForApi(r.group);
         const g = await tg.getChatMember(gApi, userId);
         if (!['creator', 'administrator', 'member', 'restricted'].includes(g?.status)) return false;
      }
      return true;
    } catch(e) { 
      console.error(`[FORCE JOIN RESELLER ERROR] Channel: ${r.channel} | Group: ${r.group} | Error:`, e.message);
      return false; 
    }
  }

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
    let channel, group;
    const rData = await getResellerData();
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
// 5. EXTERNAL SMS PROVIDER API HELPERS
// ==========================================

function buildSmsUrl(params = {}) {
  const url = new URL(CONFIG.sms.baseUrl || 'https://api.temporasms.com/stubs/handler_api.php');
  url.searchParams.append('api_key', CONFIG.sms.apiKey);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });
  return url.toString();
}

async function purchaseSms(settings, overridePrice) {
  try {
    const params = { action: 'getNumber', service: settings.serviceId, country: settings.countryId };
    if (settings.operatorId) params.operator = settings.operatorId;
    if (String(settings.operatorId) === '9' && overridePrice) params.maxPrice = overridePrice;
    
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
// 6. CORE BUSINESS LOGIC
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

        // --- RESELLER PROFIT LOGIC (UPDATED) ---
        if (otpsReceived === 1) {
           const rDataApprove = await getResellerData();
           const rId = rDataApprove.users[chatId];
           if (rId && rDataApprove.resellers[rId] && rDataApprove.resellers[rId].active) {
              // Sirf sale count hogi, balance nahi judega kyunki deposit pe mil chuka hai
              if (!rDataApprove.stats[rId]) rDataApprove.stats[rId] = {joined:0, deposits:0, sales:0};
              rDataApprove.stats[rId].sales += 1;
              await saveResellerData(rDataApprove);

              const ptUser = await prisma.user.findUnique({ where: { id: userDbId } });
              const username = ptUser?.username ? `@${ptUser.username}` : ptUser?.telegramId.toString();

              // Notification for sale
              const resMsg = `📦 <b>New Sale Made</b>\n\n👤 <b>User:</b>\n${esc(username)}\n\n💰 <b>Number Price:</b>\n₹${order.price.toFixed(2)}\n\n<i>(Profit was already credited to you when this user deposited balance)</i>`;
              await tg.sendMessage(rId, resMsg).catch(()=>{});
           }
        }
        // ------------------------------

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
// 7. WEBHOOK ROUTES & HANDLERS
// ==========================================

async function handleUpdate(update) {
  const M = await getMessages();

  // --- MESSAGE ROUTER ---
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    const userId = msg.from?.id;
    if (!chatId || !userId) return;

    // Block non-private chats completely
    if (msg.chat?.type !== 'private') {
      if (msg.text && msg.text.startsWith('/')) {
        await tg.sendMessage(chatId, "⚠️ Please use this bot in private chat.");
      }
      return;
    }

    // Track active user activity silently
    await markUserActive(userId);

    const admin = await isAdmin(userId);
    const pDataGlobal = await getPartnerData();
    const isPart = !!pDataGlobal.partners[userId.toString()];
    
    const rDataGlobal = await getResellerData();
    const isRes = !!rDataGlobal.resellers[userId.toString()];

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

    // Handle ForceReplies
    if (msg.reply_to_message?.text) {
      const promptText = msg.reply_to_message.text;

      // Admin replies
      if (admin) {
        // --- HAPPY HOUR FLOW ---
        if (promptText.includes('[KEY_HH_START]')) {
          if (!/^\d{2}:\d{2}$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid time format. Use HH:MM (24-hour).', { inline_keyboard: [[BTN.inline("🔙 Back", "hh_menu")]] });
          const draft = hhDrafts.get(userId) || {};
          draft.startTime = txt;
          hhDrafts.set(userId, draft);
          return await tg.sendMessage(chatId, `⏰ Enter End Time:\n(24-hour format, e.g. 16:00)\n\n[KEY_HH_END]`, { reply_markup: { force_reply: true, selective: true } });
        }

        if (promptText.includes('[KEY_HH_END]')) {
          if (!/^\d{2}:\d{2}$/.test(txt)) return await tg.sendMessage(chatId, '❌ Invalid time format. Use HH:MM (24-hour).', { inline_keyboard: [[BTN.inline("🔙 Back", "hh_menu")]] });
          const draft = hhDrafts.get(userId) || {};
          if (txt <= draft.startTime) return await tg.sendMessage(chatId, '❌ End Time must be strictly after Start Time.', { inline_keyboard: [[BTN.inline("🔙 Back", "hh_menu")]] });
          draft.endTime = txt;
          hhDrafts.set(userId, draft);
          return await tg.sendMessage(chatId, `💰 Enter Temporary Number Price:\n(e.g. 0.70)\n\n[KEY_HH_PRICE]`, { reply_markup: { force_reply: true, selective: true } });
        }

        if (promptText.includes('[KEY_HH_PRICE]')) {
          const price = Number(txt);
          if (isNaN(price) || price <= 0) return await tg.sendMessage(chatId, '❌ Invalid price.', { inline_keyboard: [[BTN.inline("🔙 Back", "hh_menu")]] });
          const draft = hhDrafts.get(userId) || {};
          draft.temporaryPrice = price;
          hhDrafts.set(userId, draft);

          const smsSettings = await getSmsSettings();
          const summary = `⏰ <b>Happy Hour Summary</b>\n\n<b>Start:</b>\n${draft.startTime} IST\n\n<b>End:</b>\n${draft.endTime} IST\n\n<b>Temporary Price:</b>\n₹${draft.temporaryPrice.toFixed(2)}\n\n<b>Current Price:</b>\n₹${smsSettings.maxPrice.toFixed(2)}\n\nConfirm?`;
          
          return await tg.sendMessage(chatId, summary, {
             inline_keyboard: [[BTN.inline("✅ Start Happy Hour", "hh_create_confirm"), BTN.inline("❌ Cancel", "hh_menu")]]
          });
        }

        if (promptText.includes('[KEY_HH_EDIT_PRICE]')) {
          const price = Number(txt);
          if (isNaN(price) || price <= 0) return await tg.sendMessage(chatId, '❌ Invalid price.', { inline_keyboard: [[BTN.inline("🔙 Back", "hh_menu")]] });
          const hh = await getHappyHour();
          if (hh) {
            hh.temporaryPrice = price;
            hh.announcementSent = true;
            hh.startedSent = false;
            hh.endedSent = false;
            await saveHappyHour(hh);
            
            await tg.sendMessage(chatId, `✅ Temporary Price updated to ₹${price.toFixed(2)}.`);
            const nMsg = `📢 Upcoming Happy Hour!\n\n🔥 Number Price will be only\n₹${hh.temporaryPrice.toFixed(2)}\n\n🕛 Starts\n${hh.startTime} IST\n\n🕓 Ends\n${hh.endTime} IST\n\nDon't miss this limited-time offer.\nBe ready before it starts! 🚀`;
            await broadcastToAll(nMsg);
            
            return await tg.sendMessage(chatId, "Redirecting to Happy Hour Menu...", { inline_keyboard: [[BTN.inline("🔙 Back to Menu", "hh_menu")]] });
          }
        }
        // -----------------------

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
          
          const pData = await getPartnerData();
          if(!pData.partners[targetPId]) {
             pData.partners[targetPId] = { commission: comm, earned: 0, paid: 0, pending: 0, active: true, upi: "" };
             if(!pData.stats[targetPId]) pData.stats[targetPId] = { joined: 0, deposits: 0 };
          } else {
             pData.partners[targetPId].commission = comm;
          }
          await savePartnerData(pData);
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
          
          const resD = await getResellerData();
          if(!resD.resellers[targetRId]) {
             resD.resellers[targetRId] = { price: price, earned: 0, paid: 0, pending: 0, active: true, upi: "", welcomeMsg: "", channel: "", group: "" };
             if(!resD.stats[targetRId]) resD.stats[targetRId] = { joined: 0, deposits: 0, sales: 0 };
          } else {
             resD.resellers[targetRId].price = price;
             resD.resellers[targetRId].active = true;
          }
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ <b>Reseller Added/Updated!</b>\n\nUser ID: <code>${targetRId}</code>\nPrice: <code>₹${price.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Resellers", "admin_resellers")]] });
        }

        if (promptText.includes('Enter new Number Price for Reseller')) {
          const keyMatch = promptText.match(/\[KEY_RES_PRICE_EDIT_ADMIN:\s*(\d+)\]/);
          if (!keyMatch) return;
          const targetRId = keyMatch[1];
          const price = Number(txt);
          if (isNaN(price) || price < 1) return await tg.sendMessage(chatId, '❌ Invalid price. Minimum allowed is ₹1.00.', { inline_keyboard: [[BTN.inline("🔙 Back", `admin_view_reseller_det:${targetRId}`)]] });
          
          const resD = await getResellerData();
          if(resD.resellers[targetRId]) {
             resD.resellers[targetRId].price = price;
             await saveResellerData(resD);
             return await tg.sendMessage(chatId, `✅ <b>Price Updated!</b>\n\nReseller: <code>${targetRId}</code>\nNew Price: <code>₹${price.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back", `admin_view_reseller_det:${targetRId}`)]] });
          }
        }

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
          await tg.sendMessage(chatId, `⏳ Sending broadcast in the background...`);
          await broadcastToAll(txt);
          return await tg.sendMessage(chatId, `✅ Broadcast background task started.`, { inline_keyboard: [[BTN.inline("🔙 Back", "back_to_admin")]] });
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

        if (promptText.includes('Enter new UPI for Partner')) {
          const keyMatch = promptText.match(/\[KEY_PART_UPI_ADMIN:\s*(\d+)\]/);
          if (!keyMatch) return;
          const targetPId = keyMatch[1];
          const pData = await getPartnerData();
          if (pData.partners[targetPId]) {
            pData.partners[targetPId].upi = txt;
            await savePartnerData(pData);
            return await tg.sendMessage(chatId, `✅ UPI updated for Partner ${targetPId}: <code>${esc(txt)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Partners", "admin_partners")]] });
          }
        }
      }

      // Partner replies
      if (promptText.includes('[KEY_PART_UPI]')) {
        const pData = await getPartnerData();
        if (pData.partners[userId.toString()]) {
          pData.partners[userId.toString()].upi = txt;
          await savePartnerData(pData);
          return await tg.sendMessage(chatId, `✅ UPI ID saved: <code>${esc(txt)}</code>\n\nYou can now request a withdrawal from the Partner Panel.`);
        }
      }

      if (promptText.includes('[KEY_PART_WITHDRAW]')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
        const pData = await getPartnerData();
        const myPP = pData.partners[userId.toString()];
        if (!myPP) return;
        if (amt > (myPP.pending || 0)) return await tg.sendMessage(chatId, `❌ Insufficient pending balance. Your available balance is ₹${(myPP.pending || 0).toFixed(2)}.`);
        
        const sys = await getSysSettings();
        const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
        if (aId) {
          const reqMsg = `💸 <b>New Partner Withdrawal Request</b>\n\n👤 <b>Partner ID:</b> <code>${userId}</code>\n💰 <b>Amount:</b> ₹${amt}\n🏦 <b>UPI:</b> <code>${esc(myPP.upi)}</code>`;
          await tg.sendMessage(aId, reqMsg, { inline_keyboard: [[BTN.inline("View Partner", `admin_view_partner_det:${userId}`)]] });
        }
        return await tg.sendMessage(chatId, `✅ Withdrawal request for ₹${amt} sent to admin.`);
      }

      // Reseller replies
      if (promptText.includes('[KEY_RES_PRICE_EDIT_SELF]')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt < 1) return await tg.sendMessage(chatId, '❌ Invalid price. Minimum allowed is ₹1.00.', { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
        const resD = await getResellerData();
        if (resD.resellers[userId.toString()]) {
          resD.resellers[userId.toString()].price = amt;
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ <b>Number Price Updated!</b>\n\nNew Price: <code>₹${amt.toFixed(2)}</code>`, { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
        }
      }

      if (promptText.includes('[KEY_RES_WELCOME]')) {
        const resD = await getResellerData();
        if (resD.resellers[userId.toString()]) {
          resD.resellers[userId.toString()].welcomeMsg = txt;
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ <b>Custom Welcome Message Saved!</b>`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
        }
      }

      if (promptText.includes('[KEY_RES_CHANNEL]')) {
        const resD = await getResellerData();
        if (resD.resellers[userId.toString()]) {
          if (txt.toLowerCase() === 'none' || txt.toLowerCase() === 'remove') {
              resD.resellers[userId.toString()].channel = null;
          } else {
              resD.resellers[userId.toString()].channel = txt;
          }
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ Force Join Channel updated!`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
        }
      }

      if (promptText.includes('[KEY_RES_GROUP]')) {
        const resD = await getResellerData();
        if (resD.resellers[userId.toString()]) {
          if (txt.toLowerCase() === 'none' || txt.toLowerCase() === 'remove') {
              resD.resellers[userId.toString()].group = null;
          } else {
              resD.resellers[userId.toString()].group = txt;
          }
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ Force Join Group updated!`, { inline_keyboard: [[BTN.inline("🔙 Back to Settings", "res_settings")]] });
        }
      }

      if (promptText.includes('[KEY_RES_UPI_SELF]')) {
        const resD = await getResellerData();
        if (resD.resellers[userId.toString()]) {
          resD.resellers[userId.toString()].upi = txt;
          await saveResellerData(resD);
          return await tg.sendMessage(chatId, `✅ UPI ID saved: <code>${esc(txt)}</code>\n\nYou can now request a withdrawal from the Reseller Panel.`, { inline_keyboard: [[BTN.inline("🔙 Back to Panel", "reseller_panel")]] });
        }
      }

      if (promptText.includes('[KEY_RES_WITHDRAW]')) {
        const amt = Number(txt);
        if (isNaN(amt) || amt <= 0) return await tg.sendMessage(chatId, '❌ Invalid amount.');
        const resD = await getResellerData();
        const myRes = resD.resellers[userId.toString()];
        if (!myRes) return;
        if (amt > (myRes.pending || 0)) return await tg.sendMessage(chatId, `❌ Insufficient pending balance. Your available balance is ₹${(myRes.pending || 0).toFixed(2)}.`, { inline_keyboard: [[BTN.inline("🔙 Back", "reseller_panel")]] });
        
        const sys = await getSysSettings();
        const aId = sys?.adminChatId || CONFIG?.telegram?.adminId;
        if (aId) {
          const reqMsg = `💸 <b>New Reseller Withdrawal Request</b>\n\n👑 <b>Reseller ID:</b> <code>${userId}</code>\n💰 <b>Amount:</b> ₹${amt}\n🏦 <b>UPI:</b> <code>${esc(myRes.upi)}</code>`;
          await tg.sendMessage(aId, reqMsg, { inline_keyboard: [[BTN.inline("View Reseller", `admin_view_reseller_det:${userId}`)]] });
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
            const pData = await getPartnerData();
            if (pData.partners[pTgId]) {
              if (!pData.users[String(userId)]) {
                pData.users[String(userId)] = pTgId;
                if(!pData.stats[pTgId]) pData.stats[pTgId] = { joined: 0, deposits: 0 };
                pData.stats[pTgId].joined += 1;
                await savePartnerData(pData);
                
                await tg.sendMessage(pTgId, `🎉 <b>New Partner Referral</b>\n\nA new user has joined using your link!\nThey are now permanently linked to your account.`).catch(()=>{});
              }
            }
          }
        } else if (payload.startsWith('r_')) {
          const rTgId = payload.replace('r_', '');
          if (isNewUser && rTgId !== String(userId)) {
            const rData = await getResellerData();
            if (rData.resellers[rTgId]) {
              if (!rData.users[String(userId)]) {
                rData.users[String(userId)] = rTgId;
                if(!rData.stats[rTgId]) rData.stats[rTgId] = { joined: 0, deposits: 0, sales: 0 };
                rData.stats[rTgId].joined += 1;
                await saveResellerData(rData);
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
      
      if (!(await verifyAccess(chatId, userId))) return;

      if (pendingReferrals.has(userId)) {
        await processReferral(userId, pendingReferrals.get(userId));
        pendingReferrals.delete(userId);
      }

      let welcomeMsg = M.WELCOME;
      const rDataFetch = await getResellerData();
      const myMappedReseller = rDataFetch.users[userId.toString()];
      if (myMappedReseller) {
         const resInfo = rDataFetch.resellers[myMappedReseller];
         if (resInfo && resInfo.welcomeMsg) {
             welcomeMsg = resInfo.welcomeMsg;
         }
      }

      return await tg.sendMessage(chatId, welcomeMsg, admin ? KB.adminMain : KB.main(isPart, isRes));
    }

    if (!(await verifyAccess(chatId, userId))) return;

    switch (txt) {
      case '🐦 Get Twitter Number':
        const uBuy = await getUser(userId);
        const act = await prisma.order.findFirst({ where: { userId: uBuy.id, status: 'ACTIVE' } });
        if (act) return await tg.sendMessage(chatId, M.ACTIVE_ORDER_EXISTS || MSG.ACTIVE_ORDER_EXISTS);
        
        const rDataGlobalTx = await getResellerData();
        const myResellerId = rDataGlobalTx.users[userId.toString()];
        const smsSet = await getSmsSettings();
        const hhState = await getHappyHour();
        
        let userPrice = smsSet.maxPrice;
        let smsMaxOverride = null;

        // Apply Happy Hour pricing uniformly
        if (hhState && hhState.enabled) {
            userPrice = hhState.temporaryPrice;
            smsMaxOverride = hhState.temporaryPrice;
        } else if (myResellerId && rDataGlobalTx.resellers[myResellerId] && rDataGlobalTx.resellers[myResellerId].active) {
            userPrice = rDataGlobalTx.resellers[myResellerId].price;
        }
        
        if (uBuy.balance.toNumber() < userPrice) return await tg.sendMessage(chatId, M.NO_BALANCE);
        
        const loadMsg = await tg.sendMessage(chatId, M.PURCHASING);
        const pr = await purchaseSms(smsSet, smsMaxOverride);
        if (!pr.success) return await tg.editMessage(chatId, loadMsg?.message_id, M.NUMBER_FAILED);

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
                service: String(smsSet.serviceId),
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

          await tg.editMessage(chatId, loadMsg?.message_id, successMsg, KB.cancel(pr.activationId));
          startOtpPolling(chatId, uBuy.id, ord.id, pr.activationId, pr.phoneNumber, userPrice, loadMsg?.message_id, smsSet.interval);
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
        const rLink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=${userId}`;
        const rTxt = M.REFER_INFO.replace('{amount}', esc(sysRef?.referralBonus || 0.5)).replace('{referralLink}', esc(rLink)) + `\n\n📊 <b>Your Stats</b>\n👥 <b>Referrals:</b> <code>${uRef.totalReferrals}</code>\n💰 <b>Earnings:</b> <code>₹${esc(uRef.referralEarnings)}</code>`;
        await tg.sendMessage(chatId, rTxt);
        break;

      case '📞 Support':
        const sSup = await getSysSettings();
        await tg.sendMessage(chatId, M.SUPPORT, KB.support(sSup?.supportUsername || CONFIG.telegram.supportUsername));
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
        const totU = await prisma.user.count();
        
        let actU = 0;
        try {
           actU = await prisma.user.count({ 
              where: { updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } 
           });
        } catch(e) { actU = 'N/A'; }
        
        const succOrders = await prisma.order.count({ where: { otpCount: { gte: 1 } } });
        const actO = await prisma.order.count({ where: { status: 'ACTIVE' } });
        
        const revAg = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'APPROVED' } });
        const revAmt = Number(revAg._sum.amount || 0);
        
        const walAg = await prisma.user.aggregate({ _sum: { balance: true } });
        const totWal = Number(walAg._sum.balance || 0);
        
        const profitAg = await prisma.order.aggregate({ _sum: { price: true }, where: { otpCount: { gte: 1 } } });
        const totPrice = Number(profitAg._sum.price || 0);
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
    setTimeout(() => answeredCallbacks.delete(cb.id), 120000); 

    try { 
      await tg.answerCallbackQuery(cb.id); 
    } catch (e) {}

    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;
    const userId = cb.from?.id;
    if (!chatId || !userId) return;

    // Track active user activity silently
    await markUserActive(userId);

    const dataParts = cb.data ? cb.data.split(':') : [];
    const action = dataParts[0];
    const args = dataParts.slice(1);
    const admin = await isAdmin(userId);
    const pDataGlobal = await getPartnerData();
    const isPart = !!pDataGlobal.partners[userId.toString()];
    const rDataGlobal = await getResellerData();
    const isRes = !!rDataGlobal.resellers[userId.toString()];

    switch (action) {
      // ==========================================
      // HAPPY HOUR CALLBACKS
      // ==========================================
      case 'hh_menu':
        if (!admin) return;
        const hhCurrent = await getHappyHour();
        const smsCurr = await getSmsSettings();
        
        let hhTxt = "⏰ <b>Happy Hour Pricing</b>\n\n";
        if (hhCurrent) {
          const state = hhCurrent.enabled ? '🟢 Running' : '🔴 Scheduled / Disabled';
          hhTxt += `📊 <b>Current Status:</b>\nStatus: ${state}\n\n`;
          hhTxt += `<b>Start Time:</b> ${hhCurrent.startTime} IST\n`;
          hhTxt += `<b>End Time:</b> ${hhCurrent.endTime} IST\n\n`;
          hhTxt += `<b>Temporary Price:</b> ₹${hhCurrent.temporaryPrice.toFixed(2)}\n`;
          hhTxt += `<b>Original Price:</b> ₹${hhCurrent.originalPrice.toFixed(2)}\n`;
          hhTxt += `<b>Current System Price:</b> ₹${smsCurr.maxPrice.toFixed(2)}\n\n`;
          hhTxt += `<b>Upcoming Broadcast:</b> ${hhCurrent.announcementSent ? 'Sent ✅' : 'Pending ⏳'}\n`;
          hhTxt += `<b>Start Broadcast:</b> ${hhCurrent.startedSent ? 'Sent ✅' : 'Pending ⏳'}\n`;
          hhTxt += `<b>End Broadcast:</b> ${hhCurrent.endedSent ? 'Sent ✅' : 'Pending ⏳'}\n`;
        } else {
          hhTxt += `📊 <b>Current Status:</b>\nNo schedule exists.\n\n<b>Current System Price:</b> ₹${smsCurr.maxPrice.toFixed(2)}\n`;
        }
        
        await tg.editMessage(chatId, msgId, hhTxt, KB.happyHourMenu(!!hhCurrent));
        break;

      case 'hh_create':
      case 'hh_edit':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, `⏰ Enter Start Time:\n(24-hour format, e.g. 12:00)\n\n[KEY_HH_START]`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'hh_edit_price':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, `💰 Enter new Temporary Number Price:\n(e.g. 0.70)\n\n[KEY_HH_EDIT_PRICE]`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'hh_create_confirm':
        if (!admin) return;
        const draft = hhDrafts.get(userId);
        if (!draft) return;

        const smsForDraft = await getSmsSettings();
        const newHh = {
          startTime: draft.startTime,
          endTime: draft.endTime,
          temporaryPrice: draft.temporaryPrice,
          originalPrice: smsForDraft.maxPrice,
          enabled: false,
          announcementSent: true,
          startedSent: false,
          endedSent: false
        };
        await saveHappyHour(newHh);
        hhDrafts.delete(userId);
        
        await tg.editMessageReplyMarkup(chatId, msgId, { inline_keyboard: [] }).catch(()=>{});
        await tg.sendMessage(chatId, `✅ <b>Happy Hour Schedule Saved!</b>`, { inline_keyboard: [[BTN.inline("🔙 Back to Menu", "hh_menu")]] });
        
        const annMsg = `📢 Upcoming Happy Hour!\n\n🔥 Number Price will be only\n₹${newHh.temporaryPrice.toFixed(2)}\n\n🕛 Starts\n${newHh.startTime} IST\n\n🕓 Ends\n${newHh.endTime} IST\n\nDon't miss this limited-time offer.\nBe ready before it starts! 🚀`;
        await broadcastToAll(annMsg);
        break;

      case 'hh_start':
        if (!admin) return;
        const hhStart = await getHappyHour();
        if (hhStart) {
           const sForStart = await getSmsSettings();
           hhStart.originalPrice = sForStart.maxPrice;
           hhStart.enabled = true;
           hhStart.startedSent = true;
           await saveHappyHour(hhStart);

           // Change system base price
           sForStart.maxPrice = hhStart.temporaryPrice;
           await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sForStart) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sForStart) } });

           await tg.answerCallbackQuery(cb.id, { text: "✅ Happy Hour Started Instantly!", show_alert: true }).catch(()=>{});
           const sMsg = `🎉 Happy Hour Started!\n\n🔥 Number Price\n₹${hhStart.temporaryPrice.toFixed(2)}\n\n⏳ Offer Ends\n${hhStart.endTime} IST\n\nBuy now before the price goes back.`;
           await broadcastToAll(sMsg);
           
           update.callback_query.data = 'hh_menu';
           return handleUpdate(update);
        }
        break;

      case 'hh_stop':
        if (!admin) return;
        const hhStop = await getHappyHour();
        if (hhStop) {
           const sForStop = await getSmsSettings();
           sForStop.maxPrice = hhStop.originalPrice;
           await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sForStop) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sForStop) } });

           hhStop.enabled = false;
           hhStop.endedSent = true;
           await saveHappyHour(hhStop);

           await tg.answerCallbackQuery(cb.id, { text: "⏹ Happy Hour Stopped Instantly!", show_alert: true }).catch(()=>{});
           const endMsg = `⏰ Happy Hour Ended\n\nThe special offer has ended.\n\nCurrent Number Price\n₹${sForStop.maxPrice.toFixed(2)}\n\nThank you for using our service ❤️`;
           await broadcastToAll(endMsg);

           update.callback_query.data = 'hh_menu';
           return handleUpdate(update);
        }
        break;

      case 'hh_delete':
        if (!admin) return;
        const hhDel = await getHappyHour();
        if (hhDel) {
           if (hhDel.enabled) {
              const sForDel = await getSmsSettings();
              sForDel.maxPrice = hhDel.originalPrice;
              await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sForDel) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sForDel) } });
           }
           await saveHappyHour(null);
           await tg.answerCallbackQuery(cb.id, { text: "🗑 Schedule Deleted!", show_alert: true }).catch(()=>{});
           
           update.callback_query.data = 'hh_menu';
           return handleUpdate(update);
        }
        break;

      // ==========================================
      // OTHER EXISTING CALLBACKS
      // ==========================================

      case 'verify_join':
        const isJoined = await checkForceJoin(userId);
        if (isJoined || admin) {
          await tg.deleteMessage(chatId, msgId).catch(()=>{});
          if (pendingReferrals.has(userId)) {
            await processReferral(userId, pendingReferrals.get(userId));
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

        // ==========================================
        // PARTNER COMMISSION LOGIC
        // ==========================================
        const pDataApprove = await getPartnerData();
        const ptIdStr = targetTgId.toString();
        const pRefId = pDataApprove.users[ptIdStr];
        
        if (pRefId && pDataApprove.partners[pRefId] && pDataApprove.partners[pRefId].active) {
            const commRate = pDataApprove.partners[pRefId].commission;
            const earned = amt * (commRate / 100);
            
            pDataApprove.partners[pRefId].pending += earned;
            pDataApprove.partners[pRefId].earned += earned;
            
            if(!pDataApprove.stats[pRefId]) pDataApprove.stats[pRefId] = { joined: 0, deposits: 0 };
            pDataApprove.stats[pRefId].deposits += amt;
            
            await savePartnerData(pDataApprove);
            await tg.sendMessage(pRefId, `🎉 <b>Partner Commission</b>\n\nA referred user deposited ₹${amt}.\n💰 You earned: <code>₹${earned.toFixed(2)}</code>`).catch(()=>{});
        }

        // ==========================================
        // RESELLER DEPOSIT LOGIC
        // ==========================================
        const rDataDep = await getResellerData();
        const hhDep = await getHappyHour();
        const rDepId = rDataDep.users[ptIdStr];
        if (rDepId && rDataDep.resellers[rDepId] && rDataDep.resellers[rDepId].active) {
           const myReseller = rDataDep.resellers[rDepId];
           
           let userPaidPrice = myReseller.price; 
           if (hhDep && hhDep.enabled) {
              userPaidPrice = hhDep.temporaryPrice; // Override price logic for Reseller profit calculation
           }
           
           const basePrice = 1;
           const profitMargin = Math.max(0, userPaidPrice - basePrice);
           let profitOnDeposit = 0;
           
           if (profitMargin > 0 && userPaidPrice > 0) {
               const profitRatio = profitMargin / userPaidPrice;
               profitOnDeposit = amt * profitRatio;
           }

           if (!rDataDep.stats[rDepId]) rDataDep.stats[rDepId] = { joined: 0, deposits: 0, sales: 0 };
           rDataDep.stats[rDepId].deposits += amt;

           if (profitOnDeposit > 0) {
               myReseller.pending += profitOnDeposit;
               myReseller.earned += profitOnDeposit;
               await tg.sendMessage(rDepId, `🎉 <b>Reseller Commission</b>\n\nA referred user deposited ₹${amt}.\n💰 You earned: <code>₹${profitOnDeposit.toFixed(2)}</code>`).catch(()=>{});
           }
           
           await saveResellerData(rDataDep);
        }

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
        });
        break;

      case 'admin_view_partners':
        if (!admin) return;
        const pListD = await getPartnerData();
        const ptIds = Object.keys(pListD.partners);
        if (ptIds.length === 0) {
           return await tg.editMessage(chatId, msgId, "🤝 No partners found.", { inline_keyboard: [[BTN.inline("🔙 Back", "admin_partners")]] });
        }
        
        let pKbd = [];
        ptIds.forEach(id => {
           pKbd.push([BTN.inline(`👤 ${id} (${pListD.partners[id].commission}%)`, `admin_view_partner_det:${id}`)]);
        });
        pKbd.push([BTN.inline("🔙 Back", "admin_partners")]);
        await tg.editMessage(chatId, msgId, "📋 <b>Select a Partner to view stats:</b>", { inline_keyboard: pKbd });
        break;
        
      case 'admin_view_partner_det':
        if (!admin) return;
        const dtId = args[0];
        const aPtD = await getPartnerData();
        if (!aPtD.partners[dtId]) return;
        
        const ptUser = await prisma.user.findUnique({ where: { telegramId: BigInt(dtId) } });
        let pUserName = ptUser && ptUser.username ? `@${ptUser.username}` : "Not Set";
        
        const myPP = aPtD.partners[dtId];
        const mySS = aPtD.stats[dtId] || { joined: 0, deposits: 0 };
        const plink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=p_${dtId}`;
        
        const pDetMsg = `👤 <b>Partner:</b>\n${esc(pUserName)}\n\n🔗 <b>Referral Link:</b>\n<code>${plink}</code>\n\n👥 <b>Total Joined Users:</b>\n${mySS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(mySS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(myPP.pending || 0).toFixed(2)}\n\n<b>Commission %:</b> ${myPP.commission}%\n<b>Status:</b> ${myPP.active ? 'ACTIVE' : 'INACTIVE'}`;
        
        await tg.editMessage(chatId, msgId, pDetMsg, {
           inline_keyboard: [
             [BTN.inline("💸 Mark Paid", `admin_pay_partner:${dtId}`), BTN.inline(myPP.active ? "❌ Disable Partner" : "✅ Enable Partner", `admin_tog_partner:${dtId}`)],
             [BTN.inline("✏️ Change UPI", `admin_upi_partner:${dtId}`), BTN.inline("🔙 Back", "admin_view_partners")]
           ]
        });
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
        const payD = await getPartnerData();
        if (payD.partners[payId] && payD.partners[payId].pending > 0) {
           payD.partners[payId].paid += payD.partners[payId].pending;
           payD.partners[payId].pending = 0;
           await savePartnerData(payD);
           await tg.answerCallbackQuery(cb.id, { text: "✅ Partner pending balance marked as Paid.", show_alert: true }).catch(()=>{});
           
           update.callback_query.data = `admin_view_partner_det:${payId}`;
           return handleUpdate(update);
        } else {
           await tg.answerCallbackQuery(cb.id, { text: "⚠️ No pending balance to pay.", show_alert: true }).catch(()=>{});
        }
        break;

      case 'admin_tog_partner':
        if (!admin) return;
        const togId = args[0];
        const togD = await getPartnerData();
        if (togD.partners[togId]) {
           togD.partners[togId].active = !togD.partners[togId].active;
           await savePartnerData(togD);
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
        });
        break;

      case 'admin_add_reseller':
        if (!admin) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, '👑 Enter Telegram User ID to make them a Reseller:', { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'admin_view_resellers':
        if (!admin) return;
        const resListD = await getResellerData();
        const resIds = Object.keys(resListD.resellers);
        if (resIds.length === 0) {
           return await tg.editMessage(chatId, msgId, "👑 No resellers found.", { inline_keyboard: [[BTN.inline("🔙 Back", "admin_resellers")]] });
        }
        
        let rKbd = [];
        for (const id of resIds) {
           const uObj = await prisma.user.findUnique({ where: { telegramId: BigInt(id) } });
           const un = uObj?.username ? `@${uObj.username}` : id;
           rKbd.push([BTN.inline(`👑 ${un} (₹${resListD.resellers[id].price.toFixed(2)})`, `admin_view_reseller_det:${id}`)]);
        }
        rKbd.push([BTN.inline("🔙 Back", "admin_resellers")]);
        await tg.editMessage(chatId, msgId, "📋 <b>Select a Reseller to view stats:</b>", { inline_keyboard: rKbd });
        break;
        
      case 'admin_view_reseller_det':
        if (!admin) return;
        const detResId = args[0];
        const aResD = await getResellerData();
        if (!aResD.resellers[detResId]) return;
        
        const resUser = await prisma.user.findUnique({ where: { telegramId: BigInt(detResId) } });
        let rUserName = resUser && resUser.username ? `@${resUser.username}` : "Not Set";
        
        const myRP = aResD.resellers[detResId];
        const myRS = aResD.stats[detResId] || { joined: 0, deposits: 0, sales: 0 };
        const rlink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=r_${detResId}`;
        
        const rDetMsg = `👑 <b>Reseller:</b>\n${esc(rUserName)}\n\n🆔 <b>User ID:</b>\n<code>${detResId}</code>\n\n🔗 <b>Referral Link:</b>\n<code>${rlink}</code>\n\n👥 <b>Users:</b>\n${myRS.joined}\n\n📦 <b>Successful Purchases:</b>\n${myRS.sales}\n\n💳 <b>Total Deposits:</b>\n₹${(myRS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(myRP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(myRP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(myRP.pending || 0).toFixed(2)}\n\n💵 <b>Current Number Price:</b>\n₹${myRP.price.toFixed(2)}\n\n<b>Status:</b> ${myRP.active ? 'ACTIVE' : 'INACTIVE'}`;
        
        await tg.editMessage(chatId, msgId, rDetMsg, {
           inline_keyboard: [
             [BTN.inline("💵 Edit Number Price", `admin_edit_reseller_price:${detResId}`)],
             [BTN.inline(myRP.active ? "❌ Disable Reseller" : "✅ Enable Reseller", `admin_tog_reseller:${detResId}`), BTN.inline("💸 Mark Paid", `admin_pay_reseller:${detResId}`)],
             [BTN.inline("🔙 Back", "admin_view_resellers")]
           ]
        });
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
        const togResD = await getResellerData();
        if (togResD.resellers[togResId]) {
           togResD.resellers[togResId].active = !togResD.resellers[togResId].active;
           await saveResellerData(togResD);
           update.callback_query.data = `admin_view_reseller_det:${togResId}`;
           return handleUpdate(update);
        }
        break;

      case 'admin_pay_reseller':
        if (!admin) return;
        const payResId = args[0];
        const payResD = await getResellerData();
        if (payResD.resellers[payResId] && payResD.resellers[payResId].pending > 0) {
           payResD.resellers[payResId].paid += payResD.resellers[payResId].pending;
           payResD.resellers[payResId].pending = 0;
           await saveResellerData(payResD);
           await tg.answerCallbackQuery(cb.id, { text: "✅ Reseller pending balance marked as Paid.", show_alert: true }).catch(()=>{});
           update.callback_query.data = `admin_view_reseller_det:${payResId}`;
           return handleUpdate(update);
        } else {
           await tg.answerCallbackQuery(cb.id, { text: "⚠️ No pending balance to pay.", show_alert: true }).catch(()=>{});
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
        });
        break;

      case 'part_link':
        if (!isPart) return;
        const link_pStatInfo = await getPartnerData();
        const link_myPP = link_pStatInfo.partners[userId.toString()];
        const link_myS = link_pStatInfo.stats[userId.toString()] || { joined: 0, deposits: 0 };
        const link_myLink = `https://t.me/${CONFIG.telegram.botUsername || 'bot'}?start=p_${userId}`;
        
        const link_myPnlTxt = `🔗 <b>Your Referral Link</b>\n\n<code>${link_myLink}</code>\n\n━━━━━━━━━━━━━━\n\n👥 <b>Users Joined:</b>\n${link_myS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(link_myS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(link_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(link_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(link_myPP.pending || 0).toFixed(2)}\n\n━━━━━━━━━━━━━━\n\nShare this link to invite new users.\nYou'll automatically earn your commission whenever your referred users make approved deposits.`;
        
        await tg.editMessage(chatId, msgId, link_myPnlTxt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] });
        break;

      case 'part_stats':
        if (!isPart) return;
        const st_pStatInfo = await getPartnerData();
        const st_myPP = st_pStatInfo.partners[userId.toString()];
        const st_myS = st_pStatInfo.stats[userId.toString()] || { joined: 0, deposits: 0 };
        
        const st_txt = `📊 <b>Statistics</b>\n\n👥 <b>Total Users:</b>\n${st_myS.joined}\n\n💳 <b>Total Deposits:</b>\n₹${(st_myS.deposits || 0).toFixed(2)}\n\n<b>Commission %:</b>\n${st_myPP.commission}%\n\n💰 <b>Lifetime Earnings:</b>\n₹${(st_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(st_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(st_myPP.pending || 0).toFixed(2)}`;
        await tg.editMessage(chatId, msgId, st_txt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] });
        break;

      case 'part_earn':
        if (!isPart) return;
        const er_pStatInfo = await getPartnerData();
        const er_myPP = er_pStatInfo.partners[userId.toString()];
        
        const er_txt = `💰 <b>Earnings</b>\n\n💰 <b>Lifetime Earnings:</b>\n₹${(er_myPP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(er_myPP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(er_myPP.pending || 0).toFixed(2)}\n\n✅ <b>Available to Withdraw:</b>\n₹${(er_myPP.pending || 0).toFixed(2)}`;
        await tg.editMessage(chatId, msgId, er_txt, { inline_keyboard: [[BTN.inline("⬅️ Back", "part_panel")]] });
        break;

      case 'part_with':
        if (!isPart) return;
        const wi_pStatInfo = await getPartnerData();
        const wi_myPP = wi_pStatInfo.partners[userId.toString()];
        
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
        });
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
        });
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
        await tg.editMessage(chatId, msgId, rlink_msg, { inline_keyboard: [[BTN.inline("⬅️ Back", "reseller_panel")]] });
        break;

      case 'res_stats':
        if (!isRes) return;
        const st_rD = await getResellerData();
        const st_rP = st_rD.resellers[userId.toString()];
        const st_rS = st_rD.stats[userId.toString()] || { joined: 0, deposits: 0, sales: 0 };
        const st_r_msg = `📊 <b>Statistics</b>\n\n👥 <b>Total Users:</b>\n${st_rS.joined}\n\n📦 <b>Successful Purchases:</b>\n${st_rS.sales}\n\n💳 <b>Total Deposits:</b>\n₹${(st_rS.deposits || 0).toFixed(2)}\n\n💰 <b>Lifetime Earnings:</b>\n₹${(st_rP.earned || 0).toFixed(2)}\n\n💸 <b>Paid:</b>\n₹${(st_rP.paid || 0).toFixed(2)}\n\n🕒 <b>Pending:</b>\n₹${(st_rP.pending || 0).toFixed(2)}\n\n💵 <b>Current Number Price:</b>\n₹${st_rP.price.toFixed(2)}`;
        await tg.editMessage(chatId, msgId, st_r_msg, { inline_keyboard: [[BTN.inline("⬅️ Back", "reseller_panel")]] });
        break;

      case 'res_price':
        if (!isRes) return;
        const pr_rD = await getResellerData();
        const pr_rP = pr_rD.resellers[userId.toString()];
        await tg.editMessage(chatId, msgId, `💵 <b>My Number Price</b>\n\nYour current number price is: <code>₹${pr_rP.price.toFixed(2)}</code>\n\nAll your users will purchase numbers at this price.`, { inline_keyboard: [[BTN.inline("✏️ Change Price", "res_edit_price")], [BTN.inline("⬅️ Back", "reseller_panel")]] });
        break;

      case 'res_edit_price':
        if (!isRes) return;
        await tg.deleteMessage(chatId, msgId).catch(()=>{});
        await tg.sendMessage(chatId, `💵 Enter your new Number Price:\n(Minimum: ₹1.00)\n[KEY_RES_PRICE_EDIT_SELF]`, { reply_markup: { force_reply: true, selective: true } });
        break;

      case 'res_welcome':
        if (!isRes) return;
        const rw_rD = await getResellerData();
        const rw_rP = rw_rD.resellers[userId.toString()];
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
        const wi_rD = await getResellerData();
        const wi_rP = wi_rD.resellers[userId.toString()];
        
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

  try {
    await handleUpdate(req.body);
  } catch (error) {
    server.log.error('[WEBHOOK ERROR]', error.message);
  }
  
  // ALWAYS return 200 to prevent Telegram from dropping the webhook
  return reply.code(200).send({ ok: true });
});

// ==========================================
// 8. BACKGROUND CRON & POLLING TASKS
// ==========================================

setInterval(async () => {
  try {
    const hh = await getHappyHour();
    if (!hh) return;
    
    const nowStr = getISTTimeStr();
    const sConf = await getSmsSettings();

    if (nowStr >= hh.startTime && nowStr < hh.endTime) {
      if (!hh.enabled) {
         hh.originalPrice = sConf.maxPrice;
         hh.enabled = true;
         
         sConf.maxPrice = hh.temporaryPrice;
         await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sConf) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sConf) } });
         await saveHappyHour(hh);
      }
      if (hh.enabled && !hh.startedSent) {
         hh.startedSent = true;
         await saveHappyHour(hh);
         const sMsg = `🎉 Happy Hour Started!\n\n🔥 Number Price\n₹${hh.temporaryPrice.toFixed(2)}\n\n⏳ Offer Ends\n${hh.endTime} IST\n\nBuy now before the price goes back.`;
         await broadcastToAll(sMsg);
      }
    } else if (nowStr >= hh.endTime && hh.enabled) {
      sConf.maxPrice = hh.originalPrice;
      await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sConf) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sConf) } });

      hh.enabled = false;
      await saveHappyHour(hh);

      if (!hh.endedSent) {
         hh.endedSent = true;
         await saveHappyHour(hh);
         const endMsg = `⏰ Happy Hour Ended\n\nThe special offer has ended.\n\nCurrent Number Price\n₹${sConf.maxPrice.toFixed(2)}\n\nThank you for using our service ❤️`;
         await broadcastToAll(endMsg);
      }
    }
  } catch (error) {
    server.log.error(`[HAPPY HOUR ERROR]`, error.message);
  }
}, 30000); // Check every 30 seconds

// ==========================================
// 9. GLOBAL ERROR HANDLERS
// ==========================================

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ==========================================
// 10. SERVER STARTUP, RESUME & SHUTDOWN
// ==========================================

async function resumeHappyHourState() {
  try {
    const hh = await getHappyHour();
    if (!hh) return;
    const nowStr = getISTTimeStr();
    
    if (nowStr >= hh.startTime && nowStr < hh.endTime) {
       if (!hh.enabled) {
          const sConf = await getSmsSettings();
          hh.originalPrice = sConf.maxPrice;
          hh.enabled = true;
          sConf.maxPrice = hh.temporaryPrice;
          await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sConf) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sConf) } });
          await saveHappyHour(hh);
       }
    } else if (nowStr >= hh.endTime && hh.enabled) {
       const sConf = await getSmsSettings();
       sConf.maxPrice = hh.originalPrice;
       await prisma.setting.upsert({ where: { key: 'SMS_SETTINGS' }, update: { value: JSON.stringify(sConf) }, create: { key: 'SMS_SETTINGS', value: JSON.stringify(sConf) } });
       hh.enabled = false;
       await saveHappyHour(hh);
    }
  } catch (error) {
    server.log.error('[SERVER] ⚠️ Failed to evaluate Happy Hour state on boot', error);
  }
}

async function resumeActiveOrders() {
  try {
    const activeOrders = await prisma.order.findMany({ where: { status: 'ACTIVE' }, include: { user: true } });
    if (activeOrders.length === 0) return;
    
    const smsSet = await getSmsSettings();
    for (const order of activeOrders) {
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
    
    // Validate Happy Hour pricing loop states on boot
    await resumeHappyHourState();

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
