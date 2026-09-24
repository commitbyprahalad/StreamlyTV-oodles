/**
 * PopupManager — Unified Popup System for StreamlyTV
 * Samsung Tizen TV Web App
 *
 * Usage:
 *   PopupManager.showAlert("Message", callback)          // single OK
 *   PopupManager.showConfirm("Question?", cb, "Yes","No") // two buttons
 *   PopupManager.exit(callback)                       // "Exit app?" Cancel|Exit
 *   PopupManager.logout(callback)                     // "Logout?" Cancel|Logout
 *   PopupManager.session(callback)                    // "Session expired" OK
 *   PopupManager.noInternet(retryCallback)            // "No internet" Retry
 *
 * Key handling — pass from your page's keydown:
 *   if (PopupManager.isOpen()) {
 *     PopupManager.handleKey(keyCode);
 *     return;
 *   }
 *
 * Styling via PopupManager.css (NO page-specific popup HTML needed)
 */
const PopupManager = (function () {
    'use strict';

    // ─── Internal State ──────────────────────────────────────────────────────
    const _state = {
        isOpen: false,
        activeType: null,
        buttonCount: 0,
        focusedIndex: 0,
        callback: null,
        onCancel: null,
        restoreFocusEl: null,
        retryFn: null,
        overlay: null,
        initialized: false,
        videoElement: null,
        videoDisplay: ''
    };

    // ─── Tizen Hardware Video Plane Workaround ──────────────────────────────
    // On real Tizen TVs, the <video> element renders in a separate hardware
    // plane that sits ABOVE all DOM content, regardless of z-index.  When a
    // popup opens while the player is active, the popup is hidden behind the
    // video.  The fix: hide the video element before showing the popup and
    // restore it after the popup closes.

    function hideVideoForPopup() {
        const video = document.getElementById('video-player');
        if (video) {
            _state.videoElement = video;
            _state.videoDisplay = video.style.display;
            video.style.display = 'none';
        }
    }

    function restoreVideoAfterPopup() {
        if (_state.videoElement) {
            _state.videoElement.style.display = _state.videoDisplay || '';
            _state.videoElement = null;
            _state.videoDisplay = '';
        }
    }

    // ─── DOM Creation (lazy) ─────────────────────────────────────────────────
    function ensureOverlay() {
        if (_state.initialized) return;

        const overlay = document.createElement('div');
        overlay.id = 'pm-overlay';
        overlay.className = 'pm-overlay';
        overlay.innerHTML =
            '<div class="pm-box">' +
            '  <div class="pm-icon" id="pm-icon" style="display:none">' +
            '    <img id="pm-icon-img" alt="" />' +
            '  </div>' +
            '  <p class="pm-message" id="pm-message"></p>' +
            '  <div class="pm-buttons" id="pm-buttons"></div>' +
            '</div>';

        document.body.appendChild(overlay);
        _state.overlay = overlay;
        _state.initialized = true;
    }

    // ─── Show ────────────────────────────────────────────────────────────────
    function show(type, message, buttons, callback, onCancel, defaultFocus, icon) {
        ensureOverlay();

        // Cancel any previous
        hideInternal();

        _state.isOpen = true;
        _state.activeType = type;
        _state.callback = callback || null;
        _state.onCancel = onCancel || null;
        _state.buttonCount = buttons ? buttons.length : 0;
        _state.focusedIndex = (defaultFocus !== undefined && defaultFocus !== null) ? defaultFocus : 0;
        _state.retryFn = null;

        // Save restore focus
        _state.restoreFocusEl = document.activeElement;

        // Icon
        const iconDiv = document.getElementById('pm-icon');
        const iconImg = document.getElementById('pm-icon-img');
        if (icon) {
            iconDiv.style.display = 'flex';
            iconImg.src = icon;
        } else {
            iconDiv.style.display = 'none';
        }

        // Message
        document.getElementById('pm-message').textContent = message;

        // Buttons
        const btnContainer = document.getElementById('pm-buttons');
        btnContainer.innerHTML = '';
        for (let i = 0; i < buttons.length; i++) {
            const btn = document.createElement('button');
            btn.className = 'pm-btn' + (i === _state.focusedIndex ? ' pm-focused' : '');
            btn.textContent = buttons[i].label || buttons[i];
            btn.setAttribute('data-index', i);

            btn.addEventListener('click', (function (idx) {
                return function () { hide(idx); };
            })(i));

            btnContainer.appendChild(btn);
        }

        // Hide video behind popup (Tizen hardware video plane workaround)
        hideVideoForPopup();

        // Show overlay — use both inline style AND class for maximum
        // compatibility across all Tizen TV versions (including older models
        // where CSS class-based display changes may not apply reliably).
        _state.overlay.style.display = 'flex';
        _state.overlay.classList.add('pm-active');

        // Focus first button
        focusButton(_state.focusedIndex);
    }

    function hideInternal() {
        // Restore video that was hidden for popup
        restoreVideoAfterPopup();
        if (_state.overlay) {
            _state.overlay.style.display = 'none';
            _state.overlay.classList.remove('pm-active');
        }
        _state.isOpen = false;
        _state.activeType = null;
        _state.callback = null;
        _state.onCancel = null;
        _state.retryFn = null;
    }

    function hide(buttonIndex) {
        const cb = _state.callback;
        const restore = _state.restoreFocusEl;

        hideInternal();

        if (cb) { cb(buttonIndex); }

        if (restore && restore.focus && typeof restore.focus === 'function') {
            try { restore.focus(); } catch (e) { }
        }
    }

    // ─── Focus ───────────────────────────────────────────────────────────────
    function focusButton(index) {
        const btns = _state.overlay.querySelectorAll('.pm-btn');
        btns.forEach(function (b) { b.classList.remove('pm-focused'); });
        if (btns[index]) {
            btns[index].classList.add('pm-focused');
            btns[index].focus();
        }
        _state.focusedIndex = index;
    }

    // // ─── Key Handler ─────────────────────────────────────────────────────────
    // function handleKey(keyCode) {
    //     if (!_state.isOpen) return false;

    //     if (keyCode === 37 || keyCode === 39) {
    //         const dir = (keyCode === 39) ? 1 : -1;
    //         const next = (_state.focusedIndex + dir + _state.buttonCount) % _state.buttonCount;
    //         focusButton(next);
    //         return true;
    //     }

    //     if (keyCode === 13) {
    //         hide(_state.focusedIndex);
    //         return true;
    //     }

    //     if (keyCode === 10009) {
    //         if (_state.onCancel) {
    //             const oc = _state.onCancel;
    //             const restore = _state.restoreFocusEl;
    //             hideInternal();
    //             oc();
    //             if (restore && restore.focus && typeof restore.focus === 'function') {
    //                 try { restore.focus(); } catch (e) { }
    //             }
    //         } else {
    //             hide(0);
    //         }
    //         return true;
    //     }

    //     return false;
    // }

    // ─── Key Handler ─────────────────────────────────────────────────────────
    function handleKey(keyCode) {
        if (!_state.isOpen) return false;

        if (keyCode === 37 || keyCode === 39) {
            handleHorizontalKey(keyCode);
            return true;
        }

        if (keyCode === 13) {
            hide(_state.focusedIndex);
            return true;
        }

        if (keyCode === 10009) {
            handleCancelKey();
            return true;
        }

        return false;
    }

    function handleHorizontalKey(keyCode) {
        const dir = (keyCode === 39) ? 1 : -1;
        const next = (_state.focusedIndex + dir + _state.buttonCount) % _state.buttonCount;
        focusButton(next);
    }

    function handleCancelKey() {
        if (!_state.onCancel) {
            hide(0);
            return;
        }

        const onCancel = _state.onCancel;
        const restoreFocusEl = _state.restoreFocusEl;

        hideInternal();
        onCancel();

        restoreFocus(restoreFocusEl);
    }

    function restoreFocus(element) {
        if (!element || typeof element.focus !== 'function') {
            return;
        }

        try {
            element.focus();
        } catch (error) {
            console.error('Failed to restore focus:', error);
        }
    }


    // ─── Public Convenience Methods ───────────────────────────────────────────

    function showAlert(message, callback) {
        show('alert', message, [{ label: 'OK' }], function () {
            if (callback) callback();
        }, null, 0);
    }

    function showConfirm(message, onConfirm, confirmLabel, cancelLabel) {
        confirmLabel = confirmLabel || 'Yes';
        cancelLabel = cancelLabel || 'Cancel';
        show('confirm', message,
            [{ label: cancelLabel }, { label: confirmLabel }],
            function (idx) {
                if (onConfirm) onConfirm(idx === 1);
            },
            function () {
                if (onConfirm) onConfirm(false);
            },
            0
        );
    }

    function exit(callback) {
        show('exit', 'Do you want to exit StreamlyTV?',
            [{ label: 'Cancel' }, { label: 'Exit' }],
            function (idx) {
                if (callback) callback(idx === 1);
            },
            function () { if (callback) callback(false); },
            0
        );
    }

    function logout(callback, message) {
        message = message || 'Are you sure you want to logout?';
        show('logout', message,
            [{ label: 'Cancel' }, { label: 'Logout' }],
            function (idx) {
                if (callback) callback(idx === 1);
            },
            function () { if (callback) callback(false); },
            0
        );
    }

    function session(callback, message) {
        message = message || 'Your session has expired. Please login again.';
        show('session', message, [{ label: 'OK' }], function () {
            if (callback) callback();
        }, null, 0);
    }

    function noInternet(retryCallback, message) {
        message = message || 'No internet connection. Please check your connection and try again.';
        _state.retryFn = retryCallback || null;
        show('nointernet', message,
            [{ label: 'Retry' }],
            function () {
                if (_state.retryFn) _state.retryFn();
            },
            null, 0,
            '../images/streamly/ic_no_wifi.png'
        );
    }

    function isOpen() {
        return _state.isOpen;
    }

    return {
        show: show,
        handleKey: handleKey,
        isOpen: isOpen,
        showAlert: showAlert,
        showConfirm: showConfirm,
        exit: exit,
        logout: logout,
        session: session,
        noInternet: noInternet
    };
})();