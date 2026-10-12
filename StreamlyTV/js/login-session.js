/**
 * StreamlyTV – shared login helpers
 * Used by the login screen and by the device-limit screen's re-login, so a
 * login completed from either place sends the same device info and saves the
 * same session (personaldeviceid, user role, custom/HOA flags, token, ...).
 *
 * Needs webapis.js (and the Tizen runtime) on the page.
 */

// ─── Device Info (safe Tizen wrappers) ───────────────────────────────────────

function getDeviceId() {
    try {
        return tizen.systeminfo.getCapability("http://tizen.org/system/tizenid") || "";
    } catch (e) {
        console.warn("Could not get Tizen ID:", e);
        return "unknown-device-" + Date.now();
    }
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
    let deviceOsVersion = "9.0";
    try {
        if (webapis.productinfo.getRealModel) deviceOsVersion = webapis.productinfo.getRealModel();
    } catch (e) {
        console.warn("Could not get real model:", e);
    }
    const zipcode = localStorage.getItem('streamly_zipcode') || "302020";
    const deviceTitle = "SamsungTV";

    return {
        uid: uid,
        version: version,
        deviceModel: deviceModel,
        deviceFriendly: deviceFriendly,
        buildVersion: buildVersion,
        deviceOsVersion: deviceOsVersion,
        zipcode: zipcode,
        deviceTitle: deviceTitle
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
    localStorage.setItem("personaldeviceid", sanitizeSessionValue(data.personaldeviceid));
    localStorage.setItem("devicetype", sanitizeSessionValue(data.device_type));
    localStorage.setItem("userrole", sanitizeSessionValue(data.userrole));
    localStorage.setItem("is_custom_user", String(user.is_custom_user));
    localStorage.setItem("user_type", sanitizeSessionValue(user.user_type || ""));
    // HOA accounts: both main and sub users log in with userrole "hoa";
    // these flags are the only thing that tells them apart.
    localStorage.setItem("is_hoa_main_user", data.is_hoa_main_user === true ? "1" : "0");
    localStorage.setItem("is_hoa_sub_user", data.is_hoa_sub_user === true ? "1" : "0");
    localStorage.setItem("jwt token", data.access_token);
    localStorage.setItem("rooms", JSON.stringify(data.rooms || []));
    localStorage.setItem("personaldevicename_popup", data.personaldevicename_popup ? "true" : "false");
    localStorage.setItem("devicename", sanitizeSessionValue(data.devicename || ""));

    // Save zipcode from login response if available
    if (user.zipcode) {
        localStorage.setItem('streamly_zipcode', user.zipcode);
    }
}
