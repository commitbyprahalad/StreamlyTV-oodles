/**
 * Session & subscription handling shared by every screen (port of the
 * current app's AuthSession):
 *  - response_code 401 -> "session expired" popup -> clear session -> guide
 *  - response_code 410 -> subscription-expired popup -> clear -> guide
 *  - post-login routing (device name -> hotel room -> EPG)
 *  - addToRecentCheck(): throttled session probe before playing / selecting
 */
import { popup } from './popup';
import { nav } from './nav';
import { API, DEFAULT_ZIPCODE } from '../config/api';
import { request } from '../lib/http';
import { get, set, remove, clearSession, getToken, K } from '../lib/storage';

let expiredShown = false;
let recentInFlight = false;
let recentLastCall = 0;

export function resetSessionGuards() {
  expiredShown = false;
}

export function handleSessionExpired() {
  if (expiredShown) return;
  expiredShown = true;
  set(K.SESSION_EXPIRE, 'session_expire');
  popup.session(function () {
    clearSession();
    expiredShown = false;
    nav.go('guide');
  });
}

export function handleSubscriptionExpired(message) {
  if (expiredShown) return;
  expiredShown = true;
  const msg = message || 'Your subscription has expired. Please visit https://streamlytv.com to update your plan.';
  popup.alert(msg, function () {
    clearSession();
    expiredShown = false;
    nav.go('guide');
  });
}

// Logged in but blocked on the subscription module: the splash reopens the
// subscription screen on relaunch until it's resolved.
export function goToSubscriptionScreen() {
  set(K.SUBSCRIPTION_BLOCKED, '1');
  nav.go('subscription');
}

export function isSubscriptionBlocked() {
  return get(K.SUBSCRIPTION_BLOCKED) === '1';
}

export function continueAfterLogin() {
  remove(K.SUBSCRIPTION_BLOCKED);
  if (get(K.PERSONAL_DEVICE_POPUP) === 'true') {
    nav.go('personalDevice');
    return;
  }
  if (get(K.USER_ROLE) === 'tieruser' && get(K.IS_CUSTOM_USER) === '0') {
    nav.go('hotelRoom');
    return;
  }
  nav.go('epg');
}

// Returns true when an auth error was handled.
export function checkApiResponse(data) {
  if (!data) return false;
  if (Number(data.response_code) === 401) {
    handleSessionExpired();
    return true;
  }
  if (Number(data.response_code) === 410) {
    handleSubscriptionExpired(data.subscribedmsgis || data.message);
    return true;
  }
  return false;
}

/**
 * Lightweight session probe via the addtorecent API — only 401 / 410 are
 * acted on. Throttled to one call per 2s.
 * cb(result): 'expired' | 'valid' | null (skipped / network error)
 */
export function addToRecentCheck(cb) {
  const token = getToken();
  const done = function (result) {
    if (cb) cb(result);
  };
  if (!token) {
    done(null);
    return;
  }
  const now = Date.now();
  if (recentInFlight || now - recentLastCall < 2000) {
    done(null);
    return;
  }
  recentInFlight = true;
  recentLastCall = now;

  request('POST', API.ADD_TO_RECENT, {
    token: token,
    body: { channelids: 1, zipcode: get(K.ZIPCODE) || DEFAULT_ZIPCODE },
    timeout: 10000,
  }).then(function (res) {
    recentInFlight = false;
    const code = res.data ? Number(res.data.response_code) : 0;
    if (code === 401) {
      handleSessionExpired();
      done('expired');
    } else if (code === 410) {
      handleSubscriptionExpired(res.data.subscribedmsgis || res.data.message);
      done('expired');
    } else {
      done('valid');
    }
  }, function () {
    recentInFlight = false;
    done(null);
  });
}

export function logoutRequest() {
  const token = getToken();
  if (!token) return Promise.resolve();
  return request('POST', API.LOGOUT, { token: token, timeout: 15000 }).then(function () {}, function () {});
}
