/**
 * StreamlyTV – Personal Device Module
 * Uses PopupManager + LoadingManager for popups/loading
 */

// ─── State ────────────────────────────────────────────────────────────────────
let _currentFocus = 'nextbtn';

// ─── Utility ──────────────────────────────────────────────────────────────────

function sanitize(val) {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[<>"'`]/g, "");
}

function viewLoader() {
    LoadingManager.show();
}

function hideLoader() {
    LoadingManager.hide();
}

// ─── Focus Management ─────────────────────────────────────────────────────────

function setFocus(id) {
    const el = document.getElementById(id);
    if (!el) return;
    _currentFocus = id;
    el.focus();
}

// ─── Session Guard ────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem("jwt token") || ""; }
function getPersonalDeviceId() { return localStorage.getItem("personaldeviceid") || ""; }

function redirectToLogin(reason) {
    console.warn("Redirecting to login:", reason);
    localStorage.clear();
    location.href = "../login/login.html";
}

function validateSession() {
    if (!getToken()) {
        PopupManager.showAlert("Session expired. Please login again.", function () {
            redirectToLogin("no token");
        });
        return false;
    }
    if (!getPersonalDeviceId()) {
        PopupManager.showAlert("Device ID missing. Please login again.", function () {
            redirectToLogin("no personaldeviceid");
        });
        return false;
    }
    return true;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

function routeAfterSetup() {
    const userrole = localStorage.getItem("userrole") || "";
    const isCustom = localStorage.getItem("is_custom_user") || "0";
    const userType = localStorage.getItem("user_type") || "";

    if (userrole === "tieruser" && isCustom === "0" && userType === "") {
        location.href = "../hotelroom/hotelroom.html";
        return;
    }
    location.href = "../programmeguide/epg.html";
}

// ─── Save Device Name ─────────────────────────────────────────────────────────

function personaldevice() {
    const deviceName = document.getElementById("devicename").value.trim();

    if (!deviceName) {
        document.getElementById("devicename").blur();
        _currentFocus = 'nextbtn';
        PopupManager.showAlert("Please enter a device name.");
        return;
    }
    if (deviceName.length < 2) {
        document.getElementById("devicename").blur();
        _currentFocus = 'nextbtn';
        PopupManager.showAlert("Device name must be at least 2 characters.");
        return;
    }
    if (deviceName.length > 32) {
        document.getElementById("devicename").blur();
        _currentFocus = 'nextbtn';
        PopupManager.showAlert("Device name must be 32 characters or less.");
        return;
    }

    if (!validateSession()) return;

    // Validate session/subscription via addtorecent before proceeding
    if (typeof AuthSession !== 'undefined' && AuthSession.addToRecentCheck) {
        AuthSession.addToRecentCheck(function (result) {
            if (result === 'expired') return; // popup already shown
            doPersonalDeviceSave(deviceName);
        });
        return; // wait for async callback
    }

    doPersonalDeviceSave(deviceName);
}

function doPersonalDeviceSave(deviceName) {
    viewLoader();

    const myHeaders = new Headers();
    myHeaders.append("Authorization", "Bearer " + getToken());
    myHeaders.append("Accept", "application/json");

    const formdata = new FormData();
    formdata.append("device_type", "non-web");
    formdata.append("devicename", deviceName);

    fetch(API.PERSONAL_DEVICE_NAME + getPersonalDeviceId(), {
        method: "PUT", headers: myHeaders, body: formdata
    })
        .then(function (response) {
            if (response.status === 401) {
                hideLoader();
                PopupManager.showAlert("Session expired. Please login again.", function () {
                    redirectToLogin("401");
                });
                return null;
            }
            if (!response.ok) {
                hideLoader();
                PopupManager.showAlert("Server error (" + response.status + "). Please try again.");
                return null;
            }
            return response.json();
        })
        .then(function (data) {
            if (!data) return;
            hideLoader();

            // Check for session/subscription expired in response body
            if (AuthSession.checkApiResponse(data)) return;

            if (data.success === true) {
                localStorage.setItem("devicename", sanitize(data.data.devicename));
                localStorage.setItem("personaldevicename_popup", "false");
                routeAfterSetup();
            } else {
                PopupManager.showAlert(sanitize(data.message) || "Failed to save device name. Please try again.");
            }
        })
        .catch(function (error) {
            hideLoader();
            console.error("personaldevice fetch error:", error);
            PopupManager.showAlert("Network error. Please check your connection.");
        });
}

// ─── Logout ───────────────────────────────────────────────────────────────────

function doLogout() {
    const token = getToken();
    if (!token) { redirectToLogin("no token"); return; }

    const myHeaders = new Headers();
    myHeaders.append("Authorization", "Bearer " + token);
    myHeaders.append("Accept", "application/json");

    fetch(API.LOGOUT, { method: "POST", headers: myHeaders })
        .then(function (r) { return r.json(); })
        .then(function () { localStorage.clear(); location.href = "../login/login.html"; })
        .catch(function () { localStorage.clear(); location.href = "../login/login.html"; });
}

// ─── Key Handling ─────────────────────────────────────────────────────────────

function handleKeyDown(e) {
    const code = e.keyCode;
    const navKeys = [37, 38, 39, 40, 13, 10009];
    if (navKeys.indexOf(code) !== -1) e.preventDefault();

    // Delegate to PopupManager when popup is open
    if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
        PopupManager.handleKey(code);
        return;
    }

    switch (code) {
        case 38:
            if (_currentFocus === 'devicename') setFocus('logout');
            else if (_currentFocus === 'nextbtn') setFocus('devicename');
            break;

        case 40:
            if (_currentFocus === 'logout') setFocus('devicename');
            else if (_currentFocus === 'devicename') setFocus('nextbtn');
            break;

        case 37:
            if (_currentFocus === 'nextbtn') setFocus('devicename');
            break;

        case 39:
            if (_currentFocus === 'devicename') setFocus('nextbtn');
            break;

        case 13:
            if (_currentFocus === 'nextbtn') {
                personaldevice();
            } else if (_currentFocus === 'logout') {
                PopupManager.logout(function (yes) { if (yes) doLogout(); });
            }
            break;

        case 10009:
            PopupManager.exit(function (yes) {
                if (yes) {
                    try { tizen.application.getCurrentApplication().exit(); } catch (e) { }
                }
            });
            break;
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const init = function () {
    "use strict";

    if (!validateSession()) return;

    // Check if session was marked as expired by another screen
    if (localStorage.getItem('session_expire') === 'session_expire') {
        AuthSession.handleSessionExpired();
        return;
    }

    if (localStorage.getItem("personaldevicename_popup") === "false"
        && localStorage.getItem("devicename")) {
        routeAfterSetup();
        return;
    }

    ['devicename', 'nextbtn', 'logout'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('focus', function () { _currentFocus = id; });
    });

    document.getElementById("nextbtn").addEventListener("click", function () {
        _currentFocus = 'nextbtn';
        personaldevice();
    });

    document.getElementById("logout").addEventListener("click", function () {
        _currentFocus = 'logout';
        PopupManager.logout(function (yes) { if (yes) doLogout(); });
    });

    document.addEventListener("keydown", handleKeyDown);

    setFocus('nextbtn');
};

window.onload = init;