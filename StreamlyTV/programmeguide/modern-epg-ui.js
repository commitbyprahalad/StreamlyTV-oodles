/**
 * Modern EPG UI Rendering - FIXED
 * 
 * KEY FIXES vs original:
 * - showProgramModal stores channelUrl correctly from programData._channelUrl
 * - modal-play-btn handler reads channelUrl and calls EPG.player.open()
 * - closeProgramModal properly resets state.isModalOpen
 */

EPG.ui = {
    elements: {
        loading: null,
        channelSidebar: null,
        timeHeader: null,
        programGrid: null,
        liveIndicator: null,
        programModal: null,
        dayIndicator: null
    },

    cacheElements: function () {
        this.elements.loading = document.getElementById('loading');
        this.elements.channelSidebar = document.getElementById('channel-sidebar');
        this.elements.timeHeader = document.getElementById('time-header');
        this.elements.programGrid = document.getElementById('program-grid');
        this.elements.liveIndicator = document.getElementById('live-indicator');
        this.elements.programModal = document.getElementById('program-modal');
        this.elements.dayIndicator = document.getElementById('day-indicator');

        return !!(this.elements.channelSidebar && this.elements.timeHeader && this.elements.programGrid);
    },

    showLoading: function () {
        const el = document.getElementById('loading');
        if (el) { el.style.display = 'flex'; el.className = 'loading-overlay'; }
    },

    hideLoading: function () {
        const el = document.getElementById('loading');
        if (el) { el.style.display = 'none'; el.className = 'loading-overlay hidden'; }
    },

    showNoInternet: function () {
        PopupManager.showAlert('Unable to load EPG data. Please check your internet connection and try again.', function () {
            const m = document.getElementById('no-internet-modal');
            if (m) m.className = 'popup-modal hidden';
            EPG.network.fetchEPGData(function (channels) {
                if (channels && channels.length > 0) {
                    EPG.ui.renderEPG(channels);
                    EPG.state.channels = channels;
                }
            });
        });
    },

    showSessionExpired: function () {
        const m = document.getElementById('session-modal');
        if (m) m.className = 'popup-modal';
    },

    // ── Time header ───────────────────────────────────────────────────────

    renderTimeHeader: function () {
        const timeHeader = document.getElementById('time-header');
        if (!timeHeader || !EPG.time || !EPG.time.generateTimeSlots) return;

        const slots = EPG.time.generateTimeSlots();
        let html = '';
        for (let i = 0; i < slots.length; i++) {
            html += '<div class="time-slot">' + slots[i].label + '</div>';
        }
        timeHeader.innerHTML = html;
    },

    // ── Day indicator ─────────────────────────────────────────────────────

    updateDayIndicator: function () {
        const dayIndicator = document.getElementById('day-indicator');
        const programGrid = document.getElementById('program-grid');
        if (!dayIndicator || !programGrid || !EPG.state || !EPG.state.firstSlotTime) return;

        const scrollLeft = programGrid.scrollLeft;
        const currentTime = EPG.state.firstSlotTime + (scrollLeft / EPG.config.PIXELS_PER_MINUTE) * 60;

        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const tomorrowMidnight = new Date(todayMidnight.getTime() + 86400000);

        const dayText = currentTime >= tomorrowMidnight.getTime() / 1000 ? 'Tomorrow' : 'Today';
        const dateObj = new Date(currentTime * 1000);
        const dateText = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        dayIndicator.innerHTML =
            '<div class="day-text"><strong>' + dayText + '</strong></div>' +
            '<div class="date-text">' + dateText + '</div>';
    },

    // ── Channel sidebar ───────────────────────────────────────────────────

    renderChannelSidebar: function (channels) {
        const sidebar = document.getElementById('channel-sidebar');
        if (!sidebar) { console.error('channel-sidebar not found'); return; }

        const html = '<div id="day-indicator" class="day-indicator theme-dark">' +
            '<div class="day-text"><strong>Today</strong></div>' +
            '<div class="date-text">Loading…</div>' +
            '</div>' +
            this.buildChannelItemsHtml(channels, 0);

        sidebar.innerHTML = html;
    },

    // Channel logo rows; startIndex numbers them after already-rendered
    // channels when a later EPG page is appended.
    buildChannelItemsHtml: function (channels, startIndex) {
        let html = '';
        for (let n = 0; n < channels.length; n++) {
            const ch = channels[n];
            const i = startIndex + n;
            html += '<div class="channel-item" tabindex="0"' +
                ' data-channel-index="' + i + '"' +
                ' data-channel-id="' + ch.id + '"' +
                ' data-channel-url="' + (ch.url || '') + '">' +
                '<img class="channel-logo" src="' + (ch.image || '../images/streamly/no-logo.png') +
                '" alt="' + (ch.callSign || 'Channel') + '" />' +
                '<div class="channel-info">' +
                '<div class="channel-number">' + ch.id + '</div>' +
                '<div class="channel-name">' + (ch.callSign || 'Channel ' + ch.id) + '</div>' +
                '</div></div>';
        }
        return html;
    },

    // ── Program grid ──────────────────────────────────────────────────────

    renderProgramGrid: function (channels) {
        const grid = document.getElementById('program-grid');
        if (!grid || !EPG.state || !EPG.state.firstSlotTime) return;

        grid.innerHTML = this.buildProgramRowsHtml(channels, 0, EPG.state.firstSlotTime);
        this._liveRowCacheKey = null;
        this.updateElapsedShading();
    },

    buildProgramRowsHtml: function (channels, startIndex, firstSlotTime) {
        let html = '';

        for (let n = 0; n < channels.length; n++) {
            const ch = channels[n];
            const i = startIndex + n;
            html += '<div class="program-row" data-channel-index="' + i + '">';

            if (ch.program && ch.program.length > 0) {
                for (let j = 0; j < ch.program.length; j++) {
                    const prog = ch.program[j];
                    const width = EPG.utils.calculateProgramWidth(prog.start, prog.end, firstSlotTime);
                    const offset = EPG.utils.calculateProgramOffset(prog.start, firstSlotTime);
                    const isLive = EPG.utils.isProgramLive(prog.start, prog.end);

                    // Calculate duration
                    const durationMins = Math.round((prog.end - prog.start) / 60);
                    let durationText = '';
                    if (durationMins >= 60) {
                        const hours = Math.floor(durationMins / 60);
                        const mins = durationMins % 60;
                        durationText = hours + ' Hour' + (mins > 0 ? ' ' + mins + ' Minute' : '');
                    } else {
                        durationText = durationMins + ' Minute';
                    }

                    // Extract program type from TMSId (first 2 characters)
                    // TMSId format: "EP005927270130" → "EP", "MV012345678900" → "MV", "SH034567891200" → "SH"
                    let programType = '';
                    if (prog.TMSId && prog.TMSId.length >= 2) {
                        const typeCode = prog.TMSId.substring(0, 2).toUpperCase();
                        if (typeCode === 'EP' || typeCode === 'MV' || typeCode === 'SH') {
                            programType = typeCode;
                        }
                    }

                    // Skip cards that ended entirely before the current firstSlotTime
                    if (prog.end <= firstSlotTime) { continue; }

                    html += '<div class="program-card' + (isLive ? ' live' : '') + '"' +
                        ' tabindex="0"' +
                        ' data-channel-index="' + i + '"' +
                        ' data-program-index="' + j + '"' +
                        ' data-channel-id="' + ch.id + '"' +
                        ' data-channel-url="' + (ch.url || '') + '"' +
                        ' data-tms-id="' + (prog.TMSId || '') + '"' +
                        ' data-start="' + prog.start + '"' +
                        ' data-end="' + prog.end + '"' +
                        ' style="left:' + offset + 'px; width:' + width + 'px;">' +
                        '<div class="program-elapsed"></div>' +
                        '<div class="program-title">' + (prog.title || 'Untitled') + '</div>' +
                        '<div class="program-time">' +
                        EPG.utils.formatTime(prog.start) + ' - ' + EPG.utils.formatTime(prog.end) +
                        '</div>' +
                        '<div class="program-meta">' +
                        (programType ? '<span class="program-type">' + programType + '</span>' : '') +
                        '<span class="program-duration">' + durationText + '</span>' +
                        '</div>' +
                        '</div>';
                }
            } else {
                // Conditional fallback display:
                //   stationName available  → "[StationName] Programme"
                //   stationName missing    → "No Data Available"
                // Note: callSign in the API is often the literal string "NA", so
                // stationName is the correct field for the channel's display name.
                const rawStation = ch.stationName || '';
                const stationName = (rawStation.trim() && rawStation.trim().toUpperCase() !== 'NA')
                    ? rawStation.trim()
                    : '';
                const fallbackTitle = stationName
                    ? (stationName + ' Programme')
                    : 'No Data Available';

                // Full-width cell (28800px = 96 half-hour slots × 300px) so the row
                // is filled rather than leaving a blank gap after a narrow 300px stub.
                html += '<div class="program-card no-data-card"' +
                    ' tabindex="0"' +
                    ' data-channel-index="' + i + '"' +
                    ' data-program-index="0"' +
                    ' data-channel-id="' + ch.id + '"' +
                    ' data-channel-url="' + (ch.url || '') + '"' +
                    ' data-tms-id=""' +
                    ' data-start="0"' +
                    ' data-end="0"' +
                    ' style="left:0; width:28800px;">' +
                    '<div class="program-title">' + fallbackTitle + '</div>' +
                    '<div class="program-time">--:-- - --:--</div>' +
                    '</div>';
            }

            html += '</div>';
        }

        return html;
    },

    // ── Appending later EPG pages ─────────────────────────────────────────

    /**
     * Add channels from a later EPG page below the ones already on screen,
     * without re-rendering existing rows (focus and scroll stay put).
     * Pages are queued so they always land in order, and wait until the
     * first page has actually been drawn by renderEPG().
     */
    appendChannels: function (newChannels) {
        this._pendingChannels = (this._pendingChannels || []).concat(newChannels);
        this._flushPendingChannels();
    },

    _flushPendingChannels: function () {
        const pending = this._pendingChannels || [];
        if (!pending.length) return;

        const sidebar = document.getElementById('channel-sidebar');
        const grid = document.getElementById('program-grid');
        const startIndex = EPG.state.channels.length;

        // First page not drawn yet — try again shortly
        if (!sidebar || !grid || !EPG.state.firstSlotTime ||
            grid.getElementsByClassName('program-row').length !== startIndex) {
            const self = this;
            const generation = EPG.state.paging.generation;
            clearTimeout(this._flushTimer);
            this._flushTimer = setTimeout(function () {
                if (generation === EPG.state.paging.generation) {
                    self._flushPendingChannels();
                } else {
                    self._pendingChannels = [];
                }
            }, 300);
            return;
        }

        this._pendingChannels = [];
        EPG.state.channels = EPG.state.channels.concat(pending);

        sidebar.insertAdjacentHTML('beforeend', this.buildChannelItemsHtml(pending, startIndex));
        grid.insertAdjacentHTML('beforeend', this.buildProgramRowsHtml(pending, startIndex, EPG.state.firstSlotTime));

        this._liveRowCacheKey = null;
        this.updateElapsedShading();
        this.syncLiveIndicatorVisibility();

        // Player channel strip: add the new channels too
        if (typeof EPG.player !== 'undefined' && typeof EPG.player.preBuildChannelList === 'function') {
            EPG.player.preBuildChannelList();
        }
    },

    // ── Live indicator ────────────────────────────────────────────────────

    /**
     * Shade only the elapsed part of each live program — from the card's left
     * edge up to the live-indicator line — instead of the whole card.
     *
     * Works in content space (same formula as the indicator and program
     * offsets), so it's independent of horizontal scroll. Also toggles the
     * `live` class, so a program that starts/ends between full re-renders
     * picks up/drops the shading on the next 10-second tick.
     */
    updateElapsedShading: function () {
        const programGrid = document.getElementById('program-grid');
        if (!programGrid || !EPG.state || !EPG.state.firstSlotTime || !EPG.config) return;

        const now = Math.floor(Date.now() / 1000);
        const liveContentLeft = ((now - EPG.state.firstSlotTime) / 60) * EPG.config.PIXELS_PER_MINUTE;

        // Find live programs from the data (cheap) instead of reading
        // data-start/data-end off every card in the grid (slow on TVs).
        // Only the few live cards are then looked up in the DOM.
        const rows = programGrid.getElementsByClassName('program-row');
        const channels = EPG.state.channels || [];
        const count = Math.min(rows.length, channels.length);
        const liveCards = [];
        for (let i = 0; i < count; i++) {
            const progs = channels[i].program;
            if (!progs) continue;
            for (let j = 0; j < progs.length; j++) {
                if (progs[j].start <= now && now <= progs[j].end) {
                    const card = rows[i].querySelector('.program-card[data-program-index="' + j + '"]');
                    if (card) liveCards.push(card);
                }
            }
        }

        // Drop shading from cards that are no longer live
        const previous = Array.prototype.slice.call(programGrid.getElementsByClassName('live'));
        for (let i = 0; i < previous.length; i++) {
            if (liveCards.indexOf(previous[i]) !== -1) continue;
            previous[i].classList.remove('live');
            const oldShade = previous[i].firstElementChild;
            if (oldShade && oldShade.className === 'program-elapsed') oldShade.style.width = '0px';
        }

        for (let i = 0; i < liveCards.length; i++) {
            const card = liveCards[i];
            card.classList.add('live');
            const shade = card.firstElementChild;
            if (!shade || shade.className !== 'program-elapsed') continue;
            const cardLeft = parseFloat(card.style.left) || 0;
            const cardWidth = parseFloat(card.style.width) || 0;
            shade.style.width = Math.max(0, Math.min(cardWidth, liveContentLeft - cardLeft)) + 'px';
        }
    },

    /**
     * First/last row index that has a currently-live program, worked out
     * from EPG.state.channels. Cached per 10-second bucket and row count,
     * because this runs on every scroll event.
     */
    getLiveRowRange: function (rowCount) {
        const now = Math.floor(Date.now() / 1000);
        const key = rowCount + ':' + EPG.state.firstSlotTime + ':' + Math.floor(now / 10);
        if (this._liveRowCacheKey === key) return this._liveRowRange;

        const channels = EPG.state.channels || [];
        const count = Math.min(rowCount, channels.length);
        let first = -1;
        let last = -1;
        for (let i = 0; i < count; i++) {
            const progs = channels[i].program;
            if (!progs) continue;
            for (let j = 0; j < progs.length; j++) {
                if (progs[j].start && progs[j].end && progs[j].start <= now && now <= progs[j].end) {
                    if (first === -1) first = i;
                    last = i;
                    break;
                }
            }
        }

        this._liveRowCacheKey = key;
        this._liveRowRange = { first: first, last: last };
        return this._liveRowRange;
    },

    /**
     * Calculate the pixel offset of the current time within the program timeline.
     *
     * Timeline geometry:
     *   SIDEBAR_WIDTH  = 170px  (channel/day column — outside .timeline-container)
     *   PIXELS_PER_MIN = 10px   (300px per 30-min slot)
     *
     * The live-indicator is inside .timeline-container (position:relative), so
     * its `left` is relative to the start of the timeline content area.
     *
     * Content left position of current time:
     *   liveContentLeft = (secondsElapsed / 60) * PIXELS_PER_MIN
     *
     * Visual left within the visible timeline viewport:
     *   visualLeft = liveContentLeft - programGrid.scrollLeft
     *
     * When visualLeft < 0 the indicator is left of the viewport (scrolled past).
     * When visualLeft > containerWidth it is right of the viewport (future).
     * Either way we hide it.
     */
    updateLiveIndicator: function () {
        const el = document.getElementById('live-indicator');
        const programGrid = document.getElementById('program-grid');
        if (!el || !programGrid || !EPG.state || !EPG.state.firstSlotTime || !EPG.config) return;

        const now = Math.floor(Date.now() / 1000);
        const secondsElapsed = now - EPG.state.firstSlotTime;
        const liveContentLeft = (secondsElapsed / 60) * EPG.config.PIXELS_PER_MINUTE;

        // Visual position accounts for how far the user has scrolled
        const visualLeft = liveContentLeft - programGrid.scrollLeft;

        el.style.left = visualLeft + 'px';

        // Keep the elapsed shading of live cards in step with the line
        this.updateElapsedShading();

        // Also refresh vertical span and visibility
        this.syncLiveIndicatorVisibility();
    },

    /**
     * Full sync: recompute left position, vertical span, and hide/show.
     *
     * Called on:
     *  - Every scroll event on program-grid
     *  - Every focus change (channel row / program cell)
     *  - The 10-second interval timer
     *  - After initial render
     */
    syncLiveIndicatorVisibility: function () {
        const el = document.getElementById('live-indicator');
        const programGrid = document.getElementById('program-grid');
        const timeHeader = document.getElementById('time-header');
        if (!el || !programGrid || !EPG.state || !EPG.state.firstSlotTime || !EPG.config) return;

        const now = Math.floor(Date.now() / 1000);
        const secondsElapsed = now - EPG.state.firstSlotTime;

        // Content-space pixel position of current time (same formula as program offsets)
        const liveContentLeft = (secondsElapsed / 60) * EPG.config.PIXELS_PER_MINUTE;

        // Visual position within the scrolled viewport
        const scrollLeft = programGrid.scrollLeft;
        const containerWidth = programGrid.clientWidth;
        const visualLeft = liveContentLeft - scrollLeft;

        // ── 1. Horizontal visibility ──────────────────────────────────────
        // Hide if current time has scrolled off either edge of the visible area
        if (visualLeft < 0 || visualLeft > containerWidth) {
            el.style.display = 'none';
            return;
        }

        // ── 2. Set horizontal position ────────────────────────────────────
        el.style.left = visualLeft + 'px';

        // ── 3. Vertical span: only rows that have a currently-live program ─
        const ROW_HEIGHT = 125; // matches .program-row height in CSS
        const rows = programGrid.getElementsByClassName('program-row');
        if (!rows || rows.length === 0) {
            el.style.display = 'none';
            return;
        }

        const liveRange = this.getLiveRowRange(rows.length);
        const firstLiveRow = liveRange.first;
        const lastLiveRow = liveRange.last;

        if (firstLiveRow === -1) {
            // No live programs in any row — hide
            el.style.display = 'none';
            return;
        }

        // top  = time-header height + rows above the first live row
        // height = number of consecutive live rows × ROW_HEIGHT
        const timeHeaderHeight = timeHeader ? timeHeader.offsetHeight : 50;
        const topPx = timeHeaderHeight + (firstLiveRow * ROW_HEIGHT);
        const heightPx = (lastLiveRow - firstLiveRow + 1) * ROW_HEIGHT;

        el.style.top = topPx + 'px';
        el.style.height = heightPx + 'px';
        el.style.bottom = 'auto';
        el.style.display = '';
    },

    // ── Main render ───────────────────────────────────────────────────────

    renderEPG: function (channels) {
        if (!channels || channels.length === 0) {
            console.log('No channels available.');
            return;
        }

        if (!this.cacheElements()) {
            const self = this;
            setTimeout(function () { self.renderEPG(channels); }, 500);
            return;
        }

        this.renderTimeHeader();
        this.renderChannelSidebar(channels);
        this.renderProgramGrid(channels);
        this.updateLiveIndicator();

        const self = this;
        setTimeout(function () { self.updateDayIndicator(); }, 150);

        // Re-sync indicator after DOM has fully painted so offsetHeight is accurate
        setTimeout(function () { self.syncLiveIndicatorVisibility(); }, 300);

        // Listeners, timers and the key handler are set up once. A second
        // renderEPG() (retry after a network error) only redraws and
        // re-focuses, instead of stacking duplicate listeners/intervals.
        if (this._bootstrapped) {
            setTimeout(function () {
                if (typeof EPG.focus !== 'undefined' && typeof EPG.focus.cacheElements === 'function') {
                    EPG.focus.cacheElements();
                    EPG.focus.focusChannel(0);
                }
            }, 200);
        } else {
            this._bootstrapped = true;

            // Sync time header on horizontal scroll. The header follows
            // immediately; the heavier day/live-line updates run at most
            // once per frame.
            const programGrid = document.getElementById('program-grid');
            const timeHeader = document.getElementById('time-header');
            if (programGrid && timeHeader) {
                const nextFrame = window.requestAnimationFrame
                    ? function (fn) { window.requestAnimationFrame(fn); }
                    : function (fn) { setTimeout(fn, 16); };
                let scrollQueued = false;
                programGrid.onscroll = null;
                programGrid.addEventListener('scroll', function () {
                    timeHeader.scrollLeft = programGrid.scrollLeft;
                    if (scrollQueued) return;
                    scrollQueued = true;
                    nextFrame(function () {
                        scrollQueued = false;
                        self.updateDayIndicator();
                        self.syncLiveIndicatorVisibility();
                    });
                });
            }

            // updateLiveIndicator() already refreshes shading + live line
            setInterval(function () {
                EPG.ui.updateLiveIndicator();
                EPG.ui.updateDayIndicator();
            }, 10000);

            // Boot focus manager after DOM is painted
            setTimeout(function () {
                if (typeof EPG.focus !== 'undefined' && typeof EPG.focus.init === 'function') {
                    EPG.focus.init();
                }
            }, 200);
        }

        // Pre-build channel list HTML for instant player channel list
        if (typeof EPG.player !== 'undefined' && typeof EPG.player.preBuildChannelList === 'function') {
            EPG.player.preBuildChannelList();
        }

        //console.log('✅ EPG rendered with', channels.length, 'channels');
    },

    // ── Programme modal ───────────────────────────────────────────────────

    showProgramModal: function (programData) {
        const modal = document.getElementById('program-modal');
        if (!modal || !programData) return;

        //console.log('Opening modal for:', programData.title);

        // Build modal HTML with new structure
        let modalHTML = '<button class="modal-close" id="modal-close">×</button>';
        modalHTML += '<div class="modal-body">';

        // LEFT SIDE - Poster and Details
        modalHTML += '<div class="modal-left">';
        modalHTML += '<div class="modal-poster">';
        modalHTML += '<img id="modal-image" src="' + (programData.image || '../images/Icons/no-logo.png') + '" alt="Program">';
        modalHTML += '</div>';

        modalHTML += '<div class="modal-info">';
        modalHTML += '<h1 id="modal-title">' + (programData.stationName || 'Unknown Channel') + '</h1>';
        modalHTML += '<div class="modal-subtitle">' + (programData.title || 'Untitled') + '</div>';

        // Time and meta
        if (programData.schedule && programData.schedule[0]) {
            const s = programData.schedule[0];
            modalHTML += '<div class="modal-meta">';
            modalHTML += '<span id="modal-time">' + EPG.utils.formatTime(s.start) + ' - ' + EPG.utils.formatTime(s.end) + '</span>';
            modalHTML += '</div>';
        }

        // Badges (Duration, Quality, Genre)
        modalHTML += '<div class="modal-badges">';
        if (programData.duration) {
            modalHTML += '<span class="badge">' + EPG.utils.formatDuration(programData.duration) + '</span>';
        }
        if (programData.quals) {
            modalHTML += '<span class="badge">' + programData.quals + '</span>';
        }
        if (programData.genre && programData.genre[0]) {
            modalHTML += '<span class="badge genre">' + programData.genre[0] + '</span>';
        }
        modalHTML += '</div>';

        // Description
        modalHTML += '<p class="modal-description">' + (programData.description || 'No description available.') + '</p>';

        //Play button - ONLY for program index 0 (live)
        const shouldShowPlayButton = (programData._programIndex === 0);

        if (shouldShowPlayButton) {
            console.log('Modal: Showing Play Now button (program index 0 - LIVE)');
            modalHTML += '<button id="modal-play-btn" class="play-button">';
            modalHTML += '<img src="../images/Icons/play-circle.png" alt="Play"> Play Now';
            modalHTML += '</button>';
        } else {
            //console.log('Modal: Hiding Play Now button (program index ' + programData._programIndex + ' - NOT LIVE)');
        }

        modalHTML += '</div>'; // close modal-info
        modalHTML += '</div>'; // close modal-left

        // RIGHT SIDE - Schedule
        modalHTML += '<div class="modal-right">';
        modalHTML += '<div class="modal-schedule">';
        modalHTML += '<div class="modal-schedule-header">';
        modalHTML += '<h3>Schedule</h3>';
        modalHTML += '</div>';

        if (programData.schedule) {
            const grouped = EPG.utils.groupSchedulesByDate(programData.schedule);

            if (grouped.Today.length > 0) {
                const today = new Date();
                const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                modalHTML += '<div class="schedule-day-section">';
                modalHTML += '<h4>Today</h4>';
                modalHTML += '<div class="day-date">' + dateStr + '</div>';
                modalHTML += '<div class="schedule-times">';
                for (let i = 0; i < grouped.Today.length; i++) {
                    const nowTime = Math.floor(Date.now() / 1000);
                    const schedItem = programData.schedule[i];
                    const isCurrentlyLive = schedItem && EPG.utils.isProgramLive(schedItem.start, schedItem.end);
                    modalHTML += '<span class="schedule-time-chip' + (isCurrentlyLive ? ' live' : '') + '">' + grouped.Today[i] + '</span>';
                }
                modalHTML += '</div>';
                modalHTML += '</div>';
            }

            if (grouped.Tomorrow.length > 0) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dateStr = tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                modalHTML += '<div class="schedule-day-section">';
                modalHTML += '<h4>Tomorrow</h4>';
                modalHTML += '<div class="day-date">' + dateStr + '</div>';
                modalHTML += '<div class="schedule-times">';
                for (let i = 0; i < grouped.Tomorrow.length; i++) {
                    modalHTML += '<span class="schedule-time-chip">' + grouped.Tomorrow[i] + '</span>';
                }
                modalHTML += '</div>';
                modalHTML += '</div>';
            }
        } else {
            modalHTML += '<p>No upcoming schedule</p>';
        }

        modalHTML += '</div>'; // close modal-schedule
        modalHTML += '</div>'; // close modal-right
        modalHTML += '</div>'; // close modal-body

        // Set modal content
        modal.innerHTML = modalHTML;

        // Store channel URL for play button
        const channelUrl = programData._channelUrl || localStorage.getItem('channelUrl') || '';
        if (channelUrl) localStorage.setItem('channelUrl', channelUrl);

        if (programData.channel_id) {
            localStorage.setItem('channel_id', programData.channel_id);
        }

        // Show modal
        modal.className = 'modal';

        if (typeof EPG.focus !== 'undefined') {
            EPG.focus.state.isModalOpen = true;
            EPG.focus.state.currentContext = 'MODAL';
        }

        // Attach event listeners to new elements
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) {
            closeBtn.onclick = function () {
                EPG.ui.closeProgramModal();
            };
        }

        const playBtn = document.getElementById('modal-play-btn');
        if (playBtn) {
            playBtn.onclick = function () {
                const streamUrl = localStorage.getItem('channelUrl');
                const drmData = localStorage.getItem('drmData');
                const widevineLicense = localStorage.getItem('widevinelicense');

                if (!streamUrl) {
                    console.warn('Play Now: no channelUrl');
                    return;
                }

                EPG.ui.closeProgramModal();

                if (typeof EPG.player !== 'undefined') {
                    EPG.player.open(streamUrl, drmData, widevineLicense);
                }
            };
        }
    },

    closeProgramModal: function () {
        const modal = document.getElementById('program-modal');
        if (!modal) return;

        modal.className = 'modal hidden';

        if (typeof EPG.focus !== 'undefined') {
            EPG.focus.state.isModalOpen = false;
            EPG.focus.restoreFocus();
        }
    }
};

// ── DOM-ready event handlers ───────────────────────────────────────────────

if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {

        // Close button (×) on modal
        const modalClose = document.getElementById('modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', function () {
                EPG.ui.closeProgramModal();
            });
        }

        // ── Play Now button ──────────────────────────────────────────────
        // Only shown for LIVE programmes.
        // Reads channelUrl from localStorage (populated by keyboard.js or showProgramModal).
        const modalPlayBtn = document.getElementById('modal-play-btn');
        if (modalPlayBtn) {
            modalPlayBtn.addEventListener('click', function () {
                const streamUrl = localStorage.getItem('channelUrl');
                const drmData = localStorage.getItem('drmData');
                const widevineLicense = localStorage.getItem('widevinelicense');

                if (!streamUrl) {
                    console.warn('Play Now: no channelUrl in localStorage');
                    return;
                }

                // Close modal first, then open player
                EPG.ui.closeProgramModal();

                if (typeof EPG.player !== 'undefined') {
                    EPG.player.open(streamUrl, drmData, widevineLicense);
                }
            });
        }

        // Session expired OK button
        const sessionOk = document.getElementById('session-ok');
        if (sessionOk) {
            sessionOk.addEventListener('click', function () {
                clearSessionStorage();
                window.location.href = '../login/login.html';
            });
        }

        // No-internet retry
        const internetRetry = document.getElementById('internet-retry');
        if (internetRetry) {
            internetRetry.addEventListener('click', function () {
                const m = document.getElementById('no-internet-modal');
                if (m) m.className = 'popup-modal hidden';
                EPG.network.fetchEPGData(function (channels) {
                    if (channels && channels.length > 0) {
                        EPG.ui.renderEPG(channels);
                        EPG.state.channels = channels;
                    }
                });
            });
        }
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

console.log('modern-epg-ui.js loaded');