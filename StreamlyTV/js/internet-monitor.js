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
 * Now:
 *  - The probe loads a small image (images need no CORS): Google's favicon,
 *    and if that fails StreamlyTV's own, so one blocked or slow site can't
 *    make the app look offline. Only when both fail does a probe fail.
 *  - Offline = 2 failed probes in a row (each counted once), or the OS
 *    reporting the network as down (window 'offline').
 *  - The popup closes by itself as soon as a probe succeeds again.
 *  - No probes while the app is in the background.
 */

(function () {
    'use strict';

    const InternetMonitor = {
        CHECK_INTERVAL: 30000,         // online: a light probe every 30s
        CHECK_INTERVAL_OFFLINE: 3000,  // offline: notice the connection is back quickly
        TIMEOUT: 8000,                 // TVs can be slow while a stream starts
        FAILURE_THRESHOLD: 2,
        PROBE_URLS: [
            'https://www.google.com/favicon.ico',
            'https://streamlytv.com/favicon.ico'
        ],

        isOnline: true,
        consecutiveFailures: 0,
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
            // The OS says the network is gone: no need to probe
            window.addEventListener('offline', function () { self.handleOffline(); });
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
                this.handleOffline();
                return;
            }
            const self = this;
            const urls = this.PROBE_URLS;
            let i = 0;
            this._checking = true;
            function next() {
                if (i >= urls.length) {
                    self._checking = false;
                    self.handleFailure();
                    return;
                }
                self.probe(urls[i++], function (ok) {
                    if (ok) {
                        self._checking = false;
                        self.handleOnline();
                    } else {
                        next();
                    }
                });
            }
            next();
        },

        handleFailure: function () {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
                this.handleOffline();
            } else {
                // Confirm quickly instead of waiting a full interval
                this.schedule(this.CHECK_INTERVAL_OFFLINE);
            }
        },

        handleOffline: function () {
            this.isOnline = false;
            this.schedule(this.CHECK_INTERVAL_OFFLINE);
            if (this._popupShown) return;

            this._popupShown = true;
            const self = this;
            PopupManager.noInternet(function () {
                // Retry pressed: the popup is closed; it comes back if the
                // next probes still fail.
                self._popupShown = false;
                self.consecutiveFailures = 0;
                self.checkConnection();
            });
        },

        handleOnline: function () {
            const wasOffline = !this.isOnline || this.consecutiveFailures > 0;
            this.isOnline = true;
            this.consecutiveFailures = 0;
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
