/**
 * Safe wrappers around the Tizen / Samsung webapis. Every call is guarded so
 * the app also runs in a desktop browser (dev + automated tests) and on TV
 * models where an API is missing.
 */
import { get, K } from './storage';
import { DEFAULT_ZIPCODE } from '../config/api';

export const APP_VERSION_FALLBACK = '3.0.0';

function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

export function isTizen() {
  return typeof window.tizen !== 'undefined';
}

export function hasAVPlay() {
  return typeof window.webapis !== 'undefined' && !!window.webapis.avplay;
}

export function exitApp() {
  try {
    window.tizen.application.getCurrentApplication().exit();
  } catch (e) {
    /* not on a TV */
  }
}

// Remote keys that Tizen only delivers to apps that ask for them.
export function registerKeys() {
  if (!isTizen() || !window.tizen.tvinputdevice) return;
  const keys = ['Exit', 'ChannelUp', 'ChannelDown', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  keys.forEach(function (name) {
    try {
      window.tizen.tvinputdevice.registerKey(name);
    } catch (e) {
      /* key not supported on this model */
    }
  });
}

export function getAppVersion() {
  return safe(function () {
    return window.tizen.application.getCurrentApplication().appInfo.version;
  }, APP_VERSION_FALLBACK);
}

export function getDeviceId() {
  return safe(function () {
    return window.tizen.systeminfo.getCapability('http://tizen.org/system/tizenid');
  }, '') || getBrowserDeviceId();
}

// Desktop browser (dev/tests): a stable random id instead of the Tizen id.
function getBrowserDeviceId() {
  let id = get('browser_device_id');
  if (!id) {
    id = 'web-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      window.localStorage.setItem('browser_device_id', id);
    } catch (e) {
      /* ignore */
    }
  }
  return id;
}

export function getTVVersion() {
  return safe(function () {
    return window.webapis.tvinfo.getVersion();
  }, 'unknown');
}

export function getTVModel() {
  return safe(function () {
    return window.webapis.productinfo.getModel();
  }, 'unknown');
}

export function getRealModel() {
  return safe(function () {
    return window.webapis.productinfo.getRealModel();
  }, '');
}

export function getFirmware() {
  return safe(function () {
    return window.webapis.productinfo.getFirmware();
  }, '');
}

export function getPlatformVersion() {
  return safe(function () {
    return window.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
  }, '');
}

export function getNetworkType() {
  // webapis.network.NetworkActiveConnectionType: 0 DISCONNECTED, 1 WIFI,
  // 2 CELLULAR, 3 ETHERNET
  const type = safe(function () {
    return window.webapis.network.getActiveConnectionType();
  }, -1);
  return ['Disconnected', 'WiFi', 'Cellular', 'Ethernet'][type] || 'Unknown';
}

/**
 * Device info every login flow (email, passcode, QR, relogin) sends, so the
 * backend's device-limit tracking and device list stay consistent.
 */
export function buildDevicePayload() {
  const model = getTVModel();
  return {
    uid: getDeviceId(),
    version: getTVVersion(),
    deviceModel: model,
    deviceFriendly: 'Samsung ' + model,
    buildVersion: getAppVersion(),
    deviceOsVersion: getRealModel() || '9.0',
    zipcode: get(K.ZIPCODE) || DEFAULT_ZIPCODE,
    deviceTitle: 'SamsungTV',
  };
}

export function appendDeviceFields(fd, device) {
  fd.append('deviceid', device.uid);
  fd.append('devicefriendlyname', device.deviceFriendly);
  fd.append('version', device.version);
  fd.append('device_title', device.deviceTitle);
  fd.append('device_model', device.deviceModel);
  fd.append('build_version', device.buildVersion);
  fd.append('device_os_version', device.deviceOsVersion);
  fd.append('zipcode', device.zipcode);
}
