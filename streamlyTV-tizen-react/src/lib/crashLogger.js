/**
 * Crash / error reports: EPG and player failures plus uncaught JS errors are
 * queued in localStorage (survives logout) and uploaded to
 * POST API.CRASH_REPORT_STORE on the next login.
 *
 *   crashLogger.log({ exception, message, stack_trace, screen, api_url })
 *   crashLogger.flush(done)
 */
import { API } from '../config/api';
import { getJSON, setJSON, remove, K } from './storage';
import { getAppVersion, getPlatformVersion, getFirmware, getRealModel, getTVModel, getNetworkType } from './tizen';

const MAX_REPORTS = 50;
const MAX_FIELD_LENGTH = 2000;
const FLUSH_TIMEOUT_MS = 3000;

let currentScreen = 'Unknown';

export function setCrashScreen(name) {
  currentScreen = name;
}

function truncate(value) {
  const str = value === undefined || value === null ? '' : String(value);
  return str.length > MAX_FIELD_LENGTH ? str.slice(0, MAX_FIELD_LENGTH) + '…' : str;
}

// Only the path is sent (no host / query string) so tokens never leak.
function apiPath(url) {
  if (!url) return '';
  return String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
}

function deviceInfo() {
  const tizenVersion = getPlatformVersion();
  const firmware = getFirmware();
  const model = getRealModel() || getTVModel();
  return {
    build_version: getAppVersion(),
    platform: 'Tizen',
    os_version: (tizenVersion ? 'Tizen ' + tizenVersion : 'Tizen') + (firmware ? ' (' + firmware + ')' : ''),
    device_model: 'Samsung ' + model,
    network_type: getNetworkType(),
  };
}

function readQueue() {
  const list = getJSON(K.CRASH_REPORTS, []);
  return Array.isArray(list) ? list : [];
}

function writeQueue(list) {
  if (list.length) setJSON(K.CRASH_REPORTS, list);
  else remove(K.CRASH_REPORTS);
}

const stripTime = function (msg) {
  return String(msg || '').replace(/^\[[^\]]*\] /, '');
};

function log(entry) {
  entry = entry || {};
  const device = deviceInfo();
  const report = {
    build_version: device.build_version,
    platform: device.platform,
    os_version: device.os_version,
    device_model: device.device_model,
    exception: truncate(entry.exception || 'Error'),
    message: truncate('[' + new Date().toISOString() + '] ' + (entry.message || '')),
    stack_trace: truncate(entry.stack_trace || ''),
    screen: entry.screen || currentScreen,
    api_url: apiPath(entry.api_url),
    network_type: device.network_type,
  };

  const queue = readQueue();
  // Skip a repeat of the last report (e.g. EPG failing over and over while
  // offline) so it doesn't push older, more useful reports out.
  const last = queue[queue.length - 1];
  if (last && last.exception === report.exception && last.screen === report.screen &&
    last.api_url === report.api_url && stripTime(last.message) === stripTime(report.message)) {
    return;
  }
  queue.push(report);
  writeQueue(queue.slice(-MAX_REPORTS));
}

// done() is always called exactly once: immediately when there is nothing to
// send, else on response or after FLUSH_TIMEOUT_MS — so login never hangs.
function flush(done) {
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (typeof done === 'function') done();
  }

  const pending = readQueue();
  if (!pending.length) {
    finish();
    return;
  }

  const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
  const xhr = new XMLHttpRequest();
  try {
    xhr.open('POST', API.CRASH_REPORT_STORE, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', 'application/json');
  } catch (e) {
    clearTimeout(timer);
    finish();
    return;
  }
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status >= 200 && xhr.status < 300) {
      // Drop only what was sent; anything logged meanwhile stays queued.
      writeQueue(readQueue().slice(pending.length));
    }
    clearTimeout(timer);
    finish();
  };
  xhr.onerror = function () {
    clearTimeout(timer);
    finish();
  };
  try {
    xhr.send(JSON.stringify({ crash_reports: pending }));
  } catch (e) {
    clearTimeout(timer);
    finish();
  }
}

function installGlobalHandlers() {
  window.addEventListener('error', function (event) {
    // Resource load errors (img/script) have no message — ignore them.
    if (!event || !event.message) return;
    const err = event.error;
    log({
      exception: (err && err.name) || 'UncaughtError',
      message: event.message + ' (' + String(event.filename || '').split('/').pop() + ':' + event.lineno + ':' + event.colno + ')',
      stack_trace: err && err.stack,
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    const reason = event && event.reason;
    log({
      exception: (reason && reason.name) || 'UnhandledPromiseRejection',
      message: (reason && reason.message) || String(reason),
      stack_trace: reason && reason.stack,
    });
  });
}

export const crashLogger = {
  log: log,
  flush: flush,
  installGlobalHandlers: installGlobalHandlers,
};
