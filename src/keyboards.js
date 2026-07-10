/**
 * Helper object to generate reusable Inline Keyboard Buttons.
 * This prevents hardcoding repeated buttons across the application.
 */
const BTN = {
  inline: (text, callback_data) => ({ text, callback_data }),
  url: (text, url) => ({ text, url }),
  back: (callbackData) => ({ text: "🔙 Back", callback_data: callbackData })
};

// ==========================================
// USER REPLY KEYBOARDS (PERMANENT)
// ==========================================

export function getMainMenu() {
  return {
    keyboard: [
      [
        { text: "🐦 Get Twitter Number" },
        { text: "👤 My Account" }
      ],
      [
        { text: "📜 Wallet History" },
        { text: "💳 Add Balance" }
      ],
      [
        { text: "🎁 Refer & Earn" },
        { text: "📞 Support" }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

export function removeKeyboard() {
  return {
    remove_keyboard: true
  };
}

// ==========================================
// ONBOARDING & VERIFICATION INLINE KEYBOARDS
// ==========================================

export function getForceJoinKeyboard(channel, group) {
  return {
    inline_keyboard: [
      [BTN.url("📢 Join Channel", `https://t.me/${channel.replace("@", "")}`)],
      [BTN.url("👥 Join Group", `https://t.me/${group.replace("@", "")}`)],
      [BTN.inline("✅ Verify", "verify_join")]
    ]
  };
}

export function getVerifyJoinKeyboard() {
  return {
    inline_keyboard: [
      [BTN.inline("✅ Verify Joining", "verify_join")]
    ]
  };
}

// ==========================================
// ACTIVE ORDER INLINE KEYBOARDS
// ==========================================

export function getCancelNumberKeyboard(activationId) {
  return {
    inline_keyboard: [
      [BTN.inline("🛑 Cancel Number", `cancel_order:${activationId}`)]
    ]
  };
}

// ==========================================
// ADMIN INLINE & REPLY KEYBOARDS
// ==========================================

export function getAdminMainMenu() {
  return {
    keyboard: [
      [
        { text: "📊 Statistics" },
        { text: "👥 Users" }
      ],
      [
        { text: "💳 Payments" },
        { text: "🛒 Orders" }
      ],
      [
        { text: "📢 Broadcast" },
        { text: "⚙️ Settings" }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

export function getAdminUsers(userId) {
  return {
    inline_keyboard: [
      [
        BTN.inline("💰 Add Balance", `admin_add_bal:${userId}`),
        BTN.inline("💸 Deduct Balance", `admin_ded_bal:${userId}`)
      ],
      [BTN.inline("📜 View History", `admin_history:${userId}`)],
      [BTN.inline("⛔ Ban / Unban", `admin_ban_menu:${userId}`)]
    ]
  };
}

export function getAdminBroadcast() {
  return {
    inline_keyboard: [
      [BTN.inline("❌ Cancel Broadcast Setup", "admin_cancel_broadcast")]
    ]
  };
}

export function getAdminSettings() {
  return {
    inline_keyboard: [
      [BTN.inline("🛠️ Maintenance Mode", "admin_maintenance")],
      [BTN.inline("📡 SMS Provider Settings", "admin_sms_settings")]
    ]
  };
}

export function getAdminSmsSettings() {
  return {
    inline_keyboard: [
      [
        BTN.inline("🌍 Country ID", "admin_sms_edit:country"),
        BTN.inline("📡 Operator ID", "admin_sms_edit:operator")
      ],
      [
        BTN.inline("🐦 Service ID", "admin_sms_edit:service"),
        BTN.inline("💰 Max Price", "admin_sms_edit:price")
      ],
      [
        BTN.inline("⏱ OTP Timeout", "admin_sms_edit:timeout"),
        BTN.inline("🔄 Check Interval", "admin_sms_edit:interval")
      ],
      [BTN.inline("📄 Current Configuration", "admin_sms_current")],
      [BTN.back("admin_settings")]
    ]
  };
}

export function getPaymentApproveReject(paymentId, userId) {
  return {
    inline_keyboard: [
      [
        BTN.inline("✅ Approve", `approve_payment:${paymentId}:${userId}`),
        BTN.inline("❌ Reject", `reject_payment:${paymentId}:${userId}`)
      ]
    ]
  };
}

export function getBanUnbanUser(userId, isBanned) {
  return {
    inline_keyboard: [
      [BTN.inline(isBanned ? "✅ Unban User" : "⛔ Ban User", `toggle_ban:${userId}`)],
      [BTN.back(`admin_users:${userId}`)]
    ]
  };
}

export function getMaintenanceMode(isMaintenance) {
  return {
    inline_keyboard: [
      [BTN.inline(isMaintenance ? "✅ Turn OFF" : "⛔ Turn ON", "toggle_maintenance")],
      [BTN.back("admin_settings")]
    ]
  };
}
export function getSupportMenu(supportUsername) {
  return {
    inline_keyboard: [
      [
        BTN.url(
          "💬 Contact Support",
          `https://t.me/${supportUsername.replace("@", "")}`
        )
      ]
    ]
  };
}
