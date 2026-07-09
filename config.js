import 'dotenv/config';

function requireEnv(key, defaultValue = undefined) {
  const value = process.env[key] || defaultValue;
  if (value === undefined || value === null || value === '') {
    throw new Error(`CRITICAL STARTUP ERROR: Required environment variable '${key}' is missing.`);
  }
  return value;
}

function requireNumberEnv(key, defaultValue = undefined) {
  const value = requireEnv(key, defaultValue);
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`CRITICAL STARTUP ERROR: Environment variable '${key}' must be a valid number. Received: '${value}'`);
  }
  return parsed;
}

const config = {
  server: {
    port: requireNumberEnv('PORT', '3000'),
    host: requireEnv('HOST', '0.0.0.0'),
    nodeEnv: requireEnv('NODE_ENV', 'development')
  },
  webhook: {
    url: requireEnv('WEBHOOK_URL'),
    secret: requireEnv('WEBHOOK_SECRET')
  },
  telegram: {
    token: requireEnv('TELEGRAM_TOKEN'),
    botUsername: requireEnv('BOT_USERNAME'),
    supportUsername: requireEnv('SUPPORT_USERNAME'),
    adminId: requireEnv('ADMIN_ID'),
    forceJoinChannel: requireEnv('FORCE_JOIN_CHANNEL'),
    forceJoinGroup: requireEnv('FORCE_JOIN_GROUP')
  },
  sms: {
    apiToken: requireEnv('SMS_API_TOKEN')
  },
  database: {
    url: requireEnv('DATABASE_URL')
  },
  app: {
    timezone: requireEnv('TIMEZONE', 'Asia/Kolkata'),
    referralReward: requireNumberEnv('REFERRAL_REWARD')
  }
};

// Deep freeze to ensure complete immutability
const deepFreeze = (obj) => {
  Object.keys(obj).forEach((prop) => {
    if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
      deepFreeze(obj[prop]);
    }
  });
  return Object.freeze(obj);
};

export const CONFIG = deepFreeze(config);
