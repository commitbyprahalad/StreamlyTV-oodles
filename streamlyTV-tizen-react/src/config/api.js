/**
 * Every backend endpoint in one place (same API as the current StreamlyTV
 * app). VITE_API_BASE / VITE_CRASH_URL override the hosts for local testing
 * against scripts/mock-api.mjs; production builds use the real servers.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE || 'https://streamlytv.com/api';

export const API = {
  // Login
  LOGIN: API_BASE_URL + '/auth/login',
  LOGIN_WITH_PASSCODE: API_BASE_URL + '/auth/login-with-passcode',
  QR_CREATE: API_BASE_URL + '/login/create/qrcode',
  QR_SCAN: API_BASE_URL + '/login/scan/qrcode',
  QR_LOGIN: API_BASE_URL + '/login/entry/login',
  FORGOT_PASSWORD: API_BASE_URL + '/password/email',
  LOGIN_GUIDE: API_BASE_URL + '/loginguide',
  LOGOUT: API_BASE_URL + '/auth/logout',

  // Devices
  SAME_DEVICE_ID_LOGOUT: API_BASE_URL + '/auth/same-device-id-logout',
  NEW_CONNECTED_DEVICE: API_BASE_URL + '/auth/newconnecteddevice',
  PERSONAL_DEVICE_NAME: API_BASE_URL + '/auth/personaldevicename/', // + personal device id

  // Hotel rooms
  SYNC_SESSION_WITH_ROOM: API_BASE_URL + '/auth/sync-session-with-room',
  GET_HOTEL_ROOMS: API_BASE_URL + '/auth/get-hotelrooms',

  // Programme guide / player
  EPG_GUIDE: API_BASE_URL + '/v2/auth/epg-guide-test', // offset: start, limit
  PROGRAM_DETAILS: API_BASE_URL + '/auth/program-details',
  DRM_KEY: API_BASE_URL + '/auth/getdrmkey',
  SUB_SESSION_STORE: API_BASE_URL + '/auth/sub-session/store',
  ADD_TO_RECENT: API_BASE_URL + '/auth/addtorecent',

  // Settings / info
  SETTING_DETAILS: API_BASE_URL + '/auth/setting-details',
  FAQ: API_BASE_URL + '/auth/faq',
  SUPPORT: API_BASE_URL + '/auth/support',
  TERMS_OF_USE: API_BASE_URL + '/auth/termofuse',
  PRIVACY_POLICY: API_BASE_URL + '/auth/privacypol',
  VERIFY_PASSWORD: API_BASE_URL + '/auth/verify-password',

  // Account
  ACCOUNT_DELETE_OTP: API_BASE_URL + '/auth/account-delete/otp',
  ACCOUNT_DELETE_OTP_VERIFY: API_BASE_URL + '/auth/account-delete/otp/verify',
  USER_DELETE: API_BASE_URL + '/auth/user/delete',
  ACCOUNT_OTP_SEND: API_BASE_URL + '/auth/account/otp-send',
  ACCOUNT_OTP_VERIFY: API_BASE_URL + '/auth/account/otp-verify',

  // Subscription
  SUBSCRIPTION_RESUME: API_BASE_URL + '/auth/subscription/resume',
  CANCEL_SUBSCRIPTION: API_BASE_URL + '/cancel-subscription/', // + user id
  SUBSCRIPTION_CHECK: API_BASE_URL + '/auth/subscription/check',
  CUSTOM_SUBSCRIPTION_PLANS: API_BASE_URL + '/auth/custom/subscription/plan',
  SUBSCRIPTION_PLAN_REQUEST: API_BASE_URL + '/auth/subscription/plan-request',

  // Crash / error reports (see lib/crashLogger.js). Staging, where the
  // endpoint is deployed; switch to API_BASE_URL once it's on production.
  CRASH_REPORT_STORE: import.meta.env.VITE_CRASH_URL || 'https://staging.streamlytv.com/api/crash-report/store',
};

export const DEFAULT_ZIPCODE = '302020';
