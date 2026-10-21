/**
 * StreamlyTV – shared login helpers
 * Used by the login screen and by the device-limit screen's re-login, so a
 * login completed from either place sends the same device info and saves the
 * same session (personaldeviceid, user role, custom/HOA flags, token, ...).
 *
 * Needs webapis.js (and the Tizen runtime) on the page, and
 * js/geolocation.js for the device zipcode.
 */

// ─── Device Info (safe Tizen wrappers) ───────────────────────────────────────

function getDeviceId() {
  try {
    const tizenId = tizen.systeminfo.getCapability(
      "http://tizen.org/system/tizenid",
    );
    if (tizenId) return tizenId;
  } catch (e) {
    console.warn("Could not get Tizen ID:", e);
  }
  // No Tizen ID: a generated id kept on this device (survives logout), so
  // the backend sees the same device on every login instead of a new
  // "unknown-device-<time>" each time, which used up device-limit slots.
  let id = localStorage.getItem("device_uuid");
  if (!id) {
    id =
      "unknown-device-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
    localStorage.setItem("device_uuid", id);
  }
  return id;
}

function getTVVersion() {
  try {
    return webapis.tvinfo.getVersion() || "unknown";
  } catch (e) {
    console.warn("Could not get TV version:", e);
    return "unknown";
  }
}

function getTVModel() {
  try {
    return webapis.productinfo.getModel() || "unknown";
  } catch (e) {
    console.warn("Could not get TV model:", e);
    return "unknown";
  }
}

// Tizen platform version of the TV, e.g. "6.0"
function getTizenVersion() {
  try {
    return (
      tizen.systeminfo.getCapability(
        "http://tizen.org/feature/platform.version",
      ) || "unknown"
    );
  } catch (e) {
    console.warn("Could not get platform version:", e);
    return "unknown";
  }
}

// Native resolution of the TV panel, e.g. "3840x2160". The web app itself
// always renders on a 1920x1080 plane, so screen.width alone would report
// every 4K / 8K TV as 1920x1080: ask the panel first.
function getScreenResolution() {
  try {
    if (
      webapis.productinfo.is8KPanelSupported &&
      webapis.productinfo.is8KPanelSupported()
    )
      return "7680x4320";
  } catch (e) {
    /* API not on this firmware */
  }
  try {
    if (
      webapis.productinfo.isUdPanelSupported &&
      webapis.productinfo.isUdPanelSupported()
    )
      return "3840x2160";
  } catch (e) {
    /* API not on this firmware */
  }
  try {
    const w = tizen.systeminfo.getCapability(
      "http://tizen.org/feature/screen.width",
    );
    const h = tizen.systeminfo.getCapability(
      "http://tizen.org/feature/screen.height",
    );
    if (w && h) return w + "x" + h;
  } catch (e) {
    /* not a Tizen device */
  }
  const ratio = window.devicePixelRatio || 1;
  const scr = window.screen || {};
  if (scr.width && scr.height) {
    return (
      Math.round(scr.width * ratio) + "x" + Math.round(scr.height * ratio)
    );
  }
  return "unknown";
}

// Zipcode of where the TV is (IP location, js/geolocation.js). If no lookup
// has ever worked: the account zip from the last login, then the old default.
function getLoginZipcode() {
  if (typeof GeoLocation !== "undefined" && GeoLocation.getDeviceZip()) {
    return GeoLocation.getDeviceZip();
  }
  return (
    localStorage.getItem("device_zipcode") ||
    localStorage.getItem("streamly_zipcode") ||
    "302020"
  );
}

// Login buttons call this first: if the device zip lookup (started when the
// login screen opened) hasn't finished, wait for it — at most 3s — and then
// call retry() once. Returns true when the login can go ahead now.
// A second OK press during the wait does nothing (the pending retry sends
// the login), so the request is never sent twice.
let _deviceInfoState = "idle"; // "idle" | "waiting" | "done"
function deviceInfoReady(retry) {
  if (
    _deviceInfoState === "done" ||
    typeof GeoLocation === "undefined" ||
    GeoLocation.hasFreshDeviceZip()
  ) {
    return true;
  }
  if (_deviceInfoState === "waiting") return false;
  _deviceInfoState = "waiting";
  GeoLocation.lookupDeviceZip(function () {
    _deviceInfoState = "done";
    retry();
  }, 3000);
  return false;
}

// ─── Shared device payload builder ───────────────────────────────────────────
// Every login flow (email, passcode, QR, device-limit re-login) must send the
// SAME device info to the backend so device-limit tracking / device list /
// analytics stay consistent.

function buildDevicePayload() {
  const uid = getDeviceId();
  const version = getTVVersion();
  const deviceModel = getTVModel();
  const deviceFriendly = "Samsung " + deviceModel;
  let buildVersion = "unknown";
  try {
    buildVersion = tizen.application.getCurrentApplication().appInfo.version;
  } catch (e) {
    console.warn("Could not get app version:", e);
  }
  // Was getRealModel() (the model number, e.g. "UN55AU8000"), not an OS version
  const deviceOsVersion = getTizenVersion();
  const zipcode = getLoginZipcode();
  const screenResolution = getScreenResolution();
  const deviceTitle = "SamsungTV";

  return {
    uid: uid,
    version: version,
    deviceModel: deviceModel,
    deviceFriendly: deviceFriendly,
    buildVersion: buildVersion,
    deviceOsVersion: deviceOsVersion,
    zipcode: zipcode,
    screenResolution: screenResolution,
    deviceTitle: deviceTitle,
  };
}

function appendDeviceFields(formData, device) {
  formData.append("deviceid", device.uid);
  formData.append("devicefriendlyname", device.deviceFriendly);
  formData.append("version", device.version);
  formData.append("device_title", device.deviceTitle);
  formData.append("device_model", device.deviceModel);
  formData.append("build_version", device.buildVersion);
  formData.append("device_os_version", device.deviceOsVersion);
  formData.append("zipcode", device.zipcode);
  formData.append("screen_resolution", device.screenResolution);
}

// ─── Session save ────────────────────────────────────────────────────────────
// Everything later screens read from localStorage after a login. The device
// name screen, for example, refuses to continue without personaldeviceid.

function sanitizeSessionValue(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[<>"'`]/g, "");
}

function saveLoginSession(data, email, uid, version) {
  const user = data.user || {};
  localStorage.setItem("user_id", String(user.id));
  localStorage.setItem("email", sanitizeSessionValue(email));
  localStorage.setItem("deviceid", sanitizeSessionValue(uid));
  localStorage.setItem("version", sanitizeSessionValue(version));
  localStorage.setItem(
    "personaldeviceid",
    sanitizeSessionValue(data.personaldeviceid),
  );
  localStorage.setItem("devicetype", sanitizeSessionValue(data.device_type));
  localStorage.setItem("userrole", sanitizeSessionValue(data.userrole));
  localStorage.setItem("is_custom_user", String(user.is_custom_user));
  localStorage.setItem("user_type", sanitizeSessionValue(user.user_type || ""));
  // HOA accounts: both main and sub users log in with userrole "hoa";
  // these flags are the only thing that tells them apart.
  localStorage.setItem(
    "is_hoa_main_user",
    data.is_hoa_main_user === true ? "1" : "0",
  );
  localStorage.setItem(
    "is_hoa_sub_user",
    data.is_hoa_sub_user === true ? "1" : "0",
  );
  localStorage.setItem("jwt token", data.access_token);
  localStorage.setItem("rooms", JSON.stringify(data.rooms || []));
  localStorage.setItem(
    "personaldevicename_popup",
    data.personaldevicename_popup ? "true" : "false",
  );
  localStorage.setItem(
    "devicename",
    sanitizeSessionValue(data.devicename || ""),
  );

  // Save zipcode from login response if available
  if (user.zipcode) {
    localStorage.setItem("streamly_zipcode", user.zipcode);
  }
}
