export const MESSAGES = Object.freeze({
  // ==========================================
  // GENERAL
  // ==========================================
  WELCOME: "👋 *Welcome to our Premium OTP Service\\!*\n\nPlease use the menu below to navigate\\.",
  PLEASE_WAIT: "✋ Please wait a moment before trying again\\.",
  PROCESSING_REQUEST: "⏳ *Processing your request\\.\\.\\.*",
  MAINTENANCE_MODE: "🛠️ *Maintenance Mode*\n\nOur service is currently undergoing scheduled maintenance\\. We will be back shortly\\.",
  INTERNAL_ERROR: "❌ *System Error*\n\nAn unexpected error occurred\\. Our team has been notified\\.",
  UNKNOWN_ERROR: "❓ *Unknown Error*\n\nSomething went wrong\\. Please try again later\\.",

  // ==========================================
  // FORCE JOIN
  // ==========================================
  FORCE_JOIN_REQUIRED: "⚠️ *Access Restricted*\n\nYou must join our official channels to use this bot\\. Please join using the links below, then click *Verify*\\.",
  VERIFICATION_SUCCESSFUL: "✅ *Verification Successful*\n\nWelcome aboard\\! You now have full access to the bot\\.",
  VERIFICATION_FAILED: "❌ *Verification Failed*\n\nWe couldn't verify your membership\\. Please ensure you have joined the required channels\\.",

  // ==========================================
  // NUMBER PURCHASE
  // ==========================================
  PURCHASING_NUMBER: "🔄 *Purchasing Number\\.\\.\\.*\n\nPlease wait while we reserve a number for you\\.",
  
  NUMBER_PURCHASED_SUCCESSFULLY: "✅ *Number Purchased Successfully*\n\n━━━━━━━━━━━━━━\n\n📱 *Number*\n`{phoneNumber}`\n\n💰 *Price*\n`₹{amount}`\n\n━━━━━━━━━━━━━━\n\n⏳ Waiting for your first OTP\\.\\.\\.",
  
  WAITING_FOR_OTP: "⏳ *Waiting for OTP\\.\\.\\.*\n\nYour number is active\\.\n\nThe OTP will be delivered automatically once received\\.",
  
  OTP_1_RECEIVED: "🔔 *OTP \\#1 Received*\n\n━━━━━━━━━━━━━━\n\n📱 *Number*\n`{phoneNumber}`\n\n🔐 *OTP*\n`{otp}`\n\n━━━━━━━━━━━━━━",
  
  OTP_2_RECEIVED: "🔔 *OTP \\#2 Received*\n\n━━━━━━━━━━━━━━\n\n📱 *Number*\n`{phoneNumber}`\n\n🔐 *OTP*\n`{otp}`\n\n━━━━━━━━━━━━━━",
  
  OTP_3_RECEIVED: "🔔 *OTP \\#3 Received*\n\n━━━━━━━━━━━━━━\n\n📱 *Number*\n`{phoneNumber}`\n\n🔐 *OTP*\n`{otp}`\n\n━━━━━━━━━━━━━━\n\n✅ *Maximum OTP limit reached\\.*\n\nThis order has been completed successfully\\.",
  
  OTP_TIMEOUT_REFUND: "⏱️ *Order Timeout*\n\nNo code was received\\. Your order has been cancelled and `₹{amount}` has been automatically refunded to your wallet\\.",
  
  OTP_TIMEOUT_NO_REFUND: "⏱️ *Order Timeout*\n\nYour session has ended\\. No refund is applicable because at least one OTP was received\\.",
  
  NUMBER_CANCELLED: "🛑 *Order Cancelled*\n\nYour active number session has been closed successfully\\.",
  PURCHASE_FAILED: "❌ *Purchase Failed*\n\nWe couldn't fetch a number at this time\\. Please try again later\\.",
  INSUFFICIENT_WALLET_BALANCE: "❌ *Insufficient Balance*\n\nYou do not have enough funds to complete this purchase\\. Please top up your wallet\\.",

  // ==========================================
  // MY ACCOUNT
  // ==========================================
  MY_ACCOUNT: "👤 *My Account*\n\n━━━━━━━━━━━━━━\n\n🆔 *User ID:* `{userId}`\n\n👤 *Name:* `{firstName}`\n\n🔗 *Username:* `{username}`\n\n💰 *Wallet Balance:* `₹{balance}`\n\n👥 *Total Referrals:* `{referrals}`\n\n📅 *Join Date:* `{date}`\n\n━━━━━━━━━━━━━━",

  // ==========================================
  // WALLET
  // ==========================================
  WALLET_UPDATED: "💰 *Wallet Updated*\n\nYour new available balance is `₹{balance}`\\.",
  WALLET_HISTORY_EMPTY: "📜 *Wallet History*\n\nYou have no recent transactions\\.",

  // ==========================================
  // ADD BALANCE
  // ==========================================
  PAYMENT_INSTRUCTIONS: "💳 *Add Funds*\n\nScan the QR Code or send payment to the UPI ID below\\.\n\nThen upload your payment screenshot\\.\n\n🆔 *UPI ID:* `{upi}`",
  WAITING_FOR_PAYMENT_SCREENSHOT: "📸 *Awaiting Screenshot*\n\nPlease send the screenshot of your successful transaction\\.",
  PAYMENT_SUBMITTED_SUCCESSFULLY: "✅ *Payment Submitted*\n\nYour receipt has been forwarded to our administration team for review\\.",
  PAYMENT_APPROVED: "🎉 *Payment Approved*\n\nYour deposit of `₹{amount}` has been successfully credited to your wallet\\.",
  PAYMENT_REJECTED: "❌ *Payment Rejected*\n\nYour recent deposit request was declined\\. Please contact support if you believe this is an error\\.",

  // ==========================================
  // REFERRAL
  // ==========================================
  REFER_AND_EARN_INFORMATION: "🎁 *Refer & Earn*\n\nShare your unique referral link with friends and earn `₹{amount}` for every successful signup\\!\n\n🔗 *Your Link:* `{referralLink}`",
  REFERRAL_SUCCESSFUL: "🎉 *Referral Bonus Received\\!*\n\nYou have received a bonus of `₹{amount}` for successfully inviting a new user\\.",
  REFERRAL_ALREADY_USED: "⚠️ You have already been referred by another user\\.",
  SELF_REFERRAL_NOT_ALLOWED: "⚠️ You cannot use your own referral link\\!",

  // ==========================================
  // SUPPORT
  // ==========================================
  CONTACT_SUPPORT: "📞 *Support*\n\nNeed help? Click the button below to contact our official support team\\.",

  // ==========================================
  // ADMIN
  // ==========================================
  STATISTICS: "📊 *Bot Statistics*\n\n👥 *Total Users:* `{totalUsers}`\n🛒 *Total Orders:* `{totalOrders}`\n💰 *Total Revenue:* `₹{totalRevenue}`",
  BROADCAST_STARTED: "📢 *Broadcast Started*\n\nYour message is being sent to all users\\.",
  BROADCAST_CANCELLED: "❌ *Broadcast Cancelled*\n\nThe broadcast setup has been aborted\\.",
  USER_BANNED: "⛔ *User Banned*\n\nThe user `{userId}` has been restricted from using the bot\\.",
  USER_UNBANNED: "✅ *User Unbanned*\n\nThe user `{userId}`'s access has been restored\\.",
  BALANCE_ADDED: "💰 *Balance Added*\n\nSuccessfully added `₹{amount}` to `{userId}`'s wallet\\.",
  BALANCE_DEDUCTED: "💸 *Balance Deducted*\n\nSuccessfully deducted `₹{amount}` from `{userId}`'s wallet\\.",

  // ==========================================
  // SMS PROVIDER SETTINGS
  // ==========================================
  SMS_PROVIDER_SETTINGS: "📡 *SMS Provider Settings*\n\nSelect a parameter below to update its value\\.",
  COUNTRY_UPDATED: "✅ *Country ID Updated*\n\nNew value: `{country}`",
  OPERATOR_UPDATED: "✅ *Operator ID Updated*\n\nNew value: `{operator}`",
  SERVICE_UPDATED: "✅ *Service ID Updated*\n\nNew value: `{service}`",
  MAXIMUM_PRICE_UPDATED: "✅ *Maximum Price Updated*\n\nNew value: `₹{amount}`",
  OTP_TIMEOUT_UPDATED: "✅ *OTP Timeout Updated*\n\nNew value: `{timeout} seconds`",
  OTP_CHECK_INTERVAL_UPDATED: "✅ *Check Interval Updated*\n\nNew value: `{interval} seconds`",
  CURRENT_CONFIGURATION: "📄 *Current Configuration*\n\n🌍 *Country ID:* `{country}`\n📡 *Operator ID:* `{operator}`\n🐦 *Service ID:* `{service}`\n💰 *Max Price:* `₹{amount}`\n⏱ *OTP Timeout:* `{timeout} sec`\n🔄 *Check Interval:* `{interval} sec`"
});
