/**
 * Modern EPG Remote Control Navigation - OPTIMIZED
 * Performance improvements:
 * - DEBUG_MODE to disable console logging
 * - Cached program rows for faster access
 * - Direct scroll assignment (faster than requestAnimationFrame)
 * - Increased throttle delay for smoother navigation
 */

EPG.focus = {
    // Performance: Set to false in production
    DEBUG_MODE: false,

    // Remote key codes
    keys: {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        RETURN: 10009,
        EXIT: 10182
    },

    // Focus state
    state: {
        currentContext: 'EPG',
        channelIndex: 0,
        programIndex: -1,
        isModalOpen: false,
        isPlayerOpen: false,
        popupButtonIndex: 0,
        backKeyCount: 0, // ⭐ Progressive BACK counter
        lastKeyTime: 0,
        KEY_REPEAT_DELAY: 100, // Increased from 80 to 100 for smoother navigation
        playedFromLiveProgram: false, // true when user directly played a live program cell
        focusTime: null, // UP/DOWN anchor time (sec), valid while focusAnchorEl is focused
        focusAnchorEl: null
    },

    // DOM element cache
    cache: {
        channels: null,
        programs: null,
        channelSidebar: null,
        programGrid: null,
        programRows: null, // NEW: Cache program rows
        timeHeader: null,
        liveButton: null,
        settingsButton: null
    },

    // Conditional logging wrapper
    log: function () {
        if (this.DEBUG_MODE && console && console.log) {
            //console.log.apply(console, arguments);
        }
    },

    // Initialize focus system
    init: function () {
        this.log('Initializing EPG Remote Control (OPTIMIZED)');
        this.cacheElements();
        this.setupKeyboardListener();
        this.focusChannel(0)
        this.log('Remote control ready');
    },

    // Cache DOM elements (OPTIMIZED - cache program rows)
    cacheElements: function () {
        this.cache.channelSidebar = document.getElementById('channel-sidebar');
        this.cache.programGrid = document.getElementById('program-grid');
        this.cache.timeHeader = document.getElementById('time-header');
        this.cache.liveButton = document.getElementById('live-btn');
        this.cache.settingsButton = document.getElementById('settings-btn');

        // Cache program rows for faster access
        if (this.cache.programGrid) {
            this.cache.programRows = this.cache.programGrid.getElementsByClassName('program-row');
        }
    },

    // Get all channel elements
    getChannels: function () {
        if (!this.cache.channelSidebar) return [];
        return this.cache.channelSidebar.getElementsByClassName('channel-item');
    },

    // Get all programs for a channel (OPTIMIZED - use cached rows)
    getPrograms: function (channelIndex) {
        if (!this.cache.programRows || channelIndex < 0 || channelIndex >= this.cache.programRows.length) {
            return [];
        }
        return this.cache.programRows[channelIndex].getElementsByClassName('program-card');
    },

    // Check if navigation is allowed (throttle)
    canNavigate: function () {
        const now = Date.now();
        if (now - this.state.lastKeyTime < this.state.KEY_REPEAT_DELAY) {
            return false;
        }
        this.state.lastKeyTime = now;
        return true;
    },

    // Update GO LIVE button state
    updateLiveButtonState: function () {
        if (!this.cache.liveButton) return;

        const shouldShowLive = (
            this.state.currentContext === 'CHANNEL' ||
            (this.state.currentContext === 'PROGRAM' && this.state.programIndex === 0)
        );

        if (shouldShowLive) {
            this.cache.liveButton.textContent = 'LIVE';
            this.cache.liveButton.classList.add('is-live');
        } else {
            this.cache.liveButton.textContent = 'GO LIVE';
            this.cache.liveButton.classList.remove('is-live');
        }
    },

    // Clear all focus WITH CSS CLASS REMOVAL
    clearAllFocus: function () {
        const self = this;

        if (self.cache.liveButton) {
            self.cache.liveButton.classList.remove('focused');
            self.cache.liveButton.blur();
        }

        if (self.cache.settingsButton) {
            self.cache.settingsButton.classList.remove('focused');
            self.cache.settingsButton.blur();
        }

        // Only touch elements that actually carry a focus class, instead of
        // looping (and blur()-ing) every channel and program card in the
        // grid on each key press.
        self.removeFocusClass(self.cache.channelSidebar, 'channel-focused');
        self.removeFocusClass(self.cache.programGrid, 'program-focused');
    },

    removeFocusClass: function (container, className) {
        if (!container) return;
        // Copy first: the live collection shrinks as the class is removed
        const focused = Array.prototype.slice.call(container.getElementsByClassName(className));
        for (let i = 0; i < focused.length; i++) {
            focused[i].classList.remove(className);
            focused[i].blur();
        }
    },

    // Focus live button
    focusLiveButton: function () {
        this.clearAllFocus();
        this.state.currentContext = 'LIVE_BUTTON';
        this.state.channelIndex = -1; // ⭐ Reset
        this.state.programIndex = -1; // ⭐ Reset

        if (this.cache.liveButton) {
            this.cache.liveButton.classList.add('focused');
            this.cache.liveButton.focus();
            // ⭐ FIXED: Update button to show "GO LIVE" when focused
            this.cache.liveButton.textContent = 'GO LIVE';
            this.cache.liveButton.classList.remove('is-live');
        }
    },
    goLive: function () {
        if (this.cache.programGrid) {
            this.cache.programGrid.scrollLeft = 0;
        }
        if (this.cache.timeHeader) {
            this.cache.timeHeader.scrollLeft = 0;
        }

        if (typeof EPG.state !== 'undefined' && typeof EPG.time !== 'undefined') {
            EPG.state.firstSlotTime = EPG.time.getFirstSlotTime
                ? EPG.time.getFirstSlotTime()
                : Math.floor(Date.now() / 1000);
        }

        if (typeof EPG.ui !== 'undefined') {
            EPG.ui.renderTimeHeader();

            if (EPG.state && EPG.state.channels && EPG.state.channels.length > 0) {
                EPG.ui.renderProgramGrid(EPG.state.channels);
            }

            setTimeout(function () {
                EPG.ui.syncLiveIndicatorVisibility();
                EPG.ui.updateDayIndicator();
            }, 100);
        }

        if (this.cache.programGrid) {
            this.cache.programRows = this.cache.programGrid.getElementsByClassName('program-row');
        }

        this.focusChannel(0);
        this.log('GO LIVE: Timeline reset to now');
    },

    // Focus settings button
    focusSettingsButton: function () {
        this.clearAllFocus();
        this.state.currentContext = 'SETTINGS';

        if (this.cache.settingsButton) {
            this.cache.settingsButton.classList.add('focused');
            this.cache.settingsButton.focus();
            this.log('FOCUSED: Settings Button');
        }
    },

    // Focus channel
    focusChannel: function (index) {
        const channels = this.getChannels();
        if (index < 0 || index >= channels.length) return;

        this.clearAllFocus();
        this.state.currentContext = 'CHANNEL';
        this.state.channelIndex = index;
        this.state.programIndex = -1;
        this.state.focusTime = null;

        const channel = channels[index];
        if (channel) {
            channel.classList.add('channel-focused');
            channel.focus();
            this.scrollToChannel(index);

            const url = channel.getAttribute('data-channel-url');
            if (url) {
                localStorage.setItem('channelUrl', url);
            }

            this.updateLiveButtonState();
            this.log('FOCUSED: Channel #' + index);
        }
    },

    // Focus program
    focusProgram: function (channelIndex, programIndex) {
        const channels = this.getChannels();
        if (channelIndex < 0 || channelIndex >= channels.length) return;

        const programs = this.getPrograms(channelIndex);
        if (programIndex < 0 || programIndex >= programs.length) return;

        this.clearAllFocus();
        this.state.currentContext = 'PROGRAM';
        this.state.channelIndex = channelIndex;
        this.state.programIndex = programIndex;

        const program = programs[programIndex];
        if (program) {
            program.classList.add('program-focused');
            program.focus();
            this.scrollToChannel(channelIndex);
            this.scrollToProgram(program);
            this.updateLiveButtonState();
            this.log('FOCUSED: Program [Ch:' + channelIndex + ', Prog:' + programIndex + ']');
        }
    },

    // Scroll to channel (OPTIMIZED - direct assignment, no requestAnimationFrame)
    scrollToChannel: function (channelIndex) {
        if (!this.cache.channelSidebar || !this.cache.programGrid) return;

        // Use channel height of 125px
        let targetScroll = channelIndex * 125 - (this.cache.channelSidebar.clientHeight / 2) + 62.5;
        targetScroll = Math.max(0, Math.min(targetScroll, this.cache.channelSidebar.scrollHeight - this.cache.channelSidebar.clientHeight));

        this.cache.channelSidebar.scrollTop = targetScroll;
        this.cache.programGrid.scrollTop = targetScroll;
    },

    // Scroll to program (horizontal)
    scrollToProgram: function (programElement) {
        if (!this.cache.programGrid || !this.cache.timeHeader) return;

        const containerRect = this.cache.programGrid.getBoundingClientRect();
        const elementRect = programElement.getBoundingClientRect();
        const offsetFromLeft = elementRect.left - containerRect.left;

        if (offsetFromLeft < 0 || offsetFromLeft + elementRect.width > containerRect.width) {
            let targetScroll = this.cache.programGrid.scrollLeft + offsetFromLeft - 100;
            targetScroll = Math.max(0, targetScroll);

            this.cache.programGrid.scrollLeft = targetScroll;
            this.cache.timeHeader.scrollLeft = targetScroll;
        }
    },

    // Time UP/DOWN should stay on: the focused programme's start, clamped
    // to the left edge of the grid (a live show that began hours ago still
    // anchors at "now"). Kept across UP/DOWN so short shows don't drift it.
    getFocusTime: function () {
        const program = this.getPrograms(this.state.channelIndex)[this.state.programIndex];
        // Anchor only survives UP/DOWN moves; any other focus change re-derives it
        if (this.state.focusTime !== null && program && program === this.state.focusAnchorEl) {
            return this.state.focusTime;
        }
        const start = program ? parseInt(program.getAttribute('data-start'), 10) : 0;
        if (!start) return null; // no-data card: fall back to index matching
        const gridStart = (EPG.state && EPG.state.firstSlotTime) || 0;
        return Math.max(start, gridStart);
    },

    keepFocusAnchor: function (time) {
        this.state.focusTime = time;
        this.state.focusAnchorEl = this.getPrograms(this.state.channelIndex)[this.state.programIndex] || null;
    },

    // Index of the programme on `channelIndex` airing at `time`, else the
    // next one after it, else the last; index-based when times are unknown.
    findProgramIndexAt: function (channelIndex, time, fallbackIndex) {
        const programs = this.getPrograms(channelIndex);
        if (programs.length === 0) return -1;
        if (time === null) return Math.max(0, Math.min(fallbackIndex, programs.length - 1));

        for (let i = 0; i < programs.length; i++) {
            const start = parseInt(programs[i].getAttribute('data-start'), 10) || 0;
            const end = parseInt(programs[i].getAttribute('data-end'), 10) || 0;
            if (!start && !end) return Math.max(0, Math.min(fallbackIndex, programs.length - 1));
            if (time < end) return i; // first programme not yet over at `time`
        }
        return programs.length - 1;
    },

    // Navigate UP
    navigateUp: function () {
        if (!this.canNavigate()) return;
        this.log('⬆NAVIGATE UP');

        if (this.state.currentContext === 'LIVE_BUTTON') {
            this.log('Already at top');
            return;
        } else if (this.state.currentContext === 'SETTINGS') {
            this.focusLiveButton();
        } else if (this.state.currentContext === 'CHANNEL' || this.state.currentContext === 'PROGRAM') {
            if (this.state.channelIndex === 0) {
                this.focusLiveButton();
            } else {
                if (this.state.currentContext === 'PROGRAM') {
                    const time = this.getFocusTime();
                    const newIndex = this.findProgramIndexAt(this.state.channelIndex - 1, time, this.state.programIndex);
                    this.focusProgram(this.state.channelIndex - 1, Math.max(0, newIndex));
                    this.keepFocusAnchor(time);
                } else {
                    this.focusChannel(this.state.channelIndex - 1);
                }
            }
        }
    },

    // Navigate DOWN
    navigateDown: function () {
        if (!this.canNavigate()) return;
        this.log('⬇NAVIGATE DOWN');

        const totalChannels = this.getChannels().length;

        // Near the end of the loaded channels: make sure the next EPG page
        // is on its way (restarts a background load that gave up).
        if (this.state.channelIndex >= totalChannels - 3 &&
            EPG.network && typeof EPG.network.loadNextPage === 'function') {
            EPG.network.loadNextPage(true);
        }

        if (this.state.currentContext === 'LIVE_BUTTON' || this.state.currentContext === 'SETTINGS') {
            if (totalChannels > 0) {
                this.focusChannel(0);
            }
        } else if (this.state.currentContext === 'CHANNEL' || this.state.currentContext === 'PROGRAM') {
            if (this.state.channelIndex < totalChannels - 1) {
                if (this.state.currentContext === 'PROGRAM') {
                    const time = this.getFocusTime();
                    const newIndex = this.findProgramIndexAt(this.state.channelIndex + 1, time, this.state.programIndex);
                    this.focusProgram(this.state.channelIndex + 1, Math.max(0, newIndex));
                    this.keepFocusAnchor(time);
                } else {
                    this.focusChannel(this.state.channelIndex + 1);
                }
            }
        }
    },

    // Navigate LEFT
    navigateLeft: function () {
        if (!this.canNavigate()) return;
        this.log('⬅NAVIGATE LEFT');

        if (this.state.currentContext === 'SETTINGS') {
            this.focusLiveButton();
        } else if (this.state.currentContext === 'PROGRAM') {
            this.state.focusTime = null;
            if (this.state.programIndex > 0) {
                this.focusProgram(this.state.channelIndex, this.state.programIndex - 1);
            } else {
                this.focusChannel(this.state.channelIndex);
            }
        } else if (this.state.currentContext === 'CHANNEL') {
            this.focusLiveButton();
        }
    },

    // Navigate RIGHT
    navigateRight: function () {
        if (!this.canNavigate()) return;
        this.log('NAVIGATE RIGHT');

        let programs;
        if (this.state.currentContext === 'LIVE_BUTTON') {
            this.focusSettingsButton();
        } else if (this.state.currentContext === 'CHANNEL') {
            programs = this.getPrograms(this.state.channelIndex);
            if (programs.length > 0) {
                this.focusProgram(this.state.channelIndex, 0);
            }
        } else if (this.state.currentContext === 'PROGRAM') {
            this.state.focusTime = null;
            programs = this.getPrograms(this.state.channelIndex);
            if (this.state.programIndex < programs.length - 1) {
                this.focusProgram(this.state.channelIndex, this.state.programIndex + 1);
            }
        }
    },

    // Handle ENTER key
    handleEnter: function () {
        this.log('ENTER PRESSED');

        if (this.state.currentContext === 'LIVE_BUTTON') {
            this.goLive();
        } else if (this.state.currentContext === 'SETTINGS') {
            this.openSettings();
        } else if (this.state.currentContext === 'CHANNEL') {
            const channels = this.getChannels();
            const channel = channels[this.state.channelIndex];
            if (channel) {
                const channelUrl = channel.getAttribute('data-channel-url');
                const drmData = localStorage.getItem('drmData');
                const widevineLicense = localStorage.getItem('widevinelicense');

                if (!channelUrl) {
                    console.warn('Channel has no stream URL');
                    return;
                }

                this.log('DIRECT PLAY - Channel');
                localStorage.setItem('channelUrl', channelUrl);

                if (typeof EPG.player !== 'undefined') {
                    EPG.player.openChecked(channelUrl, drmData, widevineLicense);
                }
            }
        } else if (this.state.currentContext === 'PROGRAM') {
            const programs = this.getPrograms(this.state.channelIndex);
            const program = programs[this.state.programIndex];
            if (program) {
                const channelId = program.getAttribute('data-channel-id');
                const tmsId = program.getAttribute('data-tms-id');
                const channelUrl = program.getAttribute('data-channel-url');
                const progStart = parseInt(program.getAttribute('data-start'), 10);
                const progEnd = parseInt(program.getAttribute('data-end'), 10);
                const isCurrentlyLive = EPG.utils.isProgramLive(progStart, progEnd);

                if (isCurrentlyLive) {
                    // Current live program → play directly without modal
                    this.log('DIRECT PLAY - Live Program');
                        const drmData = localStorage.getItem('drmData');
                        const widevineLicense = localStorage.getItem('widevinelicense');

                    if (!channelUrl) {
                        console.warn('Live program has no stream URL');
                        return;
                    }

                    localStorage.setItem('channelUrl', channelUrl);
                    // Flag so restoreFocus returns to channel logo, not the program cell
                    this.state.playedFromLiveProgram = true;

                    if (typeof EPG.player !== 'undefined') {
                        EPG.player.openChecked(channelUrl, drmData, widevineLicense);
                    }
                } else {
                    // Future/upcoming program → open episode details modal
                    // Session check and details request run in parallel; the
                    // modal opens once both are back (never if expired).
                    let details = null;
                    let sessionOk = !(typeof AuthSession !== 'undefined' && AuthSession.addToRecentCheck);
                    let expired = false;
                    const showWhenReady = function () {
                        if (!details || !sessionOk || expired) return;
                        details._channelUrl = channelUrl;
                        details._programIndex = EPG.focus.state.programIndex;
                        EPG.ui.showProgramModal(details);
                    };

                    if (!sessionOk) {
                        AuthSession.addToRecentCheck(function (result) {
                            if (result === 'expired') {
                                expired = true;
                                return;
                            }
                            sessionOk = true;
                            showWhenReady();
                        });
                    }
                    if (channelId && tmsId) {
                        EPG.network.fetchProgramDetails(channelId, tmsId, function (data) {
                            details = data;
                            showWhenReady();
                        });
                    }
                }
            }
        }
    },

    // Restore focus after modal/player closes
    restoreFocus: function () {
        // If user played a live program directly, return focus to the channel logo
        if (this.state.playedFromLiveProgram) {
            this.state.playedFromLiveProgram = false;
            if (this.state.channelIndex >= 0) {
                this.focusChannel(this.state.channelIndex);
            } else {
                this.focusLiveButton();
            }
            return;
        }

        if (this.state.programIndex >= 0) {
            this.focusProgram(this.state.channelIndex, this.state.programIndex);
        } else if (this.state.channelIndex >= 0) {
            this.focusChannel(this.state.channelIndex);
        } else {
            this.focusLiveButton();
        }
    },

    // Open settings page
    openSettings: function () {
        window.location.href = '../settings/settings.html';
    },

    // Show exit popup via PopupManager
    showExitPopup: function () {
        const self = this;
        PopupManager.exit(function (confirmed) {
            if (confirmed) {
                if (typeof tizen !== 'undefined') {
                    tizen.application.getCurrentApplication().exit();
                }
            }
        });
    },

    // Exit app
    exitApp: function () {
        if (typeof tizen !== 'undefined') {
            tizen.application.getCurrentApplication().exit();
        }
    },

    // Setup keyboard listener
    setupKeyboardListener: function () {
        const self = this;

        function handleKeydown(event) {
            const keyCode = event.keyCode;

            // Prevent default for handled keys
            const handledKeys = [self.keys.LEFT, self.keys.RIGHT, self.keys.UP, self.keys.DOWN, self.keys.ENTER, self.keys.RETURN, self.keys.EXIT];
            for (let i = 0; i < handledKeys.length; i++) {
                if (keyCode === handledKeys[i]) {
                    if (event.preventDefault) event.preventDefault();
                    else event.returnValue = false;
                    break;
                }
            }

            // ⭐ Delegate to PopupManager first if popup is open
            if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
                PopupManager.handleKey(keyCode);
                return;
            }

            // Handle player controls
            // if (EPG.player && EPG.player.isActive) {
            //     switch (keyCode) {
            //         case self.keys.UP:
            //             // Toggle Now Playing overlay
            //             var npo = document.getElementById('now-playing-overlay');
            //             if (npo && npo.className.indexOf('hidden') === -1) {
            //                 EPG.player.hideNowPlaying();
            //             } else {
            //                 EPG.player.showNowPlaying();
            //             }
            //             break;
            //         case self.keys.DOWN:
            //             // DOWN hides overlay if visible
            //             EPG.player.hideNowPlaying();
            //             break;
            //         case self.keys.ENTER:
            //             EPG.player.togglePlayPause();
            //             break;
            //         case self.keys.RETURN:
            //             EPG.player.hideNowPlaying();
            //             EPG.player.close();
            //             break;
            //         case self.keys.EXIT:
            //             self.showExitPopup();
            //             break;
            //     }
            //     return;
            // }
            // Handle player controls
            if (EPG.player && EPG.player.isActive) {

                // CH+ / CH- remote keys (Tizen key codes)
                const CH_UP = 427;  // Samsung remote CH+
                const CH_DOWN = 428;  // Samsung remote CH-

                // ── Channel list is visible ────────────────────────────────
                if (EPG.player.chList && EPG.player.chList.visible) {
                    switch (keyCode) {
                        case self.keys.LEFT:
                            EPG.player.chListMove('left');
                            break;
                        case self.keys.RIGHT:
                            EPG.player.chListMove('right');
                            break;
                        case self.keys.ENTER:
                            EPG.player.chListSelect();
                            break;
                        case self.keys.UP:
                            // UP while list open → hide list, show info overlay
                            EPG.player.hideChannelList();
                            EPG.player.showNowPlaying();
                            break;
                        case self.keys.DOWN:
                        case self.keys.RETURN:
                            EPG.player.hideChannelList();
                            break;
                        case CH_UP:
                            EPG.player.chStep('up');
                            break;
                        case CH_DOWN:
                            EPG.player.chStep('down');
                            break;
                        case self.keys.EXIT:
                            self.showExitPopup();
                            break;
                    }
                    return;
                }

                // ── Channel list NOT visible ───────────────────────────────
                switch (keyCode) {
                    case self.keys.UP:
                        // UP → show Now Playing info overlay
                        const npo = document.getElementById('now-playing-overlay');
                        if (npo && npo.className.indexOf('hidden') === -1) {
                            EPG.player.hideNowPlaying();
                        } else {
                            EPG.player.hideChannelList();
                            EPG.player.showNowPlaying();
                        }
                        break;
                    case self.keys.DOWN:
                        EPG.player.hideNowPlaying();
                        break;
                    case self.keys.LEFT:
                    case self.keys.RIGHT:
                        // LEFT / RIGHT → open channel list
                        EPG.player.hideNowPlaying();
                        EPG.player.showChannelList();
                        break;
                    case CH_UP:
                        EPG.player.chStep('up');
                        break;
                    case CH_DOWN:
                        EPG.player.chStep('down');
                        break;
                    case self.keys.ENTER:
                        EPG.player.togglePlayPause();
                        break;
                    case self.keys.RETURN:
                        // If info overlay is open, close it first
                        const npoEl = document.getElementById('now-playing-overlay');
                        if (npoEl && npoEl.className.indexOf('hidden') === -1) {
                            EPG.player.hideNowPlaying();
                        } else {
                            EPG.player.close();
                        }
                        break;
                    case self.keys.EXIT:
                        self.showExitPopup();
                        break;
                }
                return;
            }
            if (keyCode === self.keys.EXIT) {
                self.showExitPopup();
                return;
            }

            // ⭐ Popup contexts removed — PopupManager handles all popups

            // Handle modal context
            //CRITICAL FIX: Modal RETURN stops here
            if (self.state.isModalOpen || self.state.currentContext === 'MODAL') {
                if (keyCode === self.keys.RETURN) {
                    EPG.ui.closeProgramModal();
                    return; //STOPS HERE - no exit popup
                } else if (keyCode === self.keys.ENTER) {
                    const playBtn = document.getElementById('modal-play-btn');
                    if (playBtn && playBtn.style.display !== 'none') {
                        playBtn.click();
                    }
                    return; //STOPS HERE
                }
                return; //STOPS for any other key when modal open
            }

            // Handle EPG navigation
            switch (keyCode) {
                case self.keys.UP:
                    self.state.backKeyCount = 0; // ⭐ Reset progressive BACK
                    self.navigateUp();
                    break;
                case self.keys.DOWN:
                    self.state.backKeyCount = 0; // ⭐ Reset progressive BACK
                    self.navigateDown();
                    break;
                case self.keys.LEFT:
                    self.state.backKeyCount = 0; // ⭐ Reset progressive BACK
                    self.navigateLeft();
                    break;
                case self.keys.RIGHT:
                    self.state.backKeyCount = 0; // ⭐ Reset progressive BACK
                    self.navigateRight();
                    break;
                case self.keys.ENTER:
                    self.state.backKeyCount = 0; // ⭐ Reset progressive BACK
                    self.handleEnter();
                    break;
                case self.keys.RETURN:
                    // ⭐ Progressive BACK key
                    if (self.state.currentContext === 'CHANNEL' || self.state.currentContext === 'PROGRAM') {
                        // 1st BACK → focus Go Live button
                        self.state.backKeyCount = 1;
                        self.focusLiveButton();
                    } else if (self.state.currentContext === 'LIVE_BUTTON') {
                        // 2nd BACK → show exit popup
                        self.state.backKeyCount = 0;
                        self.showExitPopup();
                    } else {
                        // Default: show exit popup
                        self.state.backKeyCount = 0;
                        self.showExitPopup();
                    }
                    break;
            }
        }

        if (document.addEventListener) {
            document.addEventListener('keydown', handleKeydown);
        } else if (document.attachEvent) {
            document.attachEvent('onkeydown', handleKeydown);
        }
    }
};

// Setup button click handlers
if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
        const liveBtn = document.getElementById('live-btn');
        if (liveBtn) {
            liveBtn.addEventListener('click', function () {
                if (typeof EPG.focus !== 'undefined') {
                    EPG.focus.goLive();
                }
            });
        }
    });
}

console.log('EPG Keyboard Navigation OPTIMIZED loaded');