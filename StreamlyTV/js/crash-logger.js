/**
 * StreamlyTV – Crash Logger
 * Keeps EPG / player failures and uncaught JS errors in localStorage and
 * uploads them to POST API.CRASH_REPORT_STORE on the next login.
 *
 *   CrashLogger.log({ exception, message, stack_trace, screen, api_url })
 *   CrashLogger.flush(done)   // send pending reports, then done()
 *
 * Device info (build, OS, model, network) is read from the Tizen APIs when
 * the report is logged, since it describes the moment of the failure.
 * The queue survives logout (see PERSISTENT_KEYS in api-config.js) so
 * reports from a crashed or logged-out session still go up on relogin.
 *
 * Must be loaded after api-config.js.
 */
const CrashLogger = (function () {
  const STORAGE_KEY = "crash_reports";
  const MAX_REPORTS = 50;
  const MAX_FIELD_LENGTH = 2000;
  const FLUSH_TIMEOUT_MS = 3000;

  function safe(fn, fallback) {
    try {
      const value = fn();
      return value === undefined || value === null || value === "" ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function truncate(value) {
    const str = value === undefined || value === null ? "" : String(value);
    return str.length > MAX_FIELD_LENGTH ? str.slice(0, MAX_FIELD_LENGTH) + "…" : str;
  }

  function getNetworkType() {
    // webapis.network.NetworkActiveConnectionType: 0 DISCONNECTED,
    // 1 WIFI, 2 CELLULAR, 3 ETHERNET
    const type = safe(function () { return webapis.network.getActiveConnectionType(); }, -1);
    return ["Disconnected", "WiFi", "Cellular", "Ethernet"][type] || "Unknown";
  }

  function getDeviceInfo() {
    const model = safe(function () { return webapis.productinfo.getRealModel(); }, "") ||
      safe(function () { return webapis.productinfo.getModel(); }, "Unknown");
    const tizenVersion = safe(function () {
      return tizen.systeminfo.getCapability("http://tizen.org/feature/platform.version");
    }, "");
    const firmware = safe(function () { return webapis.productinfo.getFirmware(); }, "");

    return {
      build_version: safe(function () {
        return tizen.application.getCurrentApplication().appInfo.version;
      }, "Unknown"),
      platform: "Tizen",
      os_version: ((tizenVersion ? "Tizen " + tizenVersion : "Tizen") +
        (firmware ? " (" + firmware + ")" : "")),
      device_model: "Samsung " + model,
      network_type: getNetworkType(),
    };
  }

  function screenFromPage() {
    const path = location.pathname || "";
    if (path.indexOf("programmeguide") !== -1) return "EPG Screen";
    if (path.indexOf("login") !== -1) return "Login Screen";
    if (path.indexOf("settings") !== -1) return "Settings Screen";
    return path.split("/").pop() || "Unknown";
  }

  // Only the path is sent (no host / query string) so tokens never leak.
  function apiPath(url) {
    if (!url) return "";
    return String(url).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  }

  function readQueue() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(list) {
    try {
      if (list.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      // Storage full / unavailable — logging must never break the app.
    }
  }

  function log(entry) {
    entry = entry || {};
    const device = getDeviceInfo();
    const report = {
      build_version: device.build_version,
      platform: device.platform,
      os_version: device.os_version,
      device_model: device.device_model,
      exception: truncate(entry.exception || "Error"),
      message: truncate("[" + new Date().toISOString() + "] " + (entry.message || "")),
      stack_trace: truncate(entry.stack_trace || ""),
      screen: entry.screen || screenFromPage(),
      api_url: apiPath(entry.api_url),
      network_type: device.network_type,
    };

    const queue = readQueue();
    // Skip a repeat of the last report (e.g. EPG auto-reload failing
    // over and over while offline) so it doesn't push out older ones.
    const last = queue[queue.length - 1];
    if (last && last.exception === report.exception && last.screen === report.screen &&
        last.api_url === report.api_url &&
        last.message.replace(/^\[[^\]]*\] /, "") === report.message.replace(/^\[[^\]]*\] /, "")) {
      return;
    }
    queue.push(report);
    writeQueue(queue.slice(-MAX_REPORTS));
  }

  // Sends every queued report in one request. done() is always called
  // exactly once — immediately when there is nothing to send, otherwise on
  // response or after FLUSH_TIMEOUT_MS — so callers can redirect after it
  // without the login ever hanging on this call.
  function flush(done) {
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (typeof done === "function") done();
    }

    const pending = readQueue();
    if (!pending.length) {
      finish();
      return;
    }

    const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API.CRASH_REPORT_STORE, true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/json");
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

  // ─── Uncaught JS errors on any page that loads this file ──────────────
  window.addEventListener("error", function (event) {
    // Resource load errors (img/script) have no message — ignore them.
    if (!event || !event.message) return;
    const err = event.error;
    log({
      exception: (err && err.name) || "UncaughtError",
      message: event.message + " (" + (event.filename || "").split("/").pop() +
        ":" + event.lineno + ":" + event.colno + ")",
      stack_trace: err && err.stack,
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    const reason = event && event.reason;
    log({
      exception: (reason && reason.name) || "UnhandledPromiseRejection",
      message: (reason && reason.message) || String(reason),
      stack_trace: reason && reason.stack,
    });
  });

  return {
    log: log,
    flush: flush,
  };
})();
