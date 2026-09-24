/**
 * StreamlyTV – Login Module
 * Tizen Samsung TV Web App
 * Uses PopupManager + LoadingManager for popups/loading
 * v2.6.0 — Unified Email / Passcode / QR login flow
 *          (all three now share device payload, 479/410 handling,
 *          and final redirect logic via handleLoginResponse)
 *          + Forgot Password screen with TV remote focus nav
 *          + Robust JSON parsing for 479/410 responses (Task 1)
 *          + Directional Eye Toggle focus (Task 2)
 *          + Login button default/focus color states (Task 3)
 *          + QR screen: 1 minute countdown, then blurred "Expired" QR with a
 *            Refresh QR Code button (stays on the QR screen)
 *          + On-screen keypad opens only on OK; arrow keys move the text
 *            cursor (not remote focus) while the keypad is open (Task 5)
 */

// ─── State ──────────────────────────────────────────────────────────────────
let _activeTab = 'email'; // 'email' | 'passcode' | 'qr' | 'forgot'
let _forgotReturnTab = 'email'; // tab to restore when leaving the forgot-password screen
let _currentFocus = 'username';
let _qrKey = null;
let _qrTimer = null;
let _qrPolling = false;
let _qrTimeoutTimer = null; // Task 4: 1-minute auto-close timer for the QR screen
let _qrCountdownInterval = null; // Task 4: drives the visible "closing in Ns" text
let _qrSecondsRemaining = 60; // Task 4: seconds left on the current QR countdown
let _qrExpired = false; // countdown ended: QR blurred, Refresh QR Code button shown

// ── On-screen keypad state ──────────────────────────────────────────────────
// The keypad should NOT open just because a field received focus — only when
// the user presses OK on a focused field. While it's open, Left/Right must
// only move the text cursor inside that field and must never move remote
// focus to another UI element.
let _isKeypadOpen = false;
let _keypadTargetId = null;
const INPUT_FIELD_IDS = ['username', 'password', 'passcode-input', 'fp-email'];

// Task 2: map an input field to its associated Eye Toggle button, and back.
// Eye Toggle should ONLY be reachable via RIGHT from its field (never via DOWN).
const EYE_TOGGLE_MAP = {
    'password': 'eye-toggle',
    'passcode-input': 'passcode-eye-toggle'
};
const EYE_TOGGLE_SOURCE_MAP = {
    'eye-toggle': 'password',
    'passcode-eye-toggle': 'passcode-input'
};

// ─── Utility ────────────────────────────────────────────────────────────────

function sanitize(val) {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[<>"'`]/g, "");
}

function isValidEmail(email) {
    const mailformat = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    return mailformat.test(email);
}

function showLoader() {
    LoadingManager.show();
}

function hideLoader() {
    LoadingManager.hide();
}

// ─── Alert Popup ─────────────────────────────────────────────────────────────

function showAlert(message, callback) {
    PopupManager.showAlert(message, callback);
}

// ─── Exit Confirm Popup ───────────────────────────────────────────────────────
function openExitPopup() {
    PopupManager.exit(function (confirmed) {
        if (confirmed) {
            try { tizen.application.getCurrentApplication().exit(); } catch (e) { }
        }
    });
}

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
// Every login flow (email, passcode, QR) must send the SAME device info to the
// backend so device-limit tracking / device list / analytics stay consistent.

function buildDevicePayload() {
    const uid = getDeviceId();
    const version = getTVVersion();
    const deviceModel = getTVModel();
    const deviceFriendly = "Samsung " + deviceModel;
    const buildVersion = tizen.application.getCurrentApplication().appInfo.version;
    const deviceOsVersion = webapis.productinfo.getRealModel
        ? webapis.productinfo.getRealModel()
        : "9.0";
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

// ─── Shared 479 (device limit) handler ───────────────────────────────────────
// Same UX for all three flows: save whatever device list / identity info we
// have, then offer to go manage devices on device.html.

// response_code can arrive as a number or a string depending on the endpoint.
function isDeviceLimitResponse(data) {
    return Number(data.response_code) === 479;
}

// Internal exception text (e.g. "Cannot read property 'email' of undefined"),
// whether from the backend's `message` or a client-side error, must never be
// shown to the user.
function friendlyServerMessage(message, fallback) {
    if (!message || /cannot read propert|undefined|is not a function|TypeError|ReferenceError/i.test(message)) {
        return fallback;
    }
    return message;
}

function handleDeviceLimitResponse(data, identity, device) {
    if (data.loggedindeviceinfolist && data.loggedindeviceinfolist.data) {
        localStorage.setItem("deviceList", JSON.stringify(data.loggedindeviceinfolist.data));
    }
    if (identity.email) {
        localStorage.setItem("email", sanitize(identity.email));
    }
    // device.html re-logs in after a device is removed, and needs to know
    // which credentials to use. Clear stale ones from a previous method.
    localStorage.setItem("loginMethod", identity.method);
    localStorage.removeItem("password");
    localStorage.removeItem("passcode");
    if (identity.password) {
        localStorage.setItem("password", identity.password);
    }
    if (identity.passcode) {
        localStorage.setItem("passcode", identity.passcode);
    }
    localStorage.setItem("deviceid", sanitize(device.uid));
    localStorage.setItem("version", sanitize(device.version));

    hideLoader();
    PopupManager.showConfirm('Your device limit is over. You want to remove any device from list?', function (confirmed) {
        if (confirmed) {
            location.href = "../device/device.html";
        } else if (_activeTab === 'qr') {
            // The QR key has already been scanned, so resuming polling on it
            // would re-trigger the login (and this popup) within seconds.
            // Leave the QR screen instead — switchTab stops polling, clears
            // the auto-close timer and drops the key.
            switchTab('email');
        }
    }, 'Yes', 'Cancel');
}

// =============================================================================
// ─── TAB SWITCHING ──────────────────────────────────────────────────────────
// =============================================================================

function switchTab(tabId) {
    if (tabId === _activeTab) return;

    // Make sure the keypad isn't left open (and its field un-readonly) when
    // we navigate away from it.
    closeKeypad();

    // Stop QR polling / auto-timeout when leaving QR tab
    if (_activeTab === 'qr') {
        stopQRPolling();
        clearQRTimeout();
        _qrKey = null;
    }

    _activeTab = tabId;

    // Update panes
    const panes = document.querySelectorAll('.tab-pane');
    for (let i = 0; i < panes.length; i++) {
        panes[i].classList.remove('active');
    }
    const activePane = document.getElementById('pane-' + tabId);
    if (activePane) activePane.classList.add('active');

    // Update right-side tab buttons
    updateSideTabs(tabId);

    // Focus the first input / button in the active pane
    if (tabId === 'email') {
        _currentFocus = 'username';
        const el = document.getElementById('username');
        if (el) setTimeout(function () { el.focus(); }, 50);
    } else if (tabId === 'passcode') {
        _currentFocus = 'passcode-input';
        const el = document.getElementById('passcode-input');
        if (el) setTimeout(function () { el.focus(); }, 50);
    } else if (tabId === 'qr') {
        // Task 4: no refresh button on this screen anymore — focus the QR area itself.
        _currentFocus = 'qr-code-area';
        const el = document.getElementById('qr-code-area');
        if (el) setTimeout(function () { el.focus(); }, 50);
        // Generate QR code when switching to QR tab
        createQRCode();
        // Start the 1-minute auto-close countdown for this screen
        startQRTimeout();
    }
}

function updateSideTabs(activeTab) {
    const passcodeWrap = document.getElementById('login-pass-wrap');
    const qrWrap = document.getElementById('login-qr-wrap');
    if (!passcodeWrap || !qrWrap) return;

    const passcodeBtn = document.getElementById('tab-btn-passcode');
    const qrBtn = document.getElementById('tab-btn-qr');

    if (activeTab === 'email') {
        // Show: Passcode + QR
        passcodeWrap.style.display = 'block';
        qrWrap.style.display = 'block';
        setSideTabButton(passcodeBtn, 'fa-lock', 'Login with Passcode', 'passcode');
        setSideTabButton(qrBtn, 'fa-qrcode', 'Login with QR', 'qr');
    } else if (activeTab === 'passcode') {
        // Show: Email + QR
        passcodeWrap.style.display = 'block';
        qrWrap.style.display = 'block';
        setSideTabButton(passcodeBtn, 'fa-envelope', 'Login with Email', 'email');
        setSideTabButton(qrBtn, 'fa-qrcode', 'Login with QR', 'qr');
    } else if (activeTab === 'qr') {
        // Show: Email + Passcode
        passcodeWrap.style.display = 'block';
        qrWrap.style.display = 'block';
        setSideTabButton(passcodeBtn, 'fa-envelope', 'Login with Email', 'email');
        setSideTabButton(qrBtn, 'fa-lock', 'Login with Passcode', 'passcode');
    }
}

function setSideTabButton(btn, iconClass, text, tabId) {
    if (!btn) return;
    btn.setAttribute('data-tab', tabId);
    const icon = btn.querySelector('.login-alt-icon');
    const label = btn.querySelector('.login-alt-text');
    if (icon) icon.className = 'fas ' + iconClass + ' login-alt-icon';
    if (label) label.textContent = text;
}

// =============================================================================
// ─── EMAIL LOGIN ────────────────────────────────────────────────────────────
// =============================================================================

function login() {
    const email = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email) {
        setTimeout(function () { showAlert("Please enter an email."); }, 100);
        hideLoader();
        return;
    }
    if (!isValidEmail(email)) {
        setTimeout(function () { showAlert("Please enter a valid email."); }, 100);
        hideLoader();
        return;
    }
    if (!password) {
        setTimeout(function () { showAlert("Please enter a password."); }, 100);
        hideLoader();
        return;
    }
    if (password.length < 6) {
        setTimeout(function () { showAlert("Password must be at least 6 characters long."); }, 100);
        hideLoader();
        return;
    }

    const device = buildDevicePayload();

    const formData = new FormData();
    formData.append("email", email);
    formData.append("password", password);
    appendDeviceFields(formData, device);

    fetchWithRetry(
        API.LOGIN,
        { method: "POST", body: formData, mode: "cors", headers: { "Accept": "application/json" } },
        3,
        1000
    )
        .then(function (data) {
            if (data === null || data === undefined) {
                showAlert("Empty response from server. Please try again.");
                hideLoader();
                return;
            }

            if (isDeviceLimitResponse(data)) {
                handleDeviceLimitResponse(data, { method: 'email', email: email, password: password }, device);
                return;
            }

            if (data.response_code === 410) {
                hideLoader();
                AuthSession.handleSubscriptionExpired(data.subscribedmsgis || data.message);
                return;
            }

            if (!data.success) {
                showAlert(friendlyServerMessage(data.message, "Login failed. Please check your credentials."));
                hideLoader();
                return;
            }

            handleLoginResponse(data, email, device.uid, device.version);
        })
        .catch(function (error) {
            console.error("Login fetch error:", error);
            const msg = friendlyServerMessage(error && error.message, "Something went wrong. Please try again.");
            showAlert(msg);
            hideLoader();
        });
}

// =============================================================================
// ─── PASSCODE LOGIN ─────────────────────────────────────────────────────────
// =============================================================================

function loginWithPasscode() {
    const passcode = document.getElementById("passcode-input").value.trim();

    if (!passcode) {
        setTimeout(function () { showAlert("Please enter a passcode."); }, 100);
        hideLoader();
        return;
    }
    if (passcode.length < 4) {
        setTimeout(function () { showAlert("Passcode must be at least 4 characters."); }, 100);
        hideLoader();
        return;
    }

    const device = buildDevicePayload();

    const formData = new FormData();
    formData.append("passcode", passcode);
    appendDeviceFields(formData, device);

    fetchWithRetry(
        API.LOGIN_WITH_PASSCODE,
        { method: "POST", body: formData, headers: { "Accept": "application/json" } },
        3,
        1000
    )
        .then(function (data) {
            if (data === null || data === undefined) {
                showAlert("Empty response from server. Please try again.");
                hideLoader();
                return;
            }

            // Guard against endpoints that don't return `user` on a 479 response
            const responseEmail = (data.user && data.user.email) ? data.user.email : "";

            if (isDeviceLimitResponse(data)) {
                handleDeviceLimitResponse(data, { method: 'passcode', email: responseEmail, passcode: passcode }, device);
                return;
            }

            if (data.response_code === 410) {
                hideLoader();
                AuthSession.handleSubscriptionExpired(data.subscribedmsgis || data.message);
                return;
            }

            if (!data.success) {
                showAlert(friendlyServerMessage(data.message, "Login failed. Please check your passcode."));
                hideLoader();
                return;
            }

            handleLoginResponse(data, responseEmail, device.uid, device.version);
        })
        .catch(function (error) {
            console.error("Passcode login error:", error);
            const msg = friendlyServerMessage(error && error.message, "Something went wrong. Please try again.");
            showAlert(msg);
            hideLoader();
        });
}

// =============================================================================
// ─── QR LOGIN ───────────────────────────────────────────────────────────────
// Same flow as email/passcode: full device payload, fetchWithRetry, and
// 479 / 410 / success handled identically via the shared helpers.
// =============================================================================

function createQRCode() {
    const qrImage = document.getElementById('qr-code-image');
    const qrFallback = document.getElementById('qr-fallback');

    // Show loading state
    if (qrImage) qrImage.style.display = 'none';
    if (qrFallback) {
        qrFallback.style.display = 'flex';
        qrFallback.innerHTML = '<i class="fas fa-spinner fa-pulse qr-icon"></i><p class="qr-refresh-text">Generating QR code...</p>';
    }

    fetchWithRetry(
        API.QR_CREATE,
        { method: "POST" },
        3,
        1000
    )
        .then(function (result) {
            // Countdown ended while this request was in flight — keep the
            // expired state until the user presses Refresh QR Code.
            if (_qrExpired) return;
            if (result && result.status === 1) {
                _qrKey = result.key;
                // Show QR image
                if (qrImage) {
                    qrImage.src = result.msg;
                    qrImage.style.display = 'block';
                    qrImage.onerror = function () {
                        qrImage.style.display = 'none';
                        if (qrFallback) {
                            qrFallback.style.display = 'flex';
                            qrFallback.innerHTML = '<i class="fas fa-qrcode qr-icon"></i><p class="qr-refresh-text">Scan QR to login</p>';
                        }
                    };
                    qrImage.onload = function () {
                        if (qrFallback) qrFallback.style.display = 'none';
                    };
                }
                // Start polling
                startQRPolling();
            } else {
                // Task 4: no Refresh button to point the user to anymore —
                // automatically retry generating the QR code instead.
                if (qrFallback) {
                    qrFallback.style.display = 'flex';
                    qrFallback.innerHTML = '<i class="fas fa-exclamation-circle qr-icon" style="color:var(--color-error-text);"></i><p class="qr-refresh-text">Failed to generate QR. Retrying...</p>';
                }
                setTimeout(function () {
                    if (_activeTab === 'qr' && !_qrKey && !_qrExpired) {
                        createQRCode();
                    }
                }, 3000);
            }
        })
        .catch(function (error) {
            console.error("QR creation error:", error);
            if (qrFallback) {
                qrFallback.style.display = 'flex';
                qrFallback.innerHTML = '<i class="fas fa-exclamation-circle qr-icon" style="color:var(--color-error-text);"></i><p class="qr-refresh-text">Connection error. Retrying...</p>';
            }
            setTimeout(function () {
                if (_activeTab === 'qr' && !_qrKey && !_qrExpired) {
                    createQRCode();
                }
            }, 3000);
        });
}

function startQRPolling() {
    stopQRPolling();
    if (!_qrKey) return;
    _qrPolling = true;
    _qrTimer = setInterval(function () {
        checkQRScan();
    }, 3000);
}

function stopQRPolling() {
    _qrPolling = false;
    if (_qrTimer) {
        clearInterval(_qrTimer);
        _qrTimer = null;
    }
}

// 1-minute countdown for the QR code. When it ends the user stays on the
// QR screen: the code is blurred with an "Expired" overlay and a Refresh QR
// Code button takes the countdown's place (see expireQRCode()).
function startQRTimeout() {
    clearQRTimeout();
    setQRExpiredState(false);

    _qrSecondsRemaining = 60;
    updateQRCountdownDisplay(_qrSecondsRemaining);

    _qrCountdownInterval = setInterval(function () {
        _qrSecondsRemaining -= 1;
        updateQRCountdownDisplay(_qrSecondsRemaining);
        if (_qrSecondsRemaining <= 0) {
            clearInterval(_qrCountdownInterval);
            _qrCountdownInterval = null;
        }
    }, 1000);

    _qrTimeoutTimer = setTimeout(function () {
        _qrTimeoutTimer = null;
        expireQRCode();
    }, 60000); // 1 minute
}

// Timed out without a completed login: stop polling, drop the key and show
// the expired state instead of leaving the QR screen.
function expireQRCode() {
    stopQRPolling();
    clearQRTimeout();
    _qrKey = null;
    setQRExpiredState(true);

    // If the remote was on the QR itself, move it to the Refresh button;
    // don't steal focus from the side tab buttons.
    const active = document.activeElement ? document.activeElement.id : '';
    if (_activeTab === 'qr' && (active === 'qr-code-area' || active === '' || document.activeElement === document.body)) {
        const btn = document.getElementById('qr-refresh-btn');
        if (btn) btn.focus();
    }
}

function setQRExpiredState(expired) {
    _qrExpired = expired;
    const container = document.querySelector('.qr-login-container');
    if (container) container.classList.toggle('qr-expired', expired);
}

// Refresh QR Code button: new code + new 1-minute countdown, same as
// opening the QR screen.
function refreshQRCode() {
    if (_activeTab !== 'qr') return;
    stopQRPolling();
    _qrKey = null;
    startQRTimeout(); // clears the expired state first, so createQRCode() isn't ignored
    createQRCode();
    const el = document.getElementById('qr-code-area');
    if (el) el.focus();
}

function clearQRTimeout() {
    if (_qrTimeoutTimer) {
        clearTimeout(_qrTimeoutTimer);
        _qrTimeoutTimer = null;
    }
    if (_qrCountdownInterval) {
        clearInterval(_qrCountdownInterval);
        _qrCountdownInterval = null;
    }
}

function updateQRCountdownDisplay(seconds) {
    const el = document.getElementById('qr-countdown-text');
    if (!el) return;
    const safeSeconds = seconds > 0 ? seconds : 0;
    el.textContent = "This code expires in " + safeSeconds + "s";
    el.classList.toggle('qr-countdown-warning', safeSeconds <= 10);
}

function checkQRScan() {
    if (!_qrKey) return;

    const formdata = new FormData();
    formdata.append("key", _qrKey);

    fetchWithRetry(
        API.QR_SCAN,
        { method: "POST", body: formdata },
        3,
        1000
    )
        .then(function (result) {
            if (result && result.status === 1) {
                // QR code was scanned — proceed to login. Cancel the auto-close
                // timeout so it can't fire mid-login.
                stopQRPolling();
                clearQRTimeout();
                completeQRLogin();
            }
            // status !== 1 means not yet scanned — keep polling
        })
        .catch(function (error) {
            console.error("QR scan check error:", error);
            // Keep polling — network might recover
        });
}

function completeQRLogin() {
    const device = buildDevicePayload();

    // Show "Logging in..." state in QR area
    const qrImage = document.getElementById('qr-code-image');
    const qrFallback = document.getElementById('qr-fallback');
    if (qrImage) qrImage.style.display = 'none';
    if (qrFallback) {
        qrFallback.style.display = 'flex';
        qrFallback.innerHTML = '<i class="fas fa-spinner fa-pulse qr-icon"></i><p class="qr-refresh-text">Logging in...</p>';
    }

    const formData = new FormData();
    formData.append("key", _qrKey);
    appendDeviceFields(formData, device);

    fetchWithRetry(
        API.QR_LOGIN,
        { method: "POST", body: formData, headers: { "Accept": "application/json" } },
        3,
        1000
    )
        .then(function (data) {
            if (data === null || data === undefined) {
                showAlert("Empty response from server. Please try again.");
                resetQRToReady();
                return;
            }

            const responseEmail = (data.user && data.user.email) ? data.user.email : "";

            // Same device-limit convention as email/passcode (479 -> device.html)
            if (isDeviceLimitResponse(data)) {
                handleDeviceLimitResponse(data, { method: 'qr', email: responseEmail }, device);
                return;
            }

            // Same subscription-expired convention as email/passcode
            if (data.response_code === 410) {
                hideLoader();
                AuthSession.handleSubscriptionExpired(data.subscribedmsgis || data.message);
                return;
            }

            if (!data.success) {
                showAlert(friendlyServerMessage(data.message, "Login failed. Please try again."));
                resetQRToReady();
                return;
            }

            // Route through the exact same success/redirect logic as
            // email and passcode login.
            handleLoginResponse(data, responseEmail, device.uid, device.version);
        })
        .catch(function (error) {
            console.error("QR login error:", error);
            showAlert("Failed to connect to the server. Please try again.");
            resetQRToReady();
        });
}

function resetQRToReady() {
    const qrImage = document.getElementById('qr-code-image');
    const qrFallback = document.getElementById('qr-fallback');
    if (qrImage) {
        qrImage.style.display = 'block';
        qrImage.onerror = function () {
            qrImage.style.display = 'none';
            if (qrFallback) {
                qrFallback.style.display = 'flex';
                qrFallback.innerHTML = '<i class="fas fa-qrcode qr-icon"></i><p class="qr-refresh-text">Scan QR to login</p>';
            }
        };
    }
    if (qrFallback) qrFallback.style.display = 'none';

    // Resume polling on the same key so the user doesn't have to re-scan
    // just because a transient error occurred.
    if (_qrKey) {
        startQRPolling();
    }
}

// =============================================================================
// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
// =============================================================================

function showForgotPasswordScreen() {
    closeKeypad();

    // Remember which pane we came from so BACK / "Back to login" restores it.
    _forgotReturnTab = (_activeTab === 'forgot') ? _forgotReturnTab : _activeTab;

    if (_activeTab === 'qr') {
        stopQRPolling();
        clearQRTimeout();
    }

    const loginWrapper = document.querySelector('.login-wrapper');
    const fpWrapper = document.getElementById('forgot-password-wrapper');
    const fpEmail = document.getElementById('fp-email');

    if (loginWrapper) loginWrapper.style.display = 'none';
    if (fpWrapper) fpWrapper.style.display = 'flex';
    if (fpEmail) fpEmail.value = '';

    _activeTab = 'forgot';

    if (fpEmail) {
        setTimeout(function () { fpEmail.focus(); }, 50);
    }
}

function hideForgotPasswordScreen() {
    closeKeypad();

    const loginWrapper = document.querySelector('.login-wrapper');
    const fpWrapper = document.getElementById('forgot-password-wrapper');

    if (fpWrapper) fpWrapper.style.display = 'none';
    if (loginWrapper) loginWrapper.style.display = 'block';

    _activeTab = _forgotReturnTab || 'email';

    const el = document.getElementById('forgot-password-link');
    if (_activeTab === 'email' && el) {
        setTimeout(function () { el.focus(); }, 50);
    } else {
        switchTabFocusOnly(_activeTab);
    }
}

// Re-focuses the right element for a tab without re-running switchTab's
// pane-visibility logic (login-wrapper panes were never actually changed
// while the forgot-password screen was showing).
function switchTabFocusOnly(tabId) {
    const focusId = (tabId === 'passcode') ? 'passcode-input'
        : (tabId === 'qr') ? 'qr-code-area'
            : 'username';
    const el = document.getElementById(focusId);
    if (el) setTimeout(function () { el.focus(); }, 50);
    if (tabId === 'qr') {
        // Resume polling if we still have a live key, otherwise regenerate.
        if (_qrKey) {
            startQRPolling();
        } else {
            createQRCode();
        }
        // Task 4: restart the 1-minute auto-close countdown for this screen.
        startQRTimeout();
    }
}

function forgotPassword() {
    const emailInput = document.getElementById('fp-email');
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) {
        setTimeout(function () { showAlert("Please enter your email."); }, 100);
        hideLoader();
        return;
    }
    if (!isValidEmail(email)) {
        setTimeout(function () { showAlert("Please enter a valid email."); }, 100);
        hideLoader();
        return;
    }

    const formData = new FormData();
    formData.append("email", email);

    const headers = { "Accept": "application/json" };
    const token = localStorage.getItem("jwt token");
    if (token) {
        headers["Authorization"] = "Bearer " + token;
    }

    fetchWithRetry(
        API.FORGOT_PASSWORD,
        { method: "POST", body: formData, headers: headers },
        3,
        1000
    )
        .then(function (data) {
            hideLoader();

            if (data === null || data === undefined) {
                showAlert("Empty response from server. Please try again.");
                return;
            }

            if (!data.success) {
                // e.g. "We can't find a user with that email address."
                showAlert(data.message || "Email not found. Please check and try again.");
                return;
            }

            showAlert(data.message || "Reset password link sent to your email.", function () {
                hideForgotPasswordScreen();
            });
        })
        .catch(function (error) {
            console.error("Forgot password error:", error);
            hideLoader();
            const msg = friendlyServerMessage(error && error.message, "Something went wrong. Please try again.");
            showAlert(msg);
        });
}

// =============================================================================
// ─── FETCH WITH RETRY ──────────────────────────────────────────────────────
// Task 1 fix: previously this called response.json() directly. When an
// endpoint (e.g. login-with-passcode on a device-limit condition) responds
// with a non-standard HTTP status (479 / 410) and an empty or non-JSON body,
// response.json() throws "Unexpected end of JSON input" and that raw
// internal error was shown to the user, blocking the Device Limit flow.
//
// Now we read the body as text first and parse it safely. If parsing fails
// but the HTTP status is one we understand (479 = device limit, 410 =
// subscription expired), we synthesize the minimal response object the
// calling code expects so those flows keep working. Any other parse failure
// becomes a friendly, user-facing message instead of a raw JS error.
// =============================================================================

function fetchWithRetry(url, options, retries, delay) {
    return fetch(url, options).then(function (response) {
        if (response.status === 429 && retries > 0) {
            console.warn("Rate limit hit, retrying in " + delay + "ms...");
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(fetchWithRetry(url, options, retries - 1, delay * 2));
                }, delay);
            });
        }

        return response.text().then(function (rawText) {
            let parsedData = null;

            if (rawText && rawText.trim().length > 0) {
                try {
                    parsedData = JSON.parse(rawText);
                } catch (parseError) {
                    console.error("Failed to parse server response as JSON:", parseError, "Raw response:", rawText);
                    parsedData = null;
                }
            }

            if (parsedData === null) {
                // Body was empty/invalid JSON — fall back to the HTTP status
                // itself for the two conditions our flows key off of, so the
                // Device Limit and Subscription Expired popups still show.
                if (response.status === 479 || response.status === 410) {
                    parsedData = { response_code: response.status, success: false };
                } else {
                    throw new Error("We couldn't process the server's response. Please try again.");
                }
            } else if ((response.status === 479 || response.status === 410) && !parsedData.response_code) {
                // JSON body without a response_code (e.g. a backend error
                // payload) — the HTTP status still tells us which flow applies.
                parsedData.response_code = response.status;
            }

            return parsedData;
        });
    });
}

// =============================================================================
// ─── HANDLE SUCCESSFUL LOGIN RESPONSE ──────────────────────────────────────
// Shared by email, passcode, and QR login — single source of truth for what
// gets stored in localStorage and where the user is redirected to next.
// =============================================================================

function handleLoginResponse(data, email, uid, version) {

    if (data.response_code === 479) {
        localStorage.setItem("user_id", String(data.user.id));
        localStorage.setItem("email", sanitize(email));
        localStorage.setItem("deviceid", sanitize(uid));
        localStorage.setItem("version", sanitize(version));
        localStorage.setItem("personaldeviceid", sanitize(data.personaldeviceid));
        localStorage.setItem("devicetype", sanitize(data.device_type));
        localStorage.setItem("userrole", sanitize(data.userrole));
        localStorage.setItem("jwt token", data.access_token);
        localStorage.setItem("devices",
            JSON.stringify((data.loggedindeviceinfolist && data.loggedindeviceinfolist.data) || []));
        localStorage.setItem("rooms",
            JSON.stringify(data.rooms || []));
        hideLoader();
        location.href = "../device/device.html";
        return;
    }

    if (!data.success) {
        showAlert(friendlyServerMessage(data.message, "Login failed. Please check your credentials."));
        hideLoader();
        return;
    }

    localStorage.setItem("user_id", String(data.user.id));
    localStorage.setItem("email", sanitize(email));
    localStorage.setItem("deviceid", sanitize(uid));
    localStorage.setItem("version", sanitize(version));
    localStorage.setItem("personaldeviceid", sanitize(data.personaldeviceid));
    localStorage.setItem("devicetype", sanitize(data.device_type));
    localStorage.setItem("userrole", sanitize(data.userrole));
    localStorage.setItem("is_custom_user", String(data.user.is_custom_user));
    localStorage.setItem("user_type", sanitize(data.user.user_type || ""));
    localStorage.setItem("jwt token", data.access_token);
    localStorage.setItem("rooms", JSON.stringify(data.rooms || []));
    localStorage.setItem("personaldevicename_popup", data.personaldevicename_popup ? "true" : "false");
    localStorage.setItem("devicename", sanitize(data.devicename || ""));

    // Save zipcode from login response if available
    if (data.user && data.user.zipcode) {
        localStorage.setItem('streamly_zipcode', data.user.zipcode);
    }

    if (data.personaldevicename_popup === true) {
        location.href = "../personaldevice/personaldevice.html";
        return;
    }

    if (data.userrole === "tieruser") {
        if (data.user.is_custom_user === 0) {
            location.href = "../hotelroom/hotelroom.html";
            return;
        }
        location.href = "../programmeguide/epg.html";
        return;
    }

    location.href = "../programmeguide/epg.html";
}

// =============================================================================
// ─── EYE TOGGLE ────────────────────────────────────────────────────────────
// =============================================================================

function togglePasswordVisibility() {
    const pwdInput = document.getElementById("password");
    const eyeIcon = document.getElementById("eye-icon");
    if (pwdInput.type === "password") {
        pwdInput.type = "text";
        if (eyeIcon) { eyeIcon.className = "far fa-eye"; }
    } else {
        pwdInput.type = "password";
        if (eyeIcon) { eyeIcon.className = "far fa-eye-slash"; }
    }
}

function togglePasscodeVisibility() {
    const pwdInput = document.getElementById("passcode-input");
    const eyeIcon = document.getElementById("passcode-eye-icon");
    if (pwdInput.type === "password") {
        pwdInput.type = "text";
        if (eyeIcon) { eyeIcon.className = "far fa-eye"; }
    } else {
        pwdInput.type = "password";
        if (eyeIcon) { eyeIcon.className = "far fa-eye-slash"; }
    }
}

// =============================================================================
// ─── ON-SCREEN KEYPAD ───────────────────────────────────────────────────────
// All login inputs are marked `readonly` in the markup so simply focusing
// them (via remote navigation) never triggers the TV's on-screen keypad.
// The keypad is opened explicitly by openKeypadFor() when the user presses
// OK on a focused field, and closed by closeKeypad(), which restores
// `readonly` so the field goes back to being nav-only until OK is pressed
// again.
// =============================================================================

function isInputFieldId(id) {
    return INPUT_FIELD_IDS.indexOf(id) !== -1;
}

function openKeypadFor(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.removeAttribute('readonly');
    _isKeypadOpen = true;
    _keypadTargetId = id;

    // Re-focusing now that the field is editable is what invokes the TV's
    // native on-screen keypad for this input.
    el.focus();

    // Put the caret at the end of any existing text so editing continues
    // naturally instead of jumping to the start.
    const len = el.value ? el.value.length : 0;
    try { el.setSelectionRange(len, len); } catch (e) { /* not all input types support this */ }
}

function closeKeypad() {
    if (!_isKeypadOpen) return;

    const el = _keypadTargetId ? document.getElementById(_keypadTargetId) : null;
    if (el) {
        el.setAttribute('readonly', 'readonly');
    }
    _isKeypadOpen = false;
    _keypadTargetId = null;
}

// =============================================================================
// ─── KEYBOARD NAVIGATION ───────────────────────────────────────────────────
// Task 2: Eye Toggle buttons are intentionally EXCLUDED from the linear
// left-side traversal arrays below. They are only reachable via RIGHT from
// their associated field (see EYE_TOGGLE_MAP / EYE_TOGGLE_SOURCE_MAP), and
// are handled as special cases inside handleKeyDown so DOWN never lands on
// them.
// =============================================================================

function getLeftSideElements() {
    if (_activeTab === 'email') {
        return ['username', 'password', 'forgot-password-link', 'signinbutton'];
    } else if (_activeTab === 'passcode') {
        return ['passcode-input', 'passcode-login-btn'];
    } else if (_activeTab === 'qr') {
        // Once the code has expired, the Refresh QR Code button replaces it
        return _qrExpired ? ['qr-refresh-btn'] : ['qr-code-area'];
    } else if (_activeTab === 'forgot') {
        return ['fp-back-btn', 'fp-email', 'fp-submit-btn'];
    }
    return [];
}

function getRightSideElements() {
    if (_activeTab === 'forgot') return [];

    const rightElements = [];
    const btn1 = document.getElementById('tab-btn-passcode');
    const btn2 = document.getElementById('tab-btn-qr');
    const wrap1 = document.getElementById('login-pass-wrap');
    const wrap2 = document.getElementById('login-qr-wrap');
    if (wrap1 && wrap1.style.display !== 'none' && btn1) rightElements.push('tab-btn-passcode');
    if (wrap2 && wrap2.style.display !== 'none' && btn2) rightElements.push('tab-btn-qr');
    return rightElements;
}

function handleKeyDown(e) {
    // Delegate to PopupManager first if popup is open
    if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
        PopupManager.handleKey(e.keyCode);
        e.preventDefault();
        return;
    }

    // While the on-screen keypad is open on a field, arrow keys must only
    // move the text cursor inside that field — they must never fall through
    // to remote-navigation and steal focus to another element.
    if (_isKeypadOpen) {
        const activeId = document.activeElement ? document.activeElement.id : '';

        if (activeId === _keypadTargetId) {
            if (e.keyCode === 37 || e.keyCode === 39) {
                // LEFT / RIGHT: let the browser/native keypad move the caret.
                // Do NOT preventDefault, do NOT run our nav logic below.
                return;
            }
            if (e.keyCode === 13) {
                // OK confirms the current text and closes the keypad.
                e.preventDefault();
                closeKeypad();
                return;
            }
            if (e.keyCode === 10009 || e.keyCode === 10182) {
                // BACK / EXIT closes the keypad instead of exiting the app / screen.
                e.preventDefault();
                closeKeypad();
                return;
            }
            if (e.keyCode === 38 || e.keyCode === 40) {
                // UP / DOWN: close the keypad first, then fall through to the
                // normal navigation logic below so focus can move as usual.
                closeKeypad();
            }
        } else {
            // Focus moved off the field the keypad belonged to — keep state in sync.
            closeKeypad();
        }
    }

    const id = document.activeElement ? document.activeElement.id : '';
    const leftElements = getLeftSideElements();
    const rightElements = getRightSideElements();
    const allElements = leftElements.concat(rightElements);
    let currentIdx = -1;
    for (let i = 0; i < allElements.length; i++) {
        if (allElements[i] === id) {
            currentIdx = i;
            break;
        }
    }

    const leftCount = leftElements.length;
    const isOnEyeToggle = Object.prototype.hasOwnProperty.call(EYE_TOGGLE_SOURCE_MAP, id);

    switch (e.keyCode) {
        case 37: // LEFT
            e.preventDefault();
            if (isOnEyeToggle) {
                // Eye Toggle -> back to its field
                const fieldEl = document.getElementById(EYE_TOGGLE_SOURCE_MAP[id]);
                if (fieldEl) fieldEl.focus();
                break;
            }
            // If on a right-side element, move to the login/submit button on the left
            if (currentIdx >= leftCount) {
                const btnId = leftElements[leftElements.length - 1];
                const el = document.getElementById(btnId);
                if (el) el.focus();
            }
            break;

        case 38: // UP
            e.preventDefault();
            if (isOnEyeToggle) {
                // Eye Toggle -> its field sits directly above it
                const fieldEl = document.getElementById(EYE_TOGGLE_SOURCE_MAP[id]);
                if (fieldEl) fieldEl.focus();
                break;
            }
            if (currentIdx > 0) {
                const prevEl = document.getElementById(allElements[currentIdx - 1]);
                if (prevEl) prevEl.focus();
            }
            break;

        case 39: // RIGHT
            e.preventDefault();
            if (EYE_TOGGLE_MAP[id]) {
                // Field (password/passcode) -> its Eye Toggle
                const eyeEl = document.getElementById(EYE_TOGGLE_MAP[id]);
                if (eyeEl) eyeEl.focus();
                break;
            }
            if (isOnEyeToggle) {
                // Already on the Eye Toggle — continue right to the side tabs, like any other left element
                if (rightElements.length > 0) {
                    const firstRight = document.getElementById(rightElements[0]);
                    if (firstRight) firstRight.focus();
                }
                break;
            }
            // If on any left-side element, move to the first right-side button
            if (currentIdx < leftCount && rightElements.length > 0) {
                const firstRight = document.getElementById(rightElements[0]);
                if (firstRight) firstRight.focus();
            }
            break;

        case 40: // DOWN
            e.preventDefault();
            if (isOnEyeToggle) {
                // Eye Toggle -> whatever comes after its field, NOT re-entering the toggle
                const sourceField = EYE_TOGGLE_SOURCE_MAP[id];
                const sourceIdx = leftElements.indexOf(sourceField);
                if (sourceIdx >= 0 && sourceIdx < leftElements.length - 1) {
                    const nextEl = document.getElementById(leftElements[sourceIdx + 1]);
                    if (nextEl) nextEl.focus();
                }
                break;
            }
            if (currentIdx < allElements.length - 1) {
                const nextEl = document.getElementById(allElements[currentIdx + 1]);
                if (nextEl) nextEl.focus();
            }
            break;

        case 13: // ENTER / OK
            e.preventDefault();
            if (id === 'signinbutton') {
                showLoader();
                login();
            } else if (id === 'passcode-login-btn') {
                showLoader();
                loginWithPasscode();
            } else if (id === 'eye-toggle') {
                togglePasswordVisibility();
            } else if (id === 'passcode-eye-toggle') {
                togglePasscodeVisibility();
            } else if (id === 'tab-btn-passcode' || id === 'tab-btn-qr') {
                const btn = document.getElementById(id);
                if (btn) {
                    const tabId = btn.getAttribute('data-tab');
                    if (tabId) switchTab(tabId);
                }
            } else if (id === 'qr-refresh-btn') {
                refreshQRCode();
            } else if (id === 'forgot-password-link') {
                showForgotPasswordScreen();
            } else if (id === 'fp-back-btn') {
                hideForgotPasswordScreen();
            } else if (id === 'fp-submit-btn') {
                showLoader();
                forgotPassword();
            } else if (isInputFieldId(id)) {
                // OK on a focused input field opens the keypad for editing.
                openKeypadFor(id);
            }
            break;

        case 10009: // BACK
        case 10182: // EXIT
            e.preventDefault();
            if (_activeTab === 'forgot') {
                hideForgotPasswordScreen();
            } else {
                openExitPopup();
            }
            break;

        default:
            break;
    }
}

// =============================================================================
// ─── INIT ──────────────────────────────────────────────────────────────────
// =============================================================================

function init() {
    "use strict";

    // Kick off zipcode detection early
    if (typeof GeoLocation !== 'undefined' && GeoLocation.getZipCode) {
        GeoLocation.getZipCode(function () { });
    }

    // Keypad safety net: make sure every input starts readonly (so focusing
    // it via remote nav never auto-opens the on-screen keypad), and keep
    // our keypad state in sync if a field loses focus some other way.
    for (let i = 0; i < INPUT_FIELD_IDS.length; i++) {
        const fieldId = INPUT_FIELD_IDS[i];
        const fieldEl = document.getElementById(fieldId);
        if (!fieldEl) continue;
        fieldEl.setAttribute('readonly', 'readonly');
        fieldEl.addEventListener('blur', function () {
            if (_keypadTargetId === fieldId) {
                closeKeypad();
            }
        });
    }

    try {
        tizen.tvinputdevice.registerKey("Exit");
    } catch (e) {
        console.warn("Could not register Exit key:", e);
    }

    // ── Email form ──
    document.getElementById("signinbutton").addEventListener("click", function () {
        showLoader();
        login();
    });
    const eyeToggle = document.getElementById("eye-toggle");
    if (eyeToggle) {
        eyeToggle.addEventListener("click", togglePasswordVisibility);
    }

    // ── Passcode form ──
    document.getElementById("passcode-login-btn").addEventListener("click", function () {
        showLoader();
        loginWithPasscode();
    });
    const passcodeEye = document.getElementById("passcode-eye-toggle");
    if (passcodeEye) {
        passcodeEye.addEventListener("click", togglePasscodeVisibility);
    }

    // ── QR ── Refresh QR Code button (only visible once the code has expired)
    const qrRefreshBtn = document.getElementById("qr-refresh-btn");
    if (qrRefreshBtn) {
        qrRefreshBtn.addEventListener("click", refreshQRCode);
    }

    // ── Forgot Password ──
    const forgotLink = document.getElementById("forgot-password-link");
    if (forgotLink) {
        forgotLink.addEventListener("click", function (e) {
            e.preventDefault();
            showForgotPasswordScreen();
        });
    }
    const fpBackBtn = document.getElementById("fp-back-btn");
    if (fpBackBtn) {
        fpBackBtn.addEventListener("click", hideForgotPasswordScreen);
    }
    const fpSubmitBtn = document.getElementById("fp-submit-btn");
    if (fpSubmitBtn) {
        fpSubmitBtn.addEventListener("click", function () {
            showLoader();
            forgotPassword();
        });
    }

    // ── Right-side tab buttons ──
    document.getElementById("tab-btn-passcode").addEventListener("click", function () {
        const tabId = this.getAttribute('data-tab');
        if (tabId) switchTab(tabId);
    });
    document.getElementById("tab-btn-qr").addEventListener("click", function () {
        const tabId = this.getAttribute('data-tab');
        if (tabId) switchTab(tabId);
    });

    // ── Initialize side tabs ──
    updateSideTabs('email');

    // ── Keyboard ──
    document.addEventListener("keydown", handleKeyDown);

    // Focus the email input
    document.getElementById("username").focus();
}

window.onload = init;