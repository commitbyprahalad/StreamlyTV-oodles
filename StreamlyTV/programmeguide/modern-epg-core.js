/**
 * Modern EPG Core Logic
 * Handles API calls, data management, and initialization
 * Legacy Compatible - Works on old and new Samsung Tizen TVs
 */
// ===== POLYFILLS FOR OLD TVs =====
if (!Array.prototype.forEach) {
    Array.prototype.forEach = function (callback, thisArg) {
        for (let i = 0; i < this.length; i++) {
            callback.call(thisArg, this[i], i, this);
        }
    };
}

if (!Array.prototype.map) {
    Array.prototype.map = function (callback, thisArg) {
        const result = [];
        for (let i = 0; i < this.length; i++) {
            result.push(callback.call(thisArg, this[i], i, this));
        }
        return result;
    };
}

if (!Array.prototype.filter) {
    Array.prototype.filter = function (callback, thisArg) {
        const result = [];
        for (let i = 0; i < this.length; i++) {
            if (callback.call(thisArg, this[i], i, this)) {
                result.push(this[i]);
            }
        }
        return result;
    };
}

if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (searchElement) {
        for (let i = 0; i < this.length; i++) {
            if (this[i] === searchElement) return i;
        }
        return -1;
    };
}

if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return this.replace(/^\s+|\s+$/g, '');
    };
}

// Date.now polyfill for very old Tizen engines
if (!Date.now) {
    Date.now = function () { return new Date().getTime(); };
}

if (typeof console === 'undefined') {
    window.console = { log: function () { }, error: function () { }, warn: function () { } };
}

// ===== SESSION EXPIRE POPUP HANDLER =====
window.showSessionExpirePopup = function () {
    localStorage.setItem('session_expire', 'session_expire');
    PopupManager.session(function () {
        localStorage.clear();
        window.location.href = '../guide/guide.html';
    }, 'Your session has expired. Please login again.');
};

// ===== SUBSCRIPTION EXPIRE POPUP HANDLER =====
window.showSubscriptionExpirePopup = function (message) {
    const msg = message || 'Your subscription has expired. Please visit https://streamlytv.com to update your plan.';
    PopupManager.showAlert(msg, function () {
        localStorage.clear();
        window.location.href = '../guide/guide.html';
    });
};

// ===== GLOBAL CONFIGURATION =====
const EPG = window.EPG || {};

EPG.config = {
    API_URL: API.EPG_GUIDE_V2,
    PAGE_LIMIT: 20, // channels per EPG page
    PAGE_RETRY_MAX: 3, // quiet retries for a failed background page
    PROGRAM_DETAILS_URL: API.PROGRAM_DETAILS,
    DRM_URL: API.DRM_KEY,
    GENRE_URL: API.ALL_GENRE,
    PIXELS_PER_MINUTE: 10, // Width per minute for programs
    TIME_SLOT_WIDTH: 300, // Width of each 30-minute slot
    TIME_SLOT_DURATION: 30 * 60 // 30 minutes in seconds
};

EPG.state = {
    channels: [],
    currentTime: null,
    firstSlotTime: null,
    jwt: localStorage.getItem('jwt token'),
    bodyData: { genre: '', day: 'today', typeurl: 'mpd', zipcode: localStorage.getItem('streamly_zipcode') || '302020' },
    drmData: null,
    // v2 EPG pagination. generation invalidates in-flight pages when the
    // guide is re-fetched (retry after a network error).
    paging: { page: 0, hasMore: false, loading: false, retries: 0, generation: 0 }
};

// ===== UTILITY FUNCTIONS =====

EPG.utils = {
    // Format Unix timestamp to readable time
    formatTime: function (unixTime) {
        const date = new Date(unixTime * 1000);
        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return hours + ':' + minutes + ' ' + ampm;
    },

    // Format duration (ISO 8601)
    formatDuration: function (isoDuration) {
        if (!isoDuration) return 'Duration not available';
        const regex = /PT(\d+H)?(\d+M)?/;
        const matches = isoDuration.match(regex);
        if (!matches) return 'Duration not available';
        const hours = matches[1] ? parseInt(matches[1].replace('H', '')) : 0;
        const minutes = matches[2] ? parseInt(matches[2].replace('M', '')) : 0;
        return hours + ' HR ' + minutes + ' MIN';
    },

    // Calculate program width in pixels
    calculateProgramWidth: function (start, end, firstSlotTime) {
        const startTime = new Date(start * 1000).getTime();
        const endTime = new Date(end * 1000).getTime();
        const firstSlotTimeMs = new Date(firstSlotTime * 1000).getTime();

        const programDurationMinutes = (endTime - startTime) / (1000 * 60);
        let programWidth = programDurationMinutes * EPG.config.PIXELS_PER_MINUTE;

        // Adjust if program started before first slot
        if (startTime < firstSlotTimeMs) {
            const minutesBehind = (firstSlotTimeMs - startTime) / (1000 * 60);
            programWidth -= minutesBehind * EPG.config.PIXELS_PER_MINUTE;
        }

        return Math.max(0, programWidth);
    },

    // Calculate program left offset
    calculateProgramOffset: function (start, firstSlotTime) {
        const startTime = new Date(start * 1000).getTime();
        const firstSlotTimeMs = new Date(firstSlotTime * 1000).getTime();

        if (startTime < firstSlotTimeMs) return 0;

        const minutesFromFirst = (startTime - firstSlotTimeMs) / (1000 * 60);
        return Math.max(0, minutesFromFirst * EPG.config.PIXELS_PER_MINUTE);
    },

    // Check if program is currently playing
    isProgramLive: function (start, end) {
        const now = Math.floor(Date.now() / 1000);
        return start <= now && now <= end;
    },

    // Group schedules by Today/Tomorrow
    groupSchedulesByDate: function (schedule) {
        const grouped = { Today: [], Tomorrow: [] };
        const currentDate = new Date();

        for (let i = 0; i < schedule.length; i++) {
            const item = schedule[i];
            const programDate = new Date(item.start * 1000);
            const dateInfo = this.formatDateTime(item.start);

            if (dateInfo.prefix === 'Today') {
                grouped.Today.push(dateInfo.formattedTime);
            } else if (dateInfo.prefix === 'Tomorrow') {
                grouped.Tomorrow.push(dateInfo.formattedTime);
            }
        }

        return grouped;
    },

    // Format date and time with prefix
    formatDateTime: function (startTimestamp) {
        const date = new Date(startTimestamp * 1000);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        let prefix = '';
        if (date.toDateString() === today.toDateString()) {
            prefix = 'Today';
        } else if (date.toDateString() === tomorrow.toDateString()) {
            prefix = 'Tomorrow';
        }

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const formattedDate = days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate();

        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        const formattedTime = hours + ':' + minutes + ' ' + ampm;

        return { prefix: prefix, formattedDate: formattedDate, formattedTime: formattedTime };
    }
};

// ===== NETWORK FUNCTIONS =====

EPG.network = {
    // Check internet connectivity
    checkInternet: function (callback) {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', 'https://www.google.com/favicon.ico', true);
        xhr.timeout = 5000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                callback(xhr.status >= 200 && xhr.status < 300);
            }
        };

        xhr.onerror = function () { callback(false); };
        xhr.ontimeout = function () { callback(false); };

        try {
            xhr.send();
        } catch (e) {
            callback(false);
        }
    },

    // Request one page of the paginated v2 EPG guide.
    //   onSuccess(channels, hasMore)
    //   onError(kind)  kind: 'network' | 'timeout' | 'http' | 'parse' | 'auth'
    // 'auth' means the session/subscription popup has already been shown.
    requestEPGPage: function (page, timeoutMs, onSuccess, onError) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', EPG.config.API_URL, true);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + EPG.state.jwt);
        xhr.timeout = timeoutMs;

        let done = false;
        function fail(kind) {
            if (done) return;
            done = true;
            onError(kind);
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || done) return;

            // Status 0 = request failed at network level (CORS, aborted, etc.)
            // onerror / ontimeout report it.
            if (xhr.status === 0) return;

            if (xhr.status === 401) {
                done = true;
                showSessionExpirePopup();
                onError('auth');
                return;
            }
            if (xhr.status !== 200) {
                console.error('EPG HTTP error:', xhr.status);
                fail('http');
                return;
            }

            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error('EPG JSON parse error:', e);
                fail('parse');
                return;
            }

            // Check for auth/subscription errors in response body
            if (data.response_code === 401) {
                done = true;
                showSessionExpirePopup();
                onError('auth');
                return;
            }
            if (data.response_code === 410) {
                done = true;
                showSubscriptionExpirePopup(data.subscribedmsgis || data.message);
                onError('auth');
                return;
            }
            if (!data.success || data.response_code !== 200 || !data.data) {
                fail('http');
                return;
            }

            // Channels are normally data.data; tolerate a nested wrapper.
            const payload = data.data;
            let list = [];
            if (Array.isArray(payload)) {
                list = payload;
            } else if (Array.isArray(payload.data)) {
                list = payload.data;
            } else if (Array.isArray(payload.channels)) {
                list = payload.channels;
            }

            let hasMore = data.has_more;
            if (hasMore === undefined && !Array.isArray(payload)) hasMore = payload.has_more;
            hasMore = hasMore === true || hasMore === 'true' || hasMore === 1 || hasMore === '1';
            // An empty page can never have more after it; avoids an endless loop.
            if (!list.length) hasMore = false;

            done = true;
            onSuccess(list, hasMore);
        };

        xhr.onerror = function () { fail('network'); };
        xhr.ontimeout = function () { fail('timeout'); };

        try {
            xhr.send(JSON.stringify({
                typeurl: EPG.state.bodyData.typeurl,
                genre: EPG.state.bodyData.genre,
                page: page,
                limit: EPG.config.PAGE_LIMIT,
                zipcode: EPG.state.bodyData.zipcode
            }));
        } catch (e) {
            fail('network');
        }
    },

    // Fetch EPG data (page 1). The callback receives the first page right
    // away so the guide renders fast; later pages are loaded in the
    // background and appended via EPG.ui.appendChannels().
    fetchEPGData: function (callback) {
        console.log('Fetching EPG data...', EPG.state.bodyData);

        const paging = EPG.state.paging;
        paging.generation++;
        paging.page = 0;
        paging.hasMore = false;
        paging.loading = false;
        paging.retries = 0;
        const generation = paging.generation;
        EPG.ui._pendingChannels = []; // drop queued pages of a previous load

        EPG.ui.showLoading();

        EPG.network.requestEPGPage(1, 30000, function (channels, hasMore) {
            if (generation !== paging.generation) return;
            EPG.ui.hideLoading();

            paging.page = 1;
            paging.hasMore = hasMore;
            EPG.state.channels = channels;
            if (callback) callback(channels);

            if (hasMore) {
                setTimeout(function () { EPG.network.loadNextPage(); }, 50);
            }
        }, function (kind) {
            if (generation !== paging.generation) return;
            EPG.ui.hideLoading();
            if (kind === 'auth' || kind === 'http' || kind === 'parse') return;

            const msg = kind === 'timeout'
                ? 'Request timed out. Please try again.'
                : 'Network error. Please check your connection and try again.';
            PopupManager.showAlert(msg, function () {
                EPG.network.fetchEPGData(callback);
            });
        });
    },

    // Load the next EPG page in the background and append it to the guide.
    // Keeps going while the API reports has_more. Failures retry quietly
    // (the first page is already on screen); navigating to the last loaded
    // row calls this again, which also restarts a stalled load.
    loadNextPage: function (userTriggered) {
        const paging = EPG.state.paging;
        if (!paging.hasMore || paging.loading) return;
        if (userTriggered) paging.retries = 0;

        paging.loading = true;
        const generation = paging.generation;
        const nextPage = paging.page + 1;

        EPG.network.requestEPGPage(nextPage, 20000, function (channels, hasMore) {
            if (generation !== paging.generation) return;
            paging.loading = false;
            paging.retries = 0;
            paging.page = nextPage;
            paging.hasMore = hasMore;

            if (channels.length && typeof EPG.ui.appendChannels === 'function') {
                EPG.ui.appendChannels(channels);
            }
            if (hasMore) {
                setTimeout(function () { EPG.network.loadNextPage(); }, 50);
            }
        }, function (kind) {
            if (generation !== paging.generation) return;
            paging.loading = false;
            if (kind === 'auth') {
                paging.hasMore = false;
                return;
            }
            paging.retries++;
            if (paging.retries <= EPG.config.PAGE_RETRY_MAX) {
                setTimeout(function () {
                    if (generation === paging.generation) EPG.network.loadNextPage();
                }, 2000 * paging.retries);
            }
        });
    },

    // Fetch program details
    // No separate connectivity pre-check (it cost an extra round trip to
    // google.com on every call); a network failure shows the same
    // no-internet popup instead.
    fetchProgramDetails: function (channelId, tmsId, callback) {
        //console.log('Fetching program details:', { channelId: channelId, tmsId: tmsId });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', EPG.config.PROGRAM_DETAILS_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + EPG.state.jwt);
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 401) {
                    //console.error('⚠️ Session expired (401 Unauthorized)');
                    showSessionExpirePopup(); // ✅ Call popup function
                    return;
                }

                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);

                        // Check for session/subscription expired in response body
                        if (data.response_code === 401) {
                            showSessionExpirePopup();
                            return;
                        }
                        if (data.response_code === 410) {
                            showSubscriptionExpirePopup(data.subscribedmsgis || data.message);
                            return;
                        }

                        //console.log('Program details received');
                        if (callback) callback(data.data);
                    } catch (e) {
                        //console.error('JSON parse error:', e);
                    }
                } else {
                    //console.error('HTTP error:', xhr.status);
                }
            }
        };

        const onNetworkFail = function () {
            if (typeof EPG.ui.showNoInternet === 'function') {
                EPG.ui.showNoInternet();
            }
        };
        xhr.onerror = onNetworkFail;
        xhr.ontimeout = onNetworkFail;

        try {
            xhr.send(JSON.stringify({ channel_id: channelId, TMSId: tmsId }));
        } catch (e) {
            //console.error('Send error:', e);
        }
    },

    // Fetch DRM keys
    fetchDRMKeys: function (callback) {
        // console.log('Fetching DRM keys...');

        const xhr = new XMLHttpRequest();
        xhr.open('GET', EPG.config.DRM_URL, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + EPG.state.jwt);
        xhr.timeout = 15000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 401) {
                    // console.error('⚠️ Session expired (401 Unauthorized)');
                    showSessionExpirePopup(); // ✅ Call popup function
                    return;
                }

                if (xhr.status === 200) {
                    try {
                        const result = JSON.parse(xhr.responseText);
                        //console.log('DRM keys received');

                        if (result.data) {
                            localStorage.setItem('drmData', result.data);
                            if (result.widevinelicense) localStorage.setItem('widevinelicense', result.widevinelicense);
                            if (result.playreadylicense) localStorage.setItem('playreadylicense', result.playreadylicense);
                            EPG.state.drmData = result;
                            if (callback) callback(result);
                        }
                    } catch (e) {
                        // console.error('JSON parse error:', e);
                    }
                }
            }
        };

        xhr.onerror = function () {
            //console.error('Network error');
        };

        try {
            xhr.send();
        } catch (e) {
            //console.error('Send error:', e);
        }
    }
};

// ===== TIME MANAGEMENT =====

EPG.time = {
    // Get current time rounded to nearest 30 minutes
    getRoundedCurrentTime: function () {
        const now = new Date();
        now.setSeconds(0);
        now.setMilliseconds(0);

        const minutes = now.getMinutes();
        if (minutes < 30) {
            now.setMinutes(0);
        } else {
            now.setMinutes(30);
        }

        return now;
    },

    // Generate time slots for 48 hours
    generateTimeSlots: function () {
        const slots = [];
        // Always start from the CURRENT rounded half-hour so past slots are never shown
        const startTime = this.getRoundedCurrentTime();
        EPG.state.firstSlotTime = Math.floor(startTime.getTime() / 1000);

        const currentTime = new Date(startTime);

        for (let i = 0; i < 96; i++) { // 48 hours = 96 slots of 30 min
            slots.push({
                time: Math.floor(currentTime.getTime() / 1000),
                label: EPG.utils.formatTime(Math.floor(currentTime.getTime() / 1000)),
                isTomorrow: i >= 48
            });
            currentTime.setMinutes(currentTime.getMinutes() + 30);
        }

        return slots;
    },

    // Update day indicator based on scroll position
    updateDayIndicator: function () {
        const programGrid = document.getElementById('program-grid');
        const dayIndicator = document.getElementById('day-indicator');

        if (!programGrid || !dayIndicator) return;

        const scrollLeft = programGrid.scrollLeft;
        const slotWidth = 300; // Each 30-min slot is 300px
        const slotsPerDay = 48; // 48 slots = 24 hours
        const oneDayWidth = slotWidth * slotsPerDay; // 14,400px

        // If scrolled past first day, show Tomorrow
        if (scrollLeft > oneDayWidth) {
            dayIndicator.textContent = 'Tomorrow';
            dayIndicator.className = 'day-indicator tomorrow';
        } else {
            dayIndicator.textContent = 'Today';
            dayIndicator.className = 'day-indicator today';
        }
    },

    // Update current time display
    updateCurrentTimeDisplay: function () {
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            const now = new Date();
            timeElement.textContent = EPG.utils.formatTime(Math.floor(now.getTime() / 1000));
        }
    }
};

// ===== SUB-SESSION STORE =====

/**
 * Collect the latest device + app metadata from Tizen WebAPIs and POST it to
 * the sub-session/store endpoint.  Called every time the EPG screen loads so
 * the backend always has fresh information, even after an app update.
 *
 * API: POST API.SUB_SESSION_STORE
 * Auth: Bearer <jwt token>
 * Body (multipart/form-data):
 *   platform         – "Samsung <ModelName>"
 *   device_model     – "<ModelName>"
 *   build_version    – Tizen platform version (e.g. "6.5")
 *   device_os_version – Tizen OS version string (e.g. "6.5.0")
 *
 * All Tizen API calls are wrapped in try/catch so a missing capability on
 * older TV models never breaks the EPG load.
 */
EPG.network.storeSubSession = function () {
    const jwt = EPG.state.jwt;
    if (!jwt) {
        console.warn('storeSubSession: no JWT – skipping');
        return;
    }

    // ── Collect device metadata ──────────────────────────────────────────
    let modelName = 'Unknown';
    let buildVersion = 'Unknown';
    let osVersion = 'Unknown';

    try {
        if (typeof webapis !== 'undefined' && webapis.productinfo) {
            modelName = webapis.productinfo.getModel() || 'Unknown';
        }
    } catch (e) {
        //console.warn('storeSubSession: getModel() failed –', e.message || e);
    }

    try {
        if (typeof webapis !== 'undefined' && webapis.tvinfo) {
            buildVersion = webapis.tvinfo.getVersion() || 'Unknown';
        }
    } catch (e) {
        // console.warn('storeSubSession: tvinfo.getVersion() failed –', e.message || e);
    }

    try {
        if (typeof tizen !== 'undefined' && tizen.systeminfo) {
            osVersion = tizen.systeminfo.getCapability(
                'http://tizen.org/feature/platform.version'
            ) || buildVersion;
        }
    } catch (e) {
        //console.warn('storeSubSession: platform.version capability failed –', e.message || e);
        osVersion = buildVersion; // fall back to build version
    }

    const platform = 'Samsung ' + modelName;

    // console.log('storeSubSession – platform:', platform,
    //    '| model:', modelName,
    //    '| build:', buildVersion,
    //    '| os:', osVersion);

    // ── Build multipart payload (matches the cURL contract exactly) ───────
    const formData = new FormData();
    formData.append('platform', platform);
    formData.append('device_model', modelName);
    formData.append('build_version', buildVersion);
    formData.append('device_os_version', osVersion);

    // ── Fire-and-forget – EPG load must not be blocked by this call ───────
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API.SUB_SESSION_STORE, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + jwt);
    xhr.timeout = 10000;

    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200 || xhr.status === 201) {
            console.log('storeSubSession: metadata updated successfully');
        } else if (xhr.status === 401) {
            showSessionExpirePopup();
        } else {
            //console.warn('storeSubSession: unexpected status', xhr.status);
        }
    };

    xhr.onerror = function () { console.warn('storeSubSession: network error'); };
    xhr.ontimeout = function () { console.warn('storeSubSession: request timed out'); };

    try {
        xhr.send(formData);
    } catch (e) {
        // console.error('storeSubSession: send() threw –', e.message || e);
    }
};

// ===== INITIALIZATION =====

EPG.init = function () {
    // If session was marked expired by another screen, show popup immediately
    if (localStorage.getItem('session_expire') === 'session_expire') {
        showSessionExpirePopup();
        return;
    }

    // Guard: device name setup not completed yet
    if (localStorage.getItem("personaldevicename_popup") === "true") {
        location.href = "../personaldevice/personaldevice.html";
        return;
    }
    // Check JWT token
    if (!EPG.state.jwt) {
        console.error('No JWT token found');
        window.location.href = '../login/login.html';
        return;
    }

    // Refresh device + app metadata on every EPG load (post-login / post-update)
    EPG.network.storeSubSession();

    // Validate session on app start — if expired, addtorecent will show the popup
    if (typeof AuthSession !== 'undefined' && AuthSession.addToRecentCheck) {
        AuthSession.addToRecentCheck(function (result) {
            if (result === 'expired') {
                // Popup is already shown by AuthSession — stop further init
                return;
            }
        });
    }

    // Update current time every minute
    EPG.time.updateCurrentTimeDisplay();
    setInterval(function () {
        EPG.time.updateCurrentTimeDisplay();
    }, 60000);

    // Auto-hide past slots: fire exactly at each :00 and :30 boundary,
    // then repeat every 30 minutes precisely on the clock.
    (function scheduleSlotRefresh() {
        // Calculate ms remaining until the next :00 or :30 mark
        const now = new Date();
        const mins = now.getMinutes();
        const secs = now.getSeconds();
        const ms = now.getMilliseconds();
        const minsUntilNext = mins < 30 ? (30 - mins) : (60 - mins);
        const msUntilNext = (minsUntilNext * 60 - secs) * 1000 - ms;

        setTimeout(function () {
            // Fire once at the boundary, then every 30 min on the dot
            function doRefresh() {
                if (EPG.state.channels && EPG.state.channels.length > 0) {
                    EPG.time.generateTimeSlots();

                    if (typeof EPG.ui.renderTimeHeader === 'function') {
                        EPG.ui.renderTimeHeader();
                    }
                    if (typeof EPG.ui.renderProgramGrid === 'function') {
                        EPG.ui.renderProgramGrid(EPG.state.channels);
                    }

                    const programGrid = document.getElementById('program-grid');
                    const timeHeader = document.getElementById('time-header');
                    if (programGrid) programGrid.scrollLeft = 0;
                    if (timeHeader) timeHeader.scrollLeft = 0;

                    if (typeof EPG.ui.syncLiveIndicatorVisibility === 'function') {
                        EPG.ui.syncLiveIndicatorVisibility();
                    }
                    if (typeof EPG.ui.updateDayIndicator === 'function') {
                        EPG.ui.updateDayIndicator();
                    }
                }
            }

            doRefresh(); // fire immediately at the boundary
            setInterval(doRefresh, 30 * 60 * 1000); // then every 30 min exactly
        }, msUntilNext);
    })();

    // Fetch DRM keys
    EPG.network.fetchDRMKeys();

    // Detect zipcode dynamically and then fetch EPG data
    GeoLocation.getZipCode(function (zipcode) {
        EPG.state.bodyData.zipcode = zipcode;
        EPG.network.fetchEPGData(function (channels) {
            if (channels && channels.length > 0) {
                //console.log('Rendering', channels.length, 'channels');
                if (typeof EPG.ui.renderEPG === 'function') {
                    EPG.state.channels = channels;
                    EPG.ui.renderEPG(channels);
                }
            }
        });
    });

    console.log('EPG Core initialized');
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', EPG.init);
    } else if (document.attachEvent) {
        document.attachEvent('onreadystatechange', function () {
            if (document.readyState === 'complete') EPG.init();
        });
    }
} else {
    EPG.init();
}

console.log('EPG Core loaded');