/**
 * Settings requests, with the current app's two flavours:
 *
 *  apiGet / apiPage: only a 200 body counts; anything else resolves null.
 *  apiOtp: OTP / password-verification endpoints put user-facing messages
 *          in the body even on 422 etc., so the body is returned for any
 *          status. 401 still triggers the session-expired flow unless
 *          suppressAuth (password check: 401 = wrong password).
 *
 * Both resolve null on network errors and after handling 401 / 410.
 */
import { request, isApiSuccess } from '../../lib/http';
import { getToken } from '../../lib/storage';
import { checkApiResponse, handleSessionExpired } from '../../core/session';

export function apiPage(method, url, body) {
  return request(method, url, { token: getToken(), body: body }).then(function (res) {
    if (res.status === 401) {
      handleSessionExpired();
      return null;
    }
    if (res.status !== 200 || !res.data) return null;
    if (checkApiResponse(res.data)) return null;
    return res.data;
  }, function () {
    return null;
  });
}

export function apiOtp(method, url, body, suppressAuth) {
  return request(method, url, { token: getToken(), body: body }).then(function (res) {
    if (res.status === 401 && !suppressAuth) {
      handleSessionExpired();
      return null;
    }
    if (!res.data) return null;
    if (checkApiResponse(res.data)) return null;
    return res.data;
  }, function () {
    return null;
  });
}

export { isApiSuccess };

// "Too many OTP requests" gets its own message instead of the generic one.
export function isOtpLimitReached(data) {
  if (!data) return false;
  if (Number(data.response_code) === 422 && data.status === false) return true;
  if (Number(data.response_code) === 429) return true;
  if (data.status === 429 || data.status === '429') return true;
  const code = String(data.error_code || data.code || '').toLowerCase();
  if (code.indexOf('otp_limit') !== -1 || code.indexOf('limit_reached') !== -1 || code === 'too_many_requests') return true;
  if (data.limit_reached === true || data.otp_limit_reached === true) return true;
  const msg = String(data.message || '').toLowerCase();
  return msg.indexOf('limit') !== -1 &&
    (msg.indexOf('otp') !== -1 || msg.indexOf('attempt') !== -1 || msg.indexOf('request') !== -1);
}

export const OTP_LIMIT_MESSAGE =
  'You have reached the maximum number of OTP requests allowed. Please try again after some time.';
