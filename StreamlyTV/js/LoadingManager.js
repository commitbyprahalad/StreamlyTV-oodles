/**
 * LoadingManager — Unified Loading/Spinner System for StreamlyTV
 * Samsung Tizen TV Web App
 *
 * Usage:
 *   LoadingManager.show()    // show full-screen loading overlay
 *   LoadingManager.hide()    // hide it
 *   LoadingManager.isVisible()
 *
 * Styling via LoadingManager.css (no page-specific spinner HTML needed)
*/
const LoadingManager = (function () {
    'use strict';

    let _overlay = null;
    let _initialized = false;

    function ensureOverlay() {
        if (_initialized) return;

        _overlay = document.createElement('div');
        _overlay.id = 'lm-overlay';
        _overlay.className = 'lm-overlay';
        _overlay.innerHTML =
            '<div class="lm-box">' +
            '  <div class="lm-spinner"></div>' +
            '  <p class="lm-text">Loading...</p>' +
            '</div>';

        document.body.appendChild(_overlay);
        _initialized = true;
    }

    function show() {
        ensureOverlay();
        _overlay.classList.add('lm-active');
    }

    function hide() {
        if (_overlay) {
            _overlay.classList.remove('lm-active');
        }
    }

    function isVisible() {
        return _overlay && _overlay.classList.contains('lm-active');
    }

    return {
        show: show,
        hide: hide,
        isVisible: isVisible
    };
})();