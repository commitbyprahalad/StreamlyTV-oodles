/**
 * Modern EPG Video Player - COMPLETE FIXED VERSION
 * Handles video playback with DRM support
 *
 * FIXES:
 * - Correct HTML element IDs matching epg.html
 * - Proper DRM initialization BEFORE player init
 * - Full player destroy/recreate between streams
 * - Bridge: window.PlayerModule exposed for legacy auto-play script
 * - Channel direct play + Program modal play both work
 * - Session heartbeat + inactivity check while player is active
 *
 * ENGINES:
 * - Samsung AVPlay (webapis.avplay) is the primary engine: native hardware
 *   pipeline, faster start and smoother channel changes than MSE/dash.js.
 * - dash.js on <video> is the fallback. If AVPlay can't start a stream
 *   (open/prepare/DRM error or no start within AVPLAY_START_TIMEOUT), the
 *   same stream is retried with dash.js and AVPlay is skipped for the rest
 *   of the app session. dash.js is only downloaded when that happens.
 *   Set AVPLAY_ENABLED to false to go back to dash.js only.
 */

EPG.player = {
    AVPLAY_ENABLED: true,
    AVPLAY_START_TIMEOUT: 12000,
    AVPLAY_UNAVAILABLE_KEY: 'avplay_unavailable', // sessionStorage

    engine: null,             // 'avplay' | 'dash' — engine of the current stream
    avObject: null,           // <object type="application/avplayer">
    _loadToken: 0,            // bumped per stream so late callbacks are ignored
    dashPlayer: null,
    videoElement: null,
    modal: null,
    spinner: null,
    error: null,
    controls: null,
    nowPlayingOverlay: null,
    isActive: false,
    bufferingTimeout: null,
    _sessionTimer: null,      // periodic session heartbeat
    _inactivityTimer: null,   // inactivity check
    _lastActivity: null,      // timestamp of last user interaction
    // Channel list overlay state
    chList: {
        visible: false,
        focusedIndex: 0,       // index in EPG.state.channels[]
        activeIndex: 0,        // currently playing channel index
        autoHideTimer: null,
        cachedChannelCount: -1 // -1 = cache invalid, triggers full rebuild
    },

    // Initialize player
    init: function () {
        // IDs must match what's in epg.html exactly
        this.videoElement = document.getElementById('video-player');
        this.modal = document.getElementById('player-modal');
        this.spinner = document.getElementById('player-spinner');
        this.error = document.getElementById('player-error');
        this.controls = document.getElementById('player-controls');
        this.nowPlayingOverlay = document.getElementById('now-playing-overlay');
        this.avObject = document.getElementById('av-player');

        console.log('[PLAYER] init — videoElement:', !!this.videoElement, 'avplay:', this.canUseAVPlay(), 'modal:', !!this.modal, 'spinner:', !!this.spinner, 'error:', !!this.error);

        this.dashPlayer = null;
        this.setupEventListeners();
        this.setupAppLifecycle();

        // ✅ Bridge for legacy auto-play script that uses window.PlayerModule
        window.PlayerModule = {
            openPlayer: function (streamUrl, drmData, widevineLicense) {
                EPG.player.open(streamUrl, drmData, widevineLicense);
            },
            closePlayer: function () {
                EPG.player.close();
            },
            isActive: function () {
                return EPG.player.isActive;
            }
        };

        // console.log('EPG Player ready (+ window.PlayerModule bridge)');
    },

    // Setup static event listeners
    setupEventListeners: function () {
        const self = this;

        const retryBtn = document.getElementById('player-retry');
        if (retryBtn) {
            if (retryBtn.addEventListener) {
                retryBtn.addEventListener('click', function () {
                    self.retry();
                });
            } else if (retryBtn.attachEvent) {
                retryBtn.attachEvent('onclick', function () {
                    self.retry();
                });
            }
        }

        // console.log('✅ Player event listeners attached');
    },

    // AVPlay must be suspended when the app goes to the background (Home,
    // source switch, multitasking) and restored when it comes back; the page
    // leaving must release the native player.
    setupAppLifecycle: function () {
        const self = this;
        document.addEventListener('visibilitychange', function () {
            if (self.engine !== 'avplay' || !self.isActive) return;
            try {
                if (document.hidden) {
                    webapis.avplay.suspend();
                } else {
                    webapis.avplay.restore();
                }
            } catch (e) {
                console.warn('[PLAYER] AVPlay suspend/restore failed:', e);
            }
        });
        window.addEventListener('pagehide', function () {
            self.destroyPlayer();
        });
    },

    /**
     * Open player with a stream URL.
     * Called from:
     *   - EPG.focus.handleEnter() when context === 'CHANNEL' (direct play)
     *   - Modal "Play Now" button click (play live programme)
     *   - Auto-play script via window.PlayerModule.openPlayer()
     */
    open: function (streamUrl, drmData, widevineLicense) {
        console.log('[PLAYER] open() called');
        console.log('[PLAYER]   streamUrl:', streamUrl ? streamUrl.substring(0, 80) + '...' : 'null');
        console.log('[PLAYER]   drmData:', drmData ? drmData.substring(0, 40) + '...' : 'null');
        console.log('[PLAYER]   widevineLicense:', widevineLicense ? widevineLicense.substring(0, 40) + '...' : 'null');

        // ── Check session validity before attempting playback ─────────────
        // If JWT token was cleared (by session-expired popup or logout),
        // show session expired popup immediately instead of opening player.
        if (!localStorage.getItem('jwt token')) {
            console.warn('[PLAYER] No JWT token — session expired, blocking playback');
            if (typeof showSessionExpirePopup === 'function') {
                showSessionExpirePopup();
            }
            return;
        }

        if (!streamUrl) {
            console.error('[PLAYER] open() called with no streamUrl');
            return;
        }

        // Always read the freshest DRM values from localStorage as fallback
        const freshDrmData = drmData || localStorage.getItem('drmData');
        const freshWidevineLicense = widevineLicense || localStorage.getItem('widevinelicense');

        // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        // console.log('🎬 Opening player');
        // console.log('   URL:', streamUrl);
        // console.log('   DRM Data:', freshDrmData ? 'Present (' + freshDrmData.length + ' chars)' : 'Missing');
        // console.log('   Widevine License:', freshWidevineLicense || 'Missing');
        // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Persist to localStorage so retry works
        localStorage.setItem('channelUrl', streamUrl);
        // Track which channel index is now playing (match by URL)
        const channels = EPG.state ? EPG.state.channels : [];
        for (let ci = 0; ci < channels.length; ci++) {
            if (channels[ci].url === streamUrl) {
                this.chList.activeIndex = ci;
                this.chList.focusedIndex = ci;
                break;
            }
        }
        if (freshDrmData) localStorage.setItem('drmData', freshDrmData);
        if (freshWidevineLicense) localStorage.setItem('widevinelicense', freshWidevineLicense);

        // Pre-build channel list overlay HTML immediately so it's ready
        // when user presses LEFT/RIGHT. Must run BEFORE destroyPlayer() and
        // dash.js initialization to avoid the main thread being blocked.
        this.preBuildChannelList();

        // Show modal
        if (this.modal) {
            this.modal.className = 'player-modal'; // removes 'hidden'
        }

        this.isActive = true;
        this.showSpinner();
        this.hideError();
        this.hideControls();

        // Destroy any existing player instance cleanly
        this.destroyPlayer();

        // Start periodic session + inactivity monitoring
        this._startSessionCheck();

        // Short yield so the modal/spinner can paint before dash.js setup
        const self = this;
        setTimeout(function () {
            self.loadStream(streamUrl, freshDrmData, freshWidevineLicense);
        }, 30);
    },

    // Start playback immediately and run the addtorecent session check in
    // parallel, instead of waiting a full API round trip before the stream
    // starts. If the session turns out to be expired, AuthSession shows its
    // popup and the player is closed.
    openChecked: function (streamUrl, drmData, widevineLicense) {
        const self = this;
        this.open(streamUrl, drmData, widevineLicense);
        if (typeof AuthSession !== 'undefined' && AuthSession.addToRecentCheck) {
            AuthSession.addToRecentCheck(function (result) {
                if (result === 'expired' && self.isActive) self.close();
            });
        }
    },

    // Properly destroy previous player instance
    destroyPlayer: function () {
        this._loadToken++; // late AVPlay / license callbacks of the old stream are ignored
        this.stopAVPlay();
        this.setAVPlayMode(false);
        this.engine = null;

        if (this.dashPlayer) {
            try {
                this.dashPlayer.pause();
                this.dashPlayer.reset();
                this.dashPlayer = null;
                //console.log('✅ Old player destroyed');
            } catch (e) {
                //console.warn('⚠️ Error destroying player:', e);
                this.dashPlayer = null;
            }
        }

        // Clear video src to release resources
        if (this.videoElement) {
            this.videoElement.src = '';
            try { this.videoElement.load(); } catch (e) { /* ignore */ }
        }

        clearTimeout(this.bufferingTimeout);
    },

    // Load a stream with AVPlay, or dash.js when AVPlay isn't usable.
    loadStream: function (streamUrl, drmData, widevineLicense) {
        if (this.canUseAVPlay()) {
            this.loadAVPlay(streamUrl, drmData, widevineLicense);
        } else {
            this.loadDashStream(streamUrl, drmData, widevineLicense);
        }
    },

    // ── AVPlay engine ──────────────────────────────────────────────────────

    canUseAVPlay: function () {
        if (!this.AVPLAY_ENABLED || !this.avObject) return false;
        try {
            if (sessionStorage.getItem(this.AVPLAY_UNAVAILABLE_KEY) === '1') return false;
        } catch (e) { /* storage unavailable: just try AVPlay */ }
        return typeof webapis !== 'undefined' && !!webapis.avplay;
    },

    // AVPlay draws on the TV's video plane *under* the web page, so while it
    // plays everything behind the overlays must be transparent: the player
    // modal, the page background and the EPG (hidden, not removed, so its
    // scroll/focus state is kept for when the player closes).
    setAVPlayMode: function (on) {
        const root = document.documentElement;
        if (root && root.classList) root.classList.toggle('avplay-mode', on);
    },

    stopAVPlay: function () {
        if (this.engine !== 'avplay') return;
        try {
            const state = webapis.avplay.getState();
            if (state !== 'NONE' && state !== 'IDLE') webapis.avplay.stop();
            webapis.avplay.close();
        } catch (e) {
            console.warn('[PLAYER] AVPlay stop/close failed:', e);
        }
    },

    loadAVPlay: function (streamUrl, drmData, widevineLicense) {
        const self = this;
        const av = webapis.avplay;
        const token = this._loadToken;
        let started = false;
        let fellBack = false;

        this.engine = 'avplay';
        this.setAVPlayMode(true);
        console.log('[PLAYER] loadAVPlay() — starting');

        function stale() {
            return !self.isActive || token !== self._loadToken;
        }

        // Couldn't start with AVPlay: replay the same stream with dash.js
        // and stay on dash.js for the rest of this app session.
        function fallBackToDash(reason) {
            if (stale() || fellBack) return;
            fellBack = true; // late AVPlay events after stop() must not start dash.js twice
            console.warn('[PLAYER] AVPlay could not start (' + reason + ') — falling back to dash.js');
            try { sessionStorage.setItem(self.AVPLAY_UNAVAILABLE_KEY, '1'); } catch (e) { /* not persisted */ }
            clearTimeout(self.bufferingTimeout);
            self.stopAVPlay();
            self.setAVPlayMode(false);
            self.engine = null;
            self.loadDashStream(streamUrl, drmData, widevineLicense);
        }

        // Before the first frame, any failure falls back to dash.js; once the
        // stream is playing, failures are stream problems -> Retry screen.
        function fail(reason) {
            if (stale()) return;
            if (started) {
                console.error('[PLAYER] AVPlay error while playing:', reason);
                self.showError();
            } else {
                fallBackToDash(reason);
            }
        }

        try {
            av.open(streamUrl);
            av.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
            av.setListener({
                onbufferingstart: function () {
                    if (stale() || !started) return;
                    self.showSpinner();
                    clearTimeout(self.bufferingTimeout);
                    self.bufferingTimeout = setTimeout(function () {
                        if (!stale()) self.showError();
                    }, 30000);
                },
                onbufferingcomplete: function () {
                    if (stale() || !started) return;
                    clearTimeout(self.bufferingTimeout);
                    self.hideSpinner();
                },
                onstreamcompleted: function () {
                    fail('stream completed');
                },
                onerror: function (eventType) {
                    fail('onerror ' + eventType);
                },
                ondrmevent: function (drmEvent, drmInfo) {
                    self.onAVPlayDrmEvent(drmInfo, token, fail);
                },
                onevent: function (eventType, eventData) {
                    console.log('[PLAYER] AVPlay event:', eventType, eventData);
                }
            });
            if (drmData && widevineLicense) {
                this._drm = { licenseUrl: widevineLicense, customData: drmData };
                av.setDrm('WIDEVINE_CDM', 'SetProperties', JSON.stringify({
                    AppSession: 'streamly-' + Date.now(),
                    DataType: 'MPEG-DASH'
                }));
            } else {
                this._drm = null;
            }
        } catch (e) {
            fail('open: ' + (e && (e.name || e.message)));
            return;
        }

        clearTimeout(this.bufferingTimeout);
        this.bufferingTimeout = setTimeout(function () {
            fail('no start within ' + self.AVPLAY_START_TIMEOUT + 'ms');
        }, this.AVPLAY_START_TIMEOUT);

        av.prepareAsync(function () {
            if (stale()) return;
            try {
                av.play();
            } catch (e) {
                fail('play: ' + (e && (e.name || e.message)));
                return;
            }
            started = true;
            clearTimeout(self.bufferingTimeout);
            self.hideSpinner();
            self.hideError();
            console.log('[PLAYER] AVPlay playing');
        }, function (err) {
            fail('prepare: ' + (err && (err.name || err.message)));
        });
    },

    // Widevine with AVPlay: the player hands us the licence challenge and we
    // POST it ourselves, with the same `customdata` header dash.js sends.
    onAVPlayDrmEvent: function (drmInfo, token, fail) {
        const self = this;
        if (!drmInfo || token !== this._loadToken) return;

        if (drmInfo.name === 'DrmError') {
            fail('DRM error ' + (drmInfo.code || drmInfo.message || ''));
            return;
        }
        if (drmInfo.name !== 'Challenge' || !this._drm) return;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', this._drm.licenseUrl, true);
        xhr.responseType = 'arraybuffer';
        xhr.setRequestHeader('customdata', this._drm.customData);
        xhr.timeout = 10000;
        xhr.onload = function () {
            if (token !== self._loadToken) return;
            if (xhr.status !== 200 || !xhr.response) {
                fail('licence HTTP ' + xhr.status);
                return;
            }
            try {
                webapis.avplay.setDrm('WIDEVINE_CDM', 'widevine_license_data', self._arrayBufferToBase64(xhr.response));
            } catch (e) {
                fail('licence apply: ' + (e && (e.name || e.message)));
            }
        };
        xhr.onerror = function () { fail('licence network error'); };
        xhr.ontimeout = function () { fail('licence timeout'); };
        try {
            xhr.send(this._base64ToBytes(drmInfo.challenge));
        } catch (e) {
            fail('licence request: ' + (e && e.message));
        }
    },

    _base64ToBytes: function (b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    },

    _arrayBufferToBase64: function (buffer) {
        const bytes = new Uint8Array(buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    },

    // ── dash.js engine (fallback) ──────────────────────────────────────────

    // dash.js is ~700KB, so it is only fetched the first time it's needed.
    _ensureDashScript: function () {
        if (typeof dashjs !== 'undefined' || this._dashScriptRequested) return;
        this._dashScriptRequested = true;
        const script = document.createElement('script');
        script.src = '../js/dash.min.js';
        script.async = true;
        document.body.appendChild(script);
    },

    // Create a fresh dash.js instance and load the stream
    loadDashStream: function (streamUrl, drmData, widevineLicense) {
        console.log('[PLAYER] loadDashStream() — starting');
        this.engine = 'dash';
        this._ensureDashScript();

        if (!this.videoElement) {
            console.error('[PLAYER] FAIL: videoElement not found');
            //this.showError();
            return;
        }
        console.log('[PLAYER]   videoElement OK');

        if (typeof dashjs === 'undefined' || !dashjs.MediaPlayer) {
            // dash.js loads async; if play is pressed before it has
            // finished, wait for it (up to ~5s) instead of failing.
            this._dashWaitCount = (this._dashWaitCount || 0) + 1;
            if (this._dashWaitCount <= 25) {
                const self = this;
                clearTimeout(this._dashWaitTimer);
                this._dashWaitTimer = setTimeout(function () {
                    if (self.isActive && self.engine === 'dash' && localStorage.getItem('channelUrl') === streamUrl) {
                        self.loadDashStream(streamUrl, drmData, widevineLicense);
                    }
                }, 200);
                return;
            }
            this._dashWaitCount = 0;
            console.error('[PLAYER] FAIL: dash.js not loaded');
            //this.showError();
            return;
        }
        this._dashWaitCount = 0;
        console.log('[PLAYER]   dash.js loaded OK');

        // Create fresh player
        try {
            this.dashPlayer = dashjs.MediaPlayer().create();
            console.log('[PLAYER]   dash.js player created');
        } catch (e) {
            console.error('[PLAYER] FAIL: create dash.js player:', e);
            //this.showError();
            return;
        }

        // Setup playback event listeners
        this.setupDashEvents();

        //CRITICAL: Set DRM BEFORE calling initialize()
        if (drmData && widevineLicense) {
            console.log('[PLAYER]   Configuring DRM...');
            try {
                this.dashPlayer.setProtectionData({
                    'com.widevine.alpha': {
                        serverURL: widevineLicense,
                        httpRequestHeaders: { 'customdata': drmData },
                        robustnessLevel: 'SW_SECURE_CRYPTO'
                    },
                    'com.microsoft.playready': {
                        serverURL: localStorage.getItem('playreadylicense') || widevineLicense,
                        httpRequestHeaders: { 'customdata': drmData }
                    }
                });
                console.log('[PLAYER]   DRM protection configured');
            } catch (e) {
                console.error('[PLAYER]   DRM setup failed:', e);
            }
        } else {
            console.log('[PLAYER]   No DRM data - no protection');
        }

        // Set buffering timeout before initialize
        const self = this;
        this.bufferingTimeout = setTimeout(function () {
            console.log('[PLAYER]   Buffering timeout (30s) - showing error');
            self.showError();
        }, 30000);

        // Initialize player - this starts playback
        try {
            // Ensure muted for browser autoplay policy
            this.videoElement.muted = true;
            console.log('[PLAYER]   Calling dashPlayer.initialize()...');
            this.dashPlayer.initialize(this.videoElement, streamUrl, true);
            console.log('[PLAYER]   dashPlayer.initialize() OK');

            // Explicitly call play() after initialize to handle autoplay policy
            setTimeout(function () {
                try {
                    console.log('[PLAYER]   Calling dashPlayer.play()...');
                    self.dashPlayer.play();
                    console.log('[PLAYER]   dashPlayer.play() OK');
                } catch (playErr) {
                    console.warn('[PLAYER]   dashPlayer.play() failed:', playErr);
                }
            }, 500);
        } catch (e) {
            console.error('[PLAYER] FAIL: dashPlayer.initialize() threw:', e);
            clearTimeout(this.bufferingTimeout);
            this.showError();
        }
    },

    // Attach dash.js event handlers
    setupDashEvents: function () {
        if (!this.dashPlayer) {
            console.warn('[PLAYER] setupDashEvents: no dashPlayer');
            return;
        }
        console.log('[PLAYER]   Setting up dash.js event listeners...');

        // Check if dash.js events are available
        if (!dashjs || !dashjs.MediaPlayer || !dashjs.MediaPlayer.events) {
            //console.error('dash.js MediaPlayer.events not available');
            return;
        }

        const self = this;
        const events = dashjs.MediaPlayer.events;

        // Wrap each event listener in try-catch to prevent crashes
        try {
            if (events.BUFFER_EMPTY) {
                this.dashPlayer.on(events.BUFFER_EMPTY, function () {
                    if (!self.isActive) return;
                    //console.log('Buffering...');
                    self.showSpinner();

                    clearTimeout(self.bufferingTimeout);
                    self.bufferingTimeout = setTimeout(function () {
                        //console.error('Buffer empty timeout');
                        self.showError();
                    }, 30000);
                });
            }
        } catch (e) {
            console.warn('BUFFER_EMPTY event failed:', e);
        }

        try {
            if (events.BUFFER_LOADED) {
                this.dashPlayer.on(events.BUFFER_LOADED, function () {
                    if (!self.isActive) return;
                    console.log('[PLAYER] EVENT: BUFFER_LOADED');
                    self.hideSpinner();
                    clearTimeout(self.bufferingTimeout);
                });
            }
        } catch (e) {
            console.warn('[PLAYER] BUFFER_LOADED event failed:', e);
        }

        try {
            if (events.PLAYBACK_STARTED) {
                this.dashPlayer.on(events.PLAYBACK_STARTED, function () {
                    if (!self.isActive) return;
                    console.log('[PLAYER] EVENT: PLAYBACK_STARTED');
                    self.unmute();
                    self.hideSpinner();
                    self.hideError();
                    clearTimeout(self.bufferingTimeout);
                });
            }
        } catch (e) {
            console.warn('[PLAYER] PLAYBACK_STARTED event failed:', e);
        }

        try {
            if (events.PLAYBACK_ERROR) {
                this.dashPlayer.on(events.PLAYBACK_ERROR, function (e) {
                    if (!self.isActive) return;
                    console.error('[PLAYER] EVENT: PLAYBACK_ERROR', e);
                    self.showError();
                });
            }
        } catch (e) {
            console.warn('[PLAYER] PLAYBACK_ERROR event failed:', e);
        }

        // DRM diagnostics (optional)
        try {
            if (events.KEY_ERROR) {
                this.dashPlayer.on(events.KEY_ERROR, function (e) {
                    console.error('[PLAYER] EVENT: KEY_ERROR', e);
                });
            }
        } catch (e) {
            console.warn('[PLAYER] KEY_ERROR event failed:', e);
        }

        try {
            if (events.KEY_SESSION_CREATED) {
                this.dashPlayer.on(events.KEY_SESSION_CREATED, function () {
                    console.log('[PLAYER] EVENT: KEY_SESSION_CREATED');
                });
            }
        } catch (e) {
            console.warn('[PLAYER] KEY_SESSION_CREATED event failed:', e);
        }

        console.log('[PLAYER]   dash.js events configured');
    },

    // Close player and return to EPG
    close: function () {
        console.log('[PLAYER] close()');

        this.destroyPlayer();
        this.hideSpinner();
        this.hideError();
        this.hideControls();
        this.hideNowPlaying();
        this.hideChannelList();

        if (this.modal) {
            this.modal.className = 'player-modal hidden';
        }

        this.isActive = false;

        // Keep DRM data in localStorage for next play - only clear stream URL
        localStorage.removeItem('channelUrl');

        console.log('[PLAYER] Player closed');

        // Stop session/inactivity timers
        this._stopSessionCheck();

        // Restore EPG focus
        if (typeof EPG !== 'undefined' && EPG.focus && typeof EPG.focus.restoreFocus === 'function') {
            setTimeout(function () {
                EPG.focus.restoreFocus();
            }, 100);
        }
    },

    // ─── Session & Inactivity Check ───────────────────────────────────────
    // Start periodic session heartbeat and inactivity monitor.
    // Called automatically from open() when a stream starts.
    _startSessionCheck: function () {
        const self = this;

        // Mark initial activity time
        this._lastActivity = Date.now();

        // Listen for keydown to track user activity
        this._activityHandler = function () {
            self._lastActivity = Date.now();
        };
        document.addEventListener('keydown', this._activityHandler);

        // ── Run an immediate server-side session validation ────────────────
        // This catches the case where JWT is in localStorage but invalid on
        // the server (session removed from another platform).  fetchDRMKeys
        // already calls showSessionExpirePopup on 401.
        // Delayed a few seconds so it doesn't compete with the manifest and
        // licence requests while the stream is starting (the addtorecent
        // check in openChecked() already runs at play time).
        clearTimeout(this._initialSessionCheck);
        this._initialSessionCheck = setTimeout(function () {
            if (!self.isActive) return;
            if (typeof EPG.network !== 'undefined' && EPG.network.fetchDRMKeys) {
                EPG.network.fetchDRMKeys(function () {
                    console.log('[PLAYER] Initial session validation OK');
                });
            }
        }, 8000);

        // ── Session heartbeat: every 2 minutes, validate JWT server-side ──
        // fetchDRMKeys already shows session-expired popup on 401.
        this._sessionTimer = setInterval(function () {
            if (!self.isActive) return;
            console.log('[PLAYER] Session heartbeat check...');
            if (typeof EPG.network !== 'undefined' && EPG.network.fetchDRMKeys) {
                EPG.network.fetchDRMKeys(function () {
                    console.log('[PLAYER] Session heartbeat OK');
                });
            }
        }, 2 * 60 * 1000); // every 2 minutes

        // ── Inactivity check: every 60 min, if no user interaction for
        //    6+ hours, treat as expired session.
        this._inactivityTimer = setInterval(function () {
            if (!self.isActive) return;
            const elapsed = Date.now() - self._lastActivity;
            const sixHours = 6 * 60 * 60 * 1000;
            if (elapsed > sixHours) {
                console.log('[PLAYER] No activity for 6+ hours — checking session...');
                if (typeof EPG.network !== 'undefined' && EPG.network.fetchDRMKeys) {
                    EPG.network.fetchDRMKeys(function () {
                        console.log('[PLAYER] Session still valid after inactivity');
                    });
                }
            }
        }, 60 * 60 * 1000); // check every 60 min

        console.log('[PLAYER] Session + inactivity checks started');
    },

    // Stop all session/inactivity timers and cleanup.
    _stopSessionCheck: function () {
        clearTimeout(this._initialSessionCheck);
        if (this._sessionTimer) {
            clearInterval(this._sessionTimer);
            this._sessionTimer = null;
        }
        if (this._inactivityTimer) {
            clearInterval(this._inactivityTimer);
            this._inactivityTimer = null;
        }
        if (this._activityHandler) {
            document.removeEventListener('keydown', this._activityHandler);
            this._activityHandler = null;
        }
        this._lastActivity = null;
    },

    // Restore audio after muted autoplay has started
    unmute: function () {
        if (!this.videoElement) return;
        try {
            this.videoElement.muted = false;
            this.videoElement.volume = 1;
            if (this.dashPlayer) {
                this.dashPlayer.setMute(false);
                this.dashPlayer.setVolume(1);
            }
            console.log('[PLAYER]   Audio unmuted');
        } catch (e) {
            console.warn('[PLAYER]   unmute failed:', e);
        }
    },

    // Toggle play / pause
    togglePlayPause: function () {
        if (this.engine === 'avplay') {
            try {
                const state = webapis.avplay.getState();
                if (state === 'PLAYING') {
                    webapis.avplay.pause();
                    this.showControls('play');
                } else if (state === 'PAUSED') {
                    webapis.avplay.play();
                    this.showControls('pause');
                }
            } catch (e) {
                console.warn('[PLAYER] AVPlay play/pause failed:', e);
            }
            return;
        }
        if (!this.videoElement || !this.dashPlayer) return;

        if (this.videoElement.paused) {
            this.dashPlayer.play();
            this.showControls('pause');
        } else {
            this.dashPlayer.pause();
            this.showControls('play');
        }
    },

    // Retry after error
    retry: function () {
        //console.log('Retrying...');

        this.hideError();
        this.destroyPlayer();

        const streamUrl = localStorage.getItem('channelUrl');
        const drmData = localStorage.getItem('drmData');
        const widevineLicense = localStorage.getItem('widevinelicense');

        if (!streamUrl) {
            //console.error('No stream URL saved for retry');
            this.showError();
            return;
        }

        const self = this;
        setTimeout(function () {
            self.loadStream(streamUrl, drmData, widevineLicense);
        }, 200);
    },

    // ── UI Helpers ─────────────────────────────────────────────────────────

    showSpinner: function () {
        if (this.spinner) this.spinner.className = 'player-spinner'; // removes 'hidden'
    },

    hideSpinner: function () {
        if (this.spinner) this.spinner.className = 'player-spinner hidden';
    },

    showError: function () {
        console.log('[PLAYER] showError');
        clearTimeout(this.bufferingTimeout);
        this.hideSpinner();
        if (this.error) this.error.className = 'player-error'; // removes 'hidden'
    },

    hideError: function () {
        if (this.error) this.error.className = 'player-error hidden';
    },

    showControls: function (iconType) {
        if (!this.controls) return;

        const playIcon = document.getElementById('play-icon');
        const pauseIcon = document.getElementById('pause-icon');

        if (iconType === 'play') {
            if (playIcon) playIcon.className = '';
            if (pauseIcon) pauseIcon.className = 'hidden';
        } else {
            if (playIcon) playIcon.className = 'hidden';
            if (pauseIcon) pauseIcon.className = '';
        }

        this.controls.className = 'player-controls show';

        const self = this;
        clearTimeout(this._controlsTimeout);
        this._controlsTimeout = setTimeout(function () {
            self.hideControls();
        }, 2000);
    },

    hideControls: function () {
        if (this.controls) this.controls.className = 'player-controls';
    },

    // ── Now Playing Overlay ────────────────────────────────────────────────
    showNowPlaying: function () {
        const overlay = this.nowPlayingOverlay || document.getElementById('now-playing-overlay');
        if (!overlay) return;

        const channels = EPG.state ? EPG.state.channels : [];
        const channelUrl = localStorage.getItem('channelUrl') || '';
        let channelData = null;
        let programData = null;

        for (let i = 0; i < channels.length; i++) {
            if (channels[i].url === channelUrl) { channelData = channels[i]; break; }
        }

        const now = Math.floor(Date.now() / 1000);
        if (channelData && channelData.program) {
            for (let j = 0; j < channelData.program.length; j++) {
                const p = channelData.program[j];
                if (p.start <= now && now <= p.end) { programData = p; break; }
            }
        }

        // var logoEl = document.getElementById('npo-channel-logo');
        // if (logoEl) logoEl.src = (channelData && channelData.image) ? channelData.image : '../images/streamly/no-logo.png';

        const logoEl = document.getElementById('npo-channel-logo');
        if (logoEl) logoEl.src = (programData && programData.image) ? programData.image : '../images/dummy-blue.png';

        const titleEl = document.getElementById('npo-title');
        if (titleEl) titleEl.textContent = (programData && programData.title) ? programData.title
            : ((channelData && channelData.stationName) ? channelData.stationName : 'Live TV');

        const timeEl = document.getElementById('npo-time');
        if (timeEl && programData && EPG.utils && EPG.utils.formatTime) {
            timeEl.textContent = EPG.utils.formatTime(programData.start) + ' \u2013 ' + EPG.utils.formatTime(programData.end);
        } else if (timeEl) { timeEl.textContent = ''; }

        const metaEl = document.getElementById('npo-meta');
        if (metaEl) {
            let metaHTML = '';
            if (programData) {
                const durMins = (programData.end && programData.start) ? Math.round((programData.end - programData.start) / 60) : 0;
                if (durMins > 0) {
                    const h = Math.floor(durMins / 60), m = durMins % 60;
                    metaHTML += '<span class="npo-badge">' + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'min' : '') + '</span>';
                }
            }
            if (channelData && channelData.quals) metaHTML += '<span class="npo-badge">' + channelData.quals + '</span>';
            metaEl.innerHTML = metaHTML;
        }

        const descEl = document.getElementById('npo-desc');
        if (descEl) descEl.textContent = (programData && programData.description) ? programData.description : '';

        overlay.className = 'now-playing-overlay';
    },

    hideNowPlaying: function () {
        const overlay = this.nowPlayingOverlay || document.getElementById('now-playing-overlay');
        if (overlay) overlay.className = 'now-playing-overlay hidden';
    },

    // ── Channel List Overlay ───────────────────────────────────────────────

    // Pre-build channel list HTML once when channels are loaded.
    // Called from EPG.ui.renderEPG() so it is instantly ready when user presses Left/Right.
    preBuildChannelList: function () {
        const track = document.getElementById('pch-track');
        if (!track) return;

        const channels = EPG.state ? EPG.state.channels : [];
        if (!channels || channels.length === 0) return;

        // Skip rebuild if channel count hasn't changed
        const built = this.chList.cachedChannelCount || 0;
        if (built === channels.length) return;

        // Later EPG pages only add channels at the end: append just those
        // cards so a visible strip keeps its state.
        const from = (built > 0 && built < channels.length &&
            track.getElementsByClassName('pch-card').length === built) ? built : 0;

        let html = '';
        for (let i = from; i < channels.length; i++) {
            const ch = channels[i];
            const logoSrc = ch.image || '../images/streamly/no-logo.png';
            html += '<div class="pch-card" data-ch-index="' + i + '" data-ch-url="' + (ch.url || '') + '">' +
                '<span class="pch-num">' + (ch.id || '') + '</span>' +
                '<img class="pch-logo" src="' + logoSrc + '" alt="' + (ch.callSign || '') + '">' +
                '</div>';
        }

        if (from === 0) {
            track.innerHTML = html;
        } else {
            track.insertAdjacentHTML('beforeend', html);
        }
        this.chList.cachedChannelCount = channels.length;
        console.log('[PLAYER] Channel list pre-built with', channels.length, 'channels');
    },

    showChannelList: function () {
        const el = document.getElementById('player-channel-list');
        if (!el) return;

        const track = document.getElementById('pch-track');
        if (!track) return;

        // Update focused class on the cards (pre-built HTML already exists)
        const cards = track.getElementsByClassName('pch-card');
        for (let i = 0; i < cards.length; i++) {
            const cls = cards[i].className;
            if (i === this.chList.focusedIndex) {
                if (cls.indexOf('pch-focused') === -1) {
                    cards[i].className = cls + ' pch-focused';
                }
            } else {
                if (cls.indexOf('pch-focused') !== -1) {
                    cards[i].className = cls.replace(/\s?pch-focused/g, '');
                }
            }
        }

        el.className = 'player-ch-list';
        this.chList.visible = true;

        // Scroll focused card into view
        this._scrollChList();

        // Auto-hide after 5 seconds of inactivity
        this._resetChAutoHide();
    },

    hideChannelList: function () {
        const el = document.getElementById('player-channel-list');
        if (el) el.className = 'player-ch-list hidden';
        this.chList.visible = false;
        clearTimeout(this.chList.autoHideTimer);
    },

    // Move focus left/right in channel list
    chListMove: function (direction) {
        const channels = EPG.state ? EPG.state.channels : [];
        if (!channels || channels.length === 0) return;

        if (direction === 'left') {
            this.chList.focusedIndex = Math.max(0, this.chList.focusedIndex - 1);
        } else {
            this.chList.focusedIndex = Math.min(channels.length - 1, this.chList.focusedIndex + 1);
        }

        this.showChannelList();   // re-render with new focused index
        this._resetChAutoHide();
    },

    // Switch to the focused channel
    chListSelect: function () {
        const channels = EPG.state ? EPG.state.channels : [];
        const ch = channels[this.chList.focusedIndex];
        if (!ch || !ch.url) return;

        this.chList.activeIndex = this.chList.focusedIndex;
        this.hideChannelList();
        this.hideNowPlaying();

        const drmData = localStorage.getItem('drmData');
        const widevineLicense = localStorage.getItem('widevinelicense');

        this.openChecked(ch.url, drmData, widevineLicense);
    },

    // CH+ / CH- : jump to next / previous channel immediately
    chStep: function (direction) {
        const channels = EPG.state ? EPG.state.channels : [];
        if (!channels || channels.length === 0) return;

        let newIndex;
        if (direction === 'up') {
            newIndex = Math.max(0, this.chList.activeIndex - 1);
        } else {
            newIndex = Math.min(channels.length - 1, this.chList.activeIndex + 1);
        }

        const ch = channels[newIndex];
        if (!ch || !ch.url) return;

        this.chList.activeIndex = newIndex;
        this.chList.focusedIndex = newIndex;
        this.hideChannelList();
        this.hideNowPlaying();

        const drmData = localStorage.getItem('drmData');
        const widevineLicense = localStorage.getItem('widevinelicense');

        this.openChecked(ch.url, drmData, widevineLicense);
    },

    // Scroll the track so focused card is centered
    _scrollChList: function () {
        const track = document.getElementById('pch-track');
        if (!track) return;

        const cards = track.getElementsByClassName('pch-card');
        if (!cards || cards.length === 0) return;

        const focusedCard = cards[this.chList.focusedIndex];
        if (!focusedCard) return;

        // Use the full screen width as the viewport width (player is fullscreen)
        let parentW = window.innerWidth || document.documentElement.clientWidth || 1920;
        // Subtract padding (50px each side from CSS)
        parentW = parentW - 100;

        // offsetLeft is relative to the track (flex container) — sum up card widths + gaps
        const CARD_W = 160;   // matches .pch-card width
        const CARD_GAP = 14;  // matches gap
        const cardLeft = this.chList.focusedIndex * (CARD_W + CARD_GAP);
        const cardW = focusedCard.offsetWidth || CARD_W;

        let offset = cardLeft - (parentW / 2) + (cardW / 2);
        offset = Math.max(0, offset);

        track.style.transform = 'translateX(-' + offset + 'px)';
    },

    // Reset 5-second auto-hide timer
    _resetChAutoHide: function () {
        const self = this;
        clearTimeout(this.chList.autoHideTimer);
        this.chList.autoHideTimer = setTimeout(function () {
            self.hideChannelList();
        }, 5000);
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', function () {
            EPG.player.init();
        });
    } else if (document.attachEvent) {
        document.attachEvent('onreadystatechange', function () {
            if (document.readyState === 'complete') EPG.player.init();
        });
    }
} else {
    EPG.player.init();
}

//console.log('modern-epg-player.js loaded');