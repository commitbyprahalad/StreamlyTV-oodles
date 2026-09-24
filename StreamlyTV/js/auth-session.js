/**
 * AuthSession — Shared Session & Subscription Expiry Handler for StreamlyTV
 * Handles response_code 401 (session expired) and 410 (subscription expired)
 * across all pages. Include this script on every page that makes API calls.
 */
const AuthSession = (function () {
    'use strict';

    let _addToRecentInProgress = false;
    let _addToRecentLastCall = 0;

    // ─── Session Expired (401) ───────────────────────────────────────────
    function handleSessionExpired() {
        localStorage.setItem('session_expire', 'session_expire');
        PopupManager.session(function () {
            localStorage.clear();
            window.location.href = '../guide/guide.html';
        });
    }

    // ─── Subscription Expired (410) ──────────────────────────────────────
    function handleSubscriptionExpired(message) {
        const msg = message || 'Your subscription has expired. Please visit https://streamlytv.com to update your plan.';
        PopupManager.showAlert(msg, function () {
            localStorage.clear();
            window.location.href = '../guide/guide.html';
        });
    }

    // ─── Check API JSON response for auth errors ─────────────────────────
    // Returns true if an auth error was handled, false otherwise.
    function checkApiResponse(data) {
        if (!data) return false;

        if (data.response_code === 401) {
            handleSessionExpired();
            return true;
        }
        if (data.response_code === 410) {
            handleSubscriptionExpired(data.subscribedmsgis || data.message);
            return true;
        }
        return false;
    }

    // ─── Add-To-Recent session check ────────────────────────────────────
    // Lightweight fire-and-forget validation that calls the addtorecent API
    // and only checks for 401 (session expired) and 410 (subscription expired).
    // All other response codes are ignored.
    //
    // Includes a 2-second throttle to prevent excessive calls during rapid
    // EPG navigation.  Call this on every focus change (channel/program) and
    // before playing a channel.
    //
    // Usage:
    //   AuthSession.addToRecentCheck()
    //   AuthSession.addToRecentCheck(function(result) { ... })
    //     result: 'expired' | 'valid' | null
    function addToRecentCheck(callback) {
        const token = localStorage.getItem('jwt token');
        if (!token) {
            if (callback) callback(null);
            return;
        }

        // Throttle: skip if a request is in flight or was made < 2s ago
        const now = Date.now();
        if (_addToRecentInProgress || (now - _addToRecentLastCall < 2000)) {
            if (callback) callback(null);
            return;
        }

        _addToRecentInProgress = true;
        _addToRecentLastCall = now;

        const zipcode = localStorage.getItem('streamly_zipcode') || '302020';
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API.ADD_TO_RECENT, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.timeout = 10000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                _addToRecentInProgress = false;
                // Check both 200 and 410 statuses — the API returns HTTP 410
                // when subscription is expired (response_code: 410).
                if (xhr.status === 200 || xhr.status === 410 || xhr.status === 401) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.response_code === 401) {
                            handleSessionExpired();
                            if (callback) callback('expired');
                            return;
                        }
                        if (data.response_code === 410) {
                            handleSubscriptionExpired(data.subscribedmsgis || data.message);
                            if (callback) callback('expired');
                            return;
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
                // Any other status or response without 401/410,
                // is silently ignored per requirements.
                if (callback) callback('valid');
            }
        };

        xhr.onerror = function () {
            _addToRecentInProgress = false;
            if (callback) callback(null);
        };
        xhr.ontimeout = function () {
            _addToRecentInProgress = false;
            if (callback) callback(null);
        };

        try {
            xhr.send(JSON.stringify({ channelids: 1, zipcode: zipcode }));
        } catch (e) {
            _addToRecentInProgress = false;
            if (callback) callback(null);
        }
    }

    return {
        handleSessionExpired: handleSessionExpired,
        handleSubscriptionExpired: handleSubscriptionExpired,
        checkApiResponse: checkApiResponse,
        addToRecentCheck: addToRecentCheck
    };
})();