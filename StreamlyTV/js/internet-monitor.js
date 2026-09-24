/**
 * Internet Connection Monitor
 * Uses PopupManager for the no-internet popup
 */

(function () {
    'use strict';

    const InternetMonitor = {
        CHECK_INTERVAL: 10000,
        CHECK_INTERVAL_OFFLINE: 3000,
        TIMEOUT: 5000,
        FAILURE_THRESHOLD: 2,

        isOnline: true,
        consecutiveFailures: 0,
        checkTimer: null,
        _popupShown: false,

        init: function () {
            this.setupBrowserEvents();
            this.startMonitoring();
        },

        setupBrowserEvents: function () {
            const self = this;
            window.addEventListener('offline', function () { self.handleOffline(); });
            window.addEventListener('online', function () { self.handleOnline(); });
        },

        startMonitoring: function () {
            const self = this;
            this.checkConnection();
            this.checkTimer = setInterval(function () {
                self.checkConnection();
            }, this.isOnline ? this.CHECK_INTERVAL : this.CHECK_INTERVAL_OFFLINE);
        },

        checkConnection: function () {
            const self = this;
            const endpoints = [
                'https://www.google.com/favicon.ico',
                'https://www.cloudflare.com/favicon.ico',
                'https://www.gstatic.com/generate_204'
            ];
            const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

            const xhr = new XMLHttpRequest();
            xhr.open('HEAD', endpoint + '?_=' + Date.now(), true);
            xhr.timeout = this.TIMEOUT;

            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        self.consecutiveFailures = 0;
                        self.handleOnline();
                    } else {
                        self.handleFailure();
                    }
                }
            };

            xhr.onerror = function () { self.handleFailure(); };
            xhr.ontimeout = function () { self.handleFailure(); };

            try { xhr.send(); } catch (e) { self.handleFailure(); }
        },

        handleFailure: function () {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
                this.handleOffline();
            }
        },

        handleOffline: function () {
            if (this._popupShown) return;
            this.isOnline = false;

            this._popupShown = true;
            const self = this;
            PopupManager.noInternet(function () {
                self._popupShown = false;
                self.checkConnection();
            });

            clearInterval(this.checkTimer);
            this.checkTimer = setInterval(function () {
                self.checkConnection();
            }, this.CHECK_INTERVAL_OFFLINE);
        },

        handleOnline: function () {
            if (this._popupShown) {
                // PopupManager handles hiding — just mark as not shown
                // The PopupManager.hide() isn't called; on the next check
                // interval, if we're back online, the popup won't show.
                // If the user presses RETRY and we're online, it goes away.
            }
            this.isOnline = true;
            this.consecutiveFailures = 0;
            this._popupShown = false;

            clearInterval(this.checkTimer);
            const self = this;
            this.checkTimer = setInterval(function () {
                self.checkConnection();
            }, this.CHECK_INTERVAL);
        }
    };

    function initMonitor() {
        InternetMonitor.init();
    }

    if (document.readyState === 'loading') {
        if (document.addEventListener) {
            document.addEventListener('DOMContentLoaded', initMonitor);
        } else if (document.attachEvent) {
            document.attachEvent('onreadystatechange', function () {
                if (document.readyState === 'complete') initMonitor();
            });
        }
    } else {
        initMonitor();
    }

    window.InternetMonitor = InternetMonitor;
})();