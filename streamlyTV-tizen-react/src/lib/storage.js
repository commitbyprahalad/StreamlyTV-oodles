/**
 * localStorage access. Key names match the current StreamlyTV app so the
 * backend contract and any shared tooling stay the same. Every call is
 * wrapped: storage can throw on some TV firmware / when full.
 */
export const K = {
  JWT: 'jwt token',
  USER_ID: 'user_id',
  EMAIL: 'email',
  PASSWORD: 'password',
  PASSCODE: 'passcode',
  LOGIN_METHOD: 'loginMethod',
  DEVICE_ID: 'deviceid',
  VERSION: 'version',
  PERSONAL_DEVICE_ID: 'personaldeviceid',
  DEVICE_TYPE: 'devicetype',
  USER_ROLE: 'userrole',
  IS_CUSTOM_USER: 'is_custom_user',
  USER_TYPE: 'user_type',
  IS_HOA_MAIN_USER: 'is_hoa_main_user',
  IS_HOA_SUB_USER: 'is_hoa_sub_user',
  ROOMS: 'rooms',
  PERSONAL_DEVICE_POPUP: 'personaldevicename_popup',
  DEVICE_NAME: 'devicename',
  DEVICE_LIST: 'deviceList',
  DEVICES: 'devices',
  ZIPCODE: 'streamly_zipcode',
  SESSION_EXPIRE: 'session_expire',
  SUBSCRIPTION_BLOCKED: 'subscription_blocked',
  SUBSCRIPTION_QR: 'subscription_qrcode',
  SELECTED_ROOM: 'selected_room',
  VIDEO_SELECTED_LOC: 'video_selected_loc',
  CHANNEL_URL: 'channelUrl',
  CHANNEL_ID: 'channel_id',
  DRM_DATA: 'drmData',
  WIDEVINE: 'widevinelicense',
  PLAYREADY: 'playreadylicense',
  REMEMBER_ME: 'remember_me',
  REMEMBER_EMAIL: 'remember_me_email',
  REMEMBER_PASSWORD: 'remember_me_password',
  CRASH_REPORTS: 'crash_reports',
  GA_CLIENT_ID: 'ga_client_id',
};

// Survive logout: "Remember Me" credentials, unsent crash reports and the
// analytics client id.
const PERSISTENT_KEYS = [K.REMEMBER_ME, K.REMEMBER_EMAIL, K.REMEMBER_PASSWORD, K.CRASH_REPORTS, K.GA_CLIENT_ID];

export function get(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export function set(key, value) {
  try {
    window.localStorage.setItem(key, value === undefined || value === null ? '' : String(value));
  } catch (e) {
    // Full / unavailable storage must never break a flow.
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (e) {
    /* ignore */
  }
}

export function getJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

export function setJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}

// Logout / session expiry: wipe everything except PERSISTENT_KEYS.
export function clearSession() {
  const kept = {};
  for (let i = 0; i < PERSISTENT_KEYS.length; i++) {
    const value = get(PERSISTENT_KEYS[i]);
    if (value !== null) kept[PERSISTENT_KEYS[i]] = value;
  }
  try {
    window.localStorage.clear();
  } catch (e) {
    /* ignore */
  }
  Object.keys(kept).forEach(function (key) {
    set(key, kept[key]);
  });
}

export function getToken() {
  return get(K.JWT) || '';
}

// Strip characters that could break markup if a value is ever rendered raw.
export function sanitize(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[<>"'`]/g, '');
}
