/**
 * Login API calls and the one place that decides what happens with a login
 * response — email, passcode, QR and the device-limit relogin all go through
 * processLoginResponse(), exactly as in the current app:
 *   479 -> device limit popup -> device screen
 *   410 -> subscription screen (or expired popup without a token)
 *   success -> save session, upload crash reports, continue routing
 */
import { API } from '../config/api';
import { requestWithRetry, formData, friendlyMessage } from '../lib/http';
import { set, remove, setJSON, sanitize, getToken, K } from '../lib/storage';
import { appendDeviceFields } from '../lib/tizen';
import { crashLogger } from '../lib/crashLogger';
import { popup } from '../core/popup';
import { loading } from '../core/loading';
import { nav } from '../core/nav';
import {
  continueAfterLogin, goToSubscriptionScreen, handleSubscriptionExpired, resetSessionGuards,
} from '../core/session';

export function loginWithEmail(email, password, device) {
  const fd = formData({ email: email, password: password });
  appendDeviceFields(fd, device);
  return requestWithRetry('POST', API.LOGIN, { body: fd });
}

export function loginWithPasscode(passcode, device) {
  const fd = formData({ passcode: passcode });
  appendDeviceFields(fd, device);
  return requestWithRetry('POST', API.LOGIN_WITH_PASSCODE, { body: fd });
}

export function createQrCode() {
  return requestWithRetry('POST', API.QR_CREATE, {});
}

export function checkQrScan(key) {
  return requestWithRetry('POST', API.QR_SCAN, { body: formData({ key: key }) });
}

export function loginWithQr(key, device) {
  const fd = formData({ key: key });
  appendDeviceFields(fd, device);
  return requestWithRetry('POST', API.QR_LOGIN, { body: fd });
}

export function forgotPassword(email) {
  const token = getToken();
  return requestWithRetry('POST', API.FORGOT_PASSWORD, { body: formData({ email: email }), token: token || undefined });
}

// Everything later screens read after a login.
export function saveLoginSession(data, email, device) {
  const user = data.user || {};
  set(K.USER_ID, String(user.id));
  set(K.EMAIL, sanitize(email));
  set(K.DEVICE_ID, sanitize(device.uid));
  set(K.VERSION, sanitize(device.version));
  set(K.PERSONAL_DEVICE_ID, sanitize(data.personaldeviceid));
  set(K.DEVICE_TYPE, sanitize(data.device_type));
  set(K.USER_ROLE, sanitize(data.userrole));
  set(K.IS_CUSTOM_USER, String(user.is_custom_user));
  set(K.USER_TYPE, sanitize(user.user_type || ''));
  // HOA main and sub users both log in with userrole "hoa"; these flags are
  // the only thing that tells them apart.
  set(K.IS_HOA_MAIN_USER, data.is_hoa_main_user === true ? '1' : '0');
  set(K.IS_HOA_SUB_USER, data.is_hoa_sub_user === true ? '1' : '0');
  set(K.JWT, data.access_token);
  setJSON(K.ROOMS, data.rooms || []);
  set(K.PERSONAL_DEVICE_POPUP, data.personaldevicename_popup ? 'true' : 'false');
  set(K.DEVICE_NAME, sanitize(data.devicename || ''));
  if (user.zipcode) set(K.ZIPCODE, user.zipcode);
  remove(K.SESSION_EXPIRE);
  resetSessionGuards();
}

function handleDeviceLimit(data, identity, device, hooks) {
  if (data.loggedindeviceinfolist && data.loggedindeviceinfolist.data) {
    setJSON(K.DEVICE_LIST, data.loggedindeviceinfolist.data);
  }
  if (identity.email) set(K.EMAIL, sanitize(identity.email));
  // The device screen logs in again after a device is removed and needs
  // the credentials of the method used now (stale ones are cleared).
  set(K.LOGIN_METHOD, identity.method);
  remove(K.PASSWORD);
  remove(K.PASSCODE);
  if (identity.password) set(K.PASSWORD, identity.password);
  if (identity.passcode) set(K.PASSCODE, identity.passcode);
  set(K.DEVICE_ID, sanitize(device.uid));
  set(K.VERSION, sanitize(device.version));

  loading.hide();
  popup.confirm('Your device limit is over. You want to remove any device from list?', function (yes) {
    if (yes) nav.go('device');
    else if (hooks.onDeviceLimitCancel) hooks.onDeviceLimitCancel();
  }, 'Yes', 'Cancel');
}

function handleSubscriptionExpiredLogin(data, email, device) {
  loading.hide();
  if (!data.access_token || !data.user) {
    handleSubscriptionExpired(data.subscribedmsgis || data.message);
    return;
  }
  saveLoginSession(data, email, device);
  if (data.qrcode) set(K.SUBSCRIPTION_QR, data.qrcode);
  crashLogger.flush(goToSubscriptionScreen);
}

/**
 * identity: { method: 'email'|'passcode'|'qr', email, password, passcode }
 * hooks: { onFailure(message), onDeviceLimitCancel(), failureMessage }
 */
export function processLoginResponse(data, identity, device, hooks) {
  hooks = hooks || {};
  if (data === null || data === undefined) {
    loading.hide();
    if (hooks.onFailure) hooks.onFailure('Empty response from server. Please try again.');
    return;
  }
  const email = identity.email || (data.user && data.user.email) || '';

  if (Number(data.response_code) === 479) {
    handleDeviceLimit(data, Object.assign({}, identity, { email: email }), device, hooks);
    return;
  }
  if (Number(data.response_code) === 410) {
    handleSubscriptionExpiredLogin(data, email, device);
    return;
  }
  if (!data.success) {
    loading.hide();
    if (hooks.onFailure) {
      hooks.onFailure(friendlyMessage(data.message, hooks.failureMessage || 'Login failed. Please check your credentials.'));
    }
    return;
  }

  saveLoginSession(data, email, device);
  // Upload crash reports queued since the last session, then move on.
  crashLogger.flush(function () {
    loading.hide();
    continueAfterLogin();
  });
}
