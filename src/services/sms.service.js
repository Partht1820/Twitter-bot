import { CONFIG } from '../config.js';

/**
 * Build API URL
 */
function buildUrl(params = {}) {
  const url = new URL(CONFIG.sms.baseUrl);

  url.searchParams.append('api_key', CONFIG.sms.apiKey);

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      url.searchParams.append(key, value);
    }
  });

  return url.toString();
}

/**
 * Buy Number
 */
export async function purchaseNumber(settings) {
  try {
    const {
      countryId,
      operatorId,
      serviceId,
      maxPrice
    } = settings;

    const params = {
      action: 'getNumber',
      service: serviceId,
      country: countryId
    };

    if (operatorId)
      params.operator = operatorId;

    // Required only for operator 9
    if (String(operatorId) === '9' && maxPrice) {
      params.maxPrice = maxPrice;
    }

    const response = await fetch(buildUrl(params));

    const text = (await response.text()).trim();

    if (text.startsWith('ACCESS_NUMBER')) {
      const [, activationId, phoneNumber] =
        text.split(':');

      return {
        success: true,
        activationId,
        phoneNumber
      };
    }

    return {
      success: false,
      error: text
    };
  } catch (err) {
    console.error(err);

    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get OTP Status
 */
export async function getSmsStatus(activationId) {
  try {
    const response = await fetch(
      buildUrl({
        action: 'getStatus',
        id: activationId
      })
    );

    const text = (await response.text()).trim();

    if (text.startsWith('STATUS_OK')) {
      const [, otp] = text.split(':');

      return {
        hasOtp: true,
        otpCode: otp,
        status: 'RECEIVED'
      };
    }

    if (text === 'STATUS_WAIT_CODE') {
      return {
        hasOtp: false,
        otpCode: null,
        status: 'WAITING'
      };
    }

    if (text === 'STATUS_CANCEL') {
      return {
        hasOtp: false,
        otpCode: null,
        status: 'CANCELLED'
      };
    }

    return {
      hasOtp: false,
      otpCode: null,
      status: text
    };
  } catch (err) {
    console.error(err);

    return {
      hasOtp: false,
      otpCode: null,
      status: 'ERROR'
    };
  }
}

/**
 * Request Another SMS
 */
export async function requestAnotherSms(
  activationId
) {
  try {
    const response = await fetch(
      buildUrl({
        action: 'setStatus',
        status: 3,
        id: activationId
      })
    );

    const text = (await response.text()).trim();

    return text.startsWith('ACCESS');
  } catch (err) {
    console.error(err);

    return false;
  }
}

/**
 * Cancel Number
 */
export async function cancelSmsNumber(
  activationId
) {
  try {
    const response = await fetch(
      buildUrl({
        action: 'setStatus',
        status: 8,
        id: activationId
      })
    );

    const text = (await response.text()).trim();

    return (
      text === 'ACCESS_CANCEL' ||
      text === 'ACCESS_CANCEL_ALREADY'
    );
  } catch (err) {
    console.error(err);

    return false;
  }
}

/**
 * Provider Balance
 */
export async function getProviderBalance() {
  try {
    const response = await fetch(
      buildUrl({
        action: 'getBalance'
      })
    );

    const text = (await response.text()).trim();

    if (text.startsWith('ACCESS_BALANCE')) {
      const [, balance] = text.split(':');

      return {
        success: true,
        balance: Number(balance)
      };
    }

    return {
      success: false,
      balance: 0
    };
  } catch (err) {
    console.error(err);

    return {
      success: false,
      balance: 0
    };
  }
}
