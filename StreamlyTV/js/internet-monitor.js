/**
 * Internet Connection Monitor
 * Uses PopupManager for the no-internet popup
 *
 * Why the popup used to show while the TV was online:
 *  - The check was an XHR to google.com / cloudflare.com / gstatic.com. None
 *    of them send CORS headers, so from the app every one of those requests
 *    "failed" (status 0) even with a working connection.
 *  - A failed XHR fires both readystatechange (status 0) and onerror, so one
 *    failed check counted twice and hit the 2-failure threshold by itself.
 *
 * Why it then showed on a weak connection:
 *  - The OS 'offline' event (and navigator.onLine false) opened the popup at
 *    once, but Tizen fires it on short Wi-Fi drops that recover by themselves.
 *  - 2 failed probes 3s apart were enough, so a few slow seconds tripped it.
 *  - The two probe images were tried one after the other, so a slow first
 *    host used up the time before the second was even asked.
 *
 * Now:
 *  - The probe loads a small image (images need no CORS) from Google and from
 *    StreamlyTV at the same time; the first one to load means online. Only
 *    when both fail or time out does a probe fail.
 *  - The popup shows only when the connection has stayed down: at least
 *    FAILURE_THRESHOLD failed probes in a row AND failures for OFFLINE_GRACE
 *    since the first one. Any successful probe in between resets both.
 *  - The OS 'offline' event / navigator.onLine false count as a failed probe
 *    and start the confirmation early; they no longer open the popup.
 *  - Once the connection is confirmed down, Retry re-checks and the popup
 *    comes back straight away if it still fails (no second grace period).
 *  - The popup closes by itself as soon as a probe succeeds again.
 *  - No probes while the app is in the background.
 */

(function () {
    'use strict';

    const InternetMonitor = {
        CHECK_INTERVAL: 30000,         // online: a light probe every 30s
        CHECK_INTERVAL_SUSPECT: 5000,  // a probe failed: confirm every 5s
        CHECK_INTERVAL_OFFLINE: 3000,  // offline: notice the connection is back quickly
        TIMEOUT: 10000,                // weak Wi-Fi and stream start-up make images slow
        FAILURE_THRESHOLD: 3,          // failed probes in a row...
        OFFLINE_GRACE: 20000,          // ...over at least this long before the popup
        PROBE_URLS: [
            'https://www.google.com/favicon.ico',
            'https://streamlytv.com/favicon.ico'
        ],

        isOnline: true,                // false once the connection is confirmed down
        consecutiveFailures: 0,
        _failingSince: 0,              // time of the first failure in the current run
        checkTimer: null,
        _checking: false,
        _popupShown: false,

        init: function () {
            this.setupBrowserEvents();
            this.checkConnection();
            this.schedule(this.CHECK_INTERVAL);
        },

        setupBrowserEvents: function () {
            const self = this;
            // The OS says the network is gone: confirm it instead of trusting
            // it, short drops on a weak network come back within seconds
            window.addEventListener('offline', function () { self.checkConnection(); });
            window.addEventListener('online', function () { self.checkConnection(); });
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) self.checkConnection();
            });
        },

        schedule: function (interval) {
            const self = this;
            clearInterval(this.checkTimer);
            this.checkTimer = setInterval(function () {
                self.checkConnection();
            }, interval);
        },

        // Load one image; done(true) if it loaded within TIMEOUT
        probe: function (url, done) {
            const img = new Image();
            let finished = false;
            const timer = setTimeout(function () { finish(false); }, this.TIMEOUT);
            function finish(ok) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                img.onload = img.onerror = null;
                done(ok);
            }
            img.onload = function () { finish(true); };
            img.onerror = function () { finish(false); };
            img.src = url + '?_=' + Date.now(); // never answered from cache
        },

        checkConnection: function () {
            if (this._checking || document.hidden) return;
            if (navigator.onLine === false) {
                this.handleFailure();
                return;
            }
            const self = this;
            const urls = this.PROBE_URLS;
            let pending = urls.length;
            let settled = false;
            this._checking = true;
            // All hosts at once: the first that loads settles the check
            for (let i = 0; i < urls.length; i++) {
                this.probe(urls[i], function (ok) {
                    if (settled) return;
                    pending--;
                    if (ok) {
                        settled = true;
                        self._checking = false;
                        self.handleOnline();
                    } else if (pending === 0) {
                        settled = true;
                        self._checking = false;
                        self.handleFailure();
                    }
                });
            }
        },

        handleFailure: function () {
            const now = Date.now();
            if (!this._failingSince) this._failingSince = now;
            this.consecutiveFailures++;

            // Already confirmed down (e.g. Retry pressed while still offline)
            if (!this.isOnline) {
                this.handleOffline();
                return;
            }
            if (this.consecutiveFailures >= this.FAILURE_THRESHOLD &&
                now - this._failingSince >= this.OFFLINE_GRACE) {
                this.handleOffline();
            } else {
                // Probably a short drop: keep checking until it either
                // recovers or has lasted long enough to count as offline
                this.schedule(this.CHECK_INTERVAL_SUSPECT);
            }
        },

        handleOffline: function () {
            this.isOnline = false;
            this.schedule(this.CHECK_INTERVAL_OFFLINE);
            if (this._popupShown) return;

            this._popupShown = true;
            const self = this;
            PopupManager.noInternet(function () {
                // Retry pressed: the popup is closed; it comes back at once
                // if the connection is still down.
                self._popupShown = false;
                self.checkConnection();
            });
        },

        handleOnline: function () {
            const wasOffline = !this.isOnline || this.consecutiveFailures > 0;
            this.isOnline = true;
            this.consecutiveFailures = 0;
            this._failingSince = 0;
            if (this._popupShown) {
                this._popupShown = false;
                PopupManager.dismiss('nointernet');
            }
            if (wasOffline) this.schedule(this.CHECK_INTERVAL);
        }
    };

    function initMonitor() {
        InternetMonitor.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMonitor);
    } else {
        initMonitor();
    }

    window.InternetMonitor = InternetMonitor;
})();
