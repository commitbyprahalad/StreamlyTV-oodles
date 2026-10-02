/**
 * StreamlyTV – API Config
 * Single source of truth for every backend endpoint. To point the app at a
 * different server, change API_BASE_URL only.
 *
 * Must be loaded before any module script that calls the API.
 */

const API_BASE_URL = "https://streamlytv.com/api";

const API = {
  // Login
  LOGIN: API_BASE_URL + "/auth/login",
  LOGIN_WITH_PASSCODE: API_BASE_URL + "/auth/login-with-passcode",
  QR_CREATE: API_BASE_URL + "/login/create/qrcode",
  QR_SCAN: API_BASE_URL + "/login/scan/qrcode",
  QR_LOGIN: API_BASE_URL + "/login/entry/login",
  FORGOT_PASSWORD: API_BASE_URL + "/password/email",
  LOGIN_GUIDE: API_BASE_URL + "/loginguide",
  LOGOUT: API_BASE_URL + "/auth/logout",

  // Devices
  SAME_DEVICE_ID_LOGOUT: API_BASE_URL + "/auth/same-device-id-logout",
  NEW_CONNECTED_DEVICE: API_BASE_URL + "/auth/newconnecteddevice",
  PERSONAL_DEVICE_NAME: API_BASE_URL + "/auth/personaldevicename/", // + personal device id

  // Hotel rooms
  SYNC_SESSION_WITH_ROOM: API_BASE_URL + "/auth/sync-session-with-room",
  GET_HOTEL_ROOMS: API_BASE_URL + "/auth/get-hotelrooms",

  // Programme guide / player
  EPG_GUIDE: API_BASE_URL + "/auth/epg-guide",
  EPG_GUIDE_V2: API_BASE_URL + "/v2/auth/epg-guide", // paginated: page, limit -> has_more
  PROGRAM_DETAILS: API_BASE_URL + "/auth/program-details",
  DRM_KEY: API_BASE_URL + "/auth/getdrmkey",
  ALL_GENRE: API_BASE_URL + "/auth/all-genre",
  SUB_SESSION_STORE: API_BASE_URL + "/auth/sub-session/store",
  ADD_TO_RECENT: API_BASE_URL + "/auth/addtorecent",

  // Settings / info
  SETTING_DETAILS: API_BASE_URL + "/auth/setting-details",
  FAQ: API_BASE_URL + "/auth/faq",
  SUPPORT: API_BASE_URL + "/auth/support",
  TERMS_OF_USE: API_BASE_URL + "/auth/termofuse",
  PRIVACY_POLICY: API_BASE_URL + "/auth/privacypol",
  VERIFY_PASSWORD: API_BASE_URL + "/auth/verify-password",

  // Account
  ACCOUNT_DELETE_OTP: API_BASE_URL + "/auth/account-delete/otp",
  ACCOUNT_DELETE_OTP_VERIFY: API_BASE_URL + "/auth/account-delete/otp/verify",
  USER_DELETE: API_BASE_URL + "/auth/user/delete",
  ACCOUNT_OTP_SEND: API_BASE_URL + "/auth/account/otp-send",
  ACCOUNT_OTP_VERIFY: API_BASE_URL + "/auth/account/otp-verify",

  // Subscription
  SUBSCRIPTION_RESUME: API_BASE_URL + "/auth/subscription/resume",
  CANCEL_SUBSCRIPTION: API_BASE_URL + "/cancel-subscription/", // + user id
  SUBSCRIPTION_CHECK: API_BASE_URL + "/auth/subscription/check",
  CUSTOM_SUBSCRIPTION_PLANS: API_BASE_URL + "/auth/custom/subscription/plan",
  SUBSCRIPTION_PLAN_REQUEST: API_BASE_URL + "/auth/subscription/plan-request",
};

// ─── Session storage helpers ────────────────────────────────────────────────
// "Remember Me" on the login screen must survive logout / session expiry, so
// these keys are kept when the rest of localStorage is wiped.
const REMEMBER_ME_KEYS = ["remember_me", "remember_me_email", "remember_me_password"];

// Use instead of localStorage.clear() when logging the user out.
function clearSessionStorage() {
  const kept = {};
  for (let i = 0; i < REMEMBER_ME_KEYS.length; i++) {
    const value = localStorage.getItem(REMEMBER_ME_KEYS[i]);
    if (value !== null) kept[REMEMBER_ME_KEYS[i]] = value;
  }
  localStorage.clear();
  for (const key in kept) {
    localStorage.setItem(key, kept[key]);
  }
}
