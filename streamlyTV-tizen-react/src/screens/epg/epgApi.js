/**
 * EPG backend calls (same contracts as the current app's modern-epg-core.js).
 */
import { API } from '../../config/api';
import { request } from '../../lib/http';
import { get, set, getToken, K } from '../../lib/storage';
import { crashLogger } from '../../lib/crashLogger';
import { getTVModel, getTVVersion, getPlatformVersion } from '../../lib/tizen';
import { handleSessionExpired, handleSubscriptionExpired } from '../../core/session';

export const PAGE_LIMIT = 20;

/**
 * One page of the offset-based guide. Resolves { channels, hasMore };
 * rejects with Error.kind: 'network' | 'timeout' | 'http' | 'parse' | 'auth'
 * ('auth' = the session / subscription popup is already showing).
 */
export function fetchEpgPage(page, opts) {
  const start = (page - 1) * PAGE_LIMIT;
  return request('POST', API.EPG_GUIDE, {
    token: getToken(),
    timeout: opts.timeout,
    body: {
      typeurl: 'mpd',
      genre: '',
      start: start,
      limit: PAGE_LIMIT,
      zipcode: opts.zipcode,
    },
  }).then(function (res) {
    function fail(kind, detail) {
      crashLogger.log({
        exception: 'EPGLoadError',
        message: 'EPG page ' + page + ' failed: ' + kind + ' (HTTP ' + res.status + ')' + (detail ? ' – ' + detail : ''),
        screen: 'EPG Screen',
        api_url: API.EPG_GUIDE,
      });
      const err = new Error(kind);
      err.kind = kind;
      throw err;
    }

    if (res.status === 401) {
      handleSessionExpired();
      const err = new Error('auth');
      err.kind = 'auth';
      throw err;
    }
    if (res.status !== 200) fail('http');
    const data = res.data;
    if (!data) fail('parse', 'invalid JSON');
    if (Number(data.response_code) === 401) {
      handleSessionExpired();
      const err401 = new Error('auth');
      err401.kind = 'auth';
      throw err401;
    }
    if (Number(data.response_code) === 410) {
      handleSubscriptionExpired(data.subscribedmsgis || data.message);
      const err410 = new Error('auth');
      err410.kind = 'auth';
      throw err410;
    }
    if (!data.success || Number(data.response_code) !== 200 || !data.data) {
      fail('http', 'response_code ' + data.response_code + ': ' + (data.message || 'no data'));
    }

    // Channels are normally data.data; tolerate a nested wrapper.
    const payload = data.data;
    let list = [];
    if (Array.isArray(payload)) list = payload;
    else if (Array.isArray(payload.data)) list = payload.data;
    else if (Array.isArray(payload.channels)) list = payload.channels;

    let hasMore = data.has_more;
    if (hasMore === undefined && !Array.isArray(payload)) hasMore = payload.has_more;
    hasMore = hasMore === undefined
      // No has_more flag: a full page means there may be more.
      ? list.length >= PAGE_LIMIT
      : hasMore === true || hasMore === 'true' || hasMore === 1 || hasMore === '1';
    // An empty page can never have more after it; avoids an endless loop.
    if (!list.length) hasMore = false;

    return { channels: list, hasMore: hasMore };
  }, function (err) {
    crashLogger.log({
      exception: 'EPGLoadError',
      message: 'EPG page ' + page + ' failed: ' + err.kind,
      screen: 'EPG Screen',
      api_url: API.EPG_GUIDE,
    });
    throw err;
  });
}

// Resolves the details object, or null (auth popup shown / bad response).
// Rejects on network failure.
export function fetchProgramDetails(channelId, tmsId) {
  return request('POST', API.PROGRAM_DETAILS, {
    token: getToken(),
    timeout: 15000,
    body: { channel_id: channelId, TMSId: tmsId },
  }).then(function (res) {
    if (res.status === 401) {
      handleSessionExpired();
      return null;
    }
    const data = res.data;
    if (res.status !== 200 || !data) return null;
    if (Number(data.response_code) === 401) {
      handleSessionExpired();
      return null;
    }
    if (Number(data.response_code) === 410) {
      handleSubscriptionExpired(data.subscribedmsgis || data.message);
      return null;
    }
    return data.data || null;
  });
}

/**
 * DRM keys for playback. Doubles as the session heartbeat while the player
 * is open: a 401 shows the session-expired popup.
 */
export function fetchDrmKeys() {
  function reportFailure(message) {
    crashLogger.log({ exception: 'DRMKeyFetchError', message: message, screen: 'Player Screen', api_url: API.DRM_KEY });
  }
  return request('GET', API.DRM_KEY, { token: getToken(), timeout: 15000 }).then(function (res) {
    if (res.status === 401) {
      handleSessionExpired();
      return null;
    }
    if (res.status !== 200) {
      reportFailure('DRM key request failed: HTTP ' + res.status);
      return null;
    }
    const result = res.data;
    if (!result) {
      reportFailure('DRM key response parse error');
      return null;
    }
    if (!result.data) {
      reportFailure('DRM key response has no data: ' + (result.message || ''));
      return null;
    }
    set(K.DRM_DATA, result.data);
    if (result.widevinelicense) set(K.WIDEVINE, result.widevinelicense);
    if (result.playreadylicense) set(K.PLAYREADY, result.playreadylicense);
    return result;
  }, function (err) {
    reportFailure(err.kind === 'timeout' ? 'DRM key request timed out' : 'DRM key request network error');
    return null;
  });
}

// Refresh device + app metadata on every EPG load (fire-and-forget).
export function storeSubSession() {
  const token = getToken();
  if (!token) return;
  const model = getTVModel();
  const build = getTVVersion();
  const fd = new FormData();
  fd.append('platform', 'Samsung ' + model);
  fd.append('device_model', model);
  fd.append('build_version', build);
  fd.append('device_os_version', getPlatformVersion() || build);
  request('POST', API.SUB_SESSION_STORE, { token: token, body: fd }).then(function (res) {
    if (res.status === 401) handleSessionExpired();
  }, function () { /* ignore */ });
}

export function getDrm() {
  return { drmData: get(K.DRM_DATA), license: get(K.WIDEVINE), playready: get(K.PLAYREADY) };
}
