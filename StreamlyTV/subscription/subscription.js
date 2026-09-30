/**
 * StreamlyTV – Subscription Module
 * Tizen Samsung TV Web App
 *
 * Opened from login (410) and from index.html on relaunch while the account
 * is still blocked (see AuthSession.goToSubscriptionScreen). The screen shown
 * comes from POST /auth/subscription/check:
 *
 *   custom          Custom user: previous plan (devices + expiry) and a plan
 *                   request to the service provider. A request "under_review"
 *                   disables Request Now until the provider approves/rejects.
 *   renewal_failed  Web user whose auto-renewal payment failed: QR to the
 *                   website + Cancel Subscription (password -> confirm ->
 *                   cancel), which then shows the "expired" screen.
 *   expired         Web user with an expired plan: QR to the website + Refresh.
 *
 * The status is re-checked every 30s, so an approval / web payment moves the
 * user on to the app without pressing anything.
 */
const SubscriptionScreen = (function () {
    'use strict';

    const KEYS = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
        BACK: 10009, EXIT: 10182, IME_DONE: 65376, IME_CANCEL: 65385
    };

    const POLL_INTERVAL_MS = 30000;

    // Stripe statuses meaning a renewal charge failed but the subscription
    // hasn't been cancelled yet (a cancelled/ended one reports "expired").
    const RENEWAL_FAILED_STATUSES = ['past_due', 'unpaid', 'incomplete'];

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];

    const QR_SCREENS = {
        renewal_failed: {
            title: 'Subscription Renewal Failed',
            message: 'We couldn’t renew your subscription due to a payment issue. ' +
                'Please follow the steps below to continue watching on StreamlyTV.',
            showVisit: false,
            steps: [
                ['fa-ban', 'Cancel the current plan'],
                ['fa-qrcode', 'Scan the QR code and sign in'],
                ['fa-credit-card', 'Renew with a new plan to continue streaming on TV']
            ],
            primaryHtml: '<i class="fas fa-exclamation-circle"></i> Cancel Subscription'
        },
        expired: {
            title: 'Subscription Expired',
            message: 'Your subscription has expired. Renew your plan to continue watching.',
            showVisit: true,
            steps: [
                ['fa-qrcode', 'Scan the QR code'],
                ['fa-user', 'Login & choose the plan'],
                ['fa-credit-card', 'Complete the payment']
            ],
            primaryHtml: '<i class="fas fa-sync-alt"></i> Refresh'
        }
    };

    const state = {
        jwt: null,
        userId: null,
        mode: null, // 'custom' | 'renewal_failed' | 'expired'
        lastData: null,
        cancelled: false, // subscription cancelled on this screen -> always "expired"
        plans: null,
        plansLoading: false,
        selectedPlanId: null,
        requestStatus: null, // plan_request.status: 'under_review' | 'rejected' | ...
        pollTimer: null,
        isPwdOpen: false,
        isKeypadOpen: false
    };

    const dom = {};

    // ─── API ────────────────────────────────────────────────────────────────
    // Parses the body on any HTTP status: check / verify-password return
    // meaningful JSON on 410 / 422. 401 goes to the shared session handler.
    // callback(data) gets null on network / parse failure.
    function request(method, url, body, callback) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + state.jwt);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.timeout = 15000;

        let finished = false;
        function finish(data) {
            if (finished) return;
            finished = true;
            callback(data);
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || xhr.status === 0) return;
            let data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error('Subscription: could not parse response from ' + url, e);
            }
            if (xhr.status === 401 || (data && Number(data.response_code) === 401)) {
                finished = true;
                LoadingManager.hide();
                stopPolling();
                AuthSession.handleSessionExpired();
                return;
            }
            finish(data);
        };
        xhr.onerror = function () { finish(null); };
        xhr.ontimeout = function () { finish(null); };

        try {
            xhr.send(body || null);
        } catch (e) {
            finish(null);
        }
    }

    function isApiSuccess(data) {
        if (!data) return false;
        if (data.success === true || data.status === true || data.status === 'success') return true;
        return data.success !== false && Number(data.response_code) === 200;
    }

    function isSubscriptionActive(data) {
        return !!data && data.success === true && Number(data.response_code) === 200;
    }

    // ─── Status ─────────────────────────────────────────────────────────────
    // source: 'init' | 'refresh' | 'poll'
    function loadStatus(source) {
        if (source !== 'poll') LoadingManager.show();

        request('POST', API.SUBSCRIPTION_CHECK, null, function (data) {
            if (source !== 'poll') LoadingManager.hide();

            if (!data) {
                if (source === 'poll') return; // try again on the next tick
                PopupManager.noInternet(function () { loadStatus(source); },
                    'Unable to check your subscription. Please check your connection and try again.');
                return;
            }
            applyStatus(data, source);
        });
    }

    function applyStatus(data, source) {
        if (isSubscriptionActive(data)) {
            stopPolling();
            if (source === 'poll') {
                const msg = state.mode === 'custom'
                    ? 'Your subscription request has been approved.'
                    : 'Your subscription is active again.';
                PopupManager.showAlert(msg, AuthSession.continueAfterLogin);
            } else {
                AuthSession.continueAfterLogin();
            }
            return;
        }

        const mode = resolveMode(data);
        const requestStatus = mode === 'custom' ? getRequestStatus(data) : null;

        if (source === 'poll') {
            // Only redraw when something the user can see changed, and never
            // underneath an open popup / password prompt.
            const changed = mode !== state.mode || requestStatus !== state.requestStatus;
            if (!changed || PopupManager.isOpen() || state.isPwdOpen) return;
        }

        render(mode, data);

        if (source === 'refresh' && mode !== 'custom') {
            PopupManager.showAlert('Your subscription is not active yet. Complete the payment on the website, then press Refresh.');
        }
    }

    function resolveMode(data) {
        if (data.custom_subscription_expired === true || localStorage.getItem('is_custom_user') === '1') {
            return 'custom';
        }
        const stripeStatus = String(data.stripe_status || '').toLowerCase();
        if (!state.cancelled && RENEWAL_FAILED_STATUSES.indexOf(stripeStatus) !== -1) {
            return 'renewal_failed';
        }
        return 'expired';
    }

    function getRequestStatus(data) {
        return (data.plan_request && data.plan_request.status) || null;
    }

    function startPolling() {
        if (state.pollTimer) return;
        state.pollTimer = setInterval(function () {
            if (PopupManager.isOpen() || state.isPwdOpen || LoadingManager.isVisible()) return;
            if (state.mode === 'custom' && !state.plans) loadPlans();
            loadStatus('poll');
        }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    // ─── Render ─────────────────────────────────────────────────────────────
    function render(mode, data) {
        state.mode = mode;
        state.lastData = data;

        const isCustom = mode === 'custom';
        dom.customLeft.style.display = isCustom ? 'flex' : 'none';
        dom.customRight.style.display = isCustom ? 'block' : 'none';
        dom.qrLeft.style.display = isCustom ? 'none' : 'flex';
        dom.qrRight.style.display = isCustom ? 'none' : 'block';
        dom.card.style.display = 'block';

        if (isCustom) {
            renderCustom(data);
        } else {
            renderQR(QR_SCREENS[mode], data);
        }

        startPolling();
        focusDefault();
    }

    function renderCustom(data) {
        dom.title.textContent = 'Subscription Expired';
        dom.prevExpiry.textContent = 'Expired on ' + formatDate(data.custom_subscription_expired_at);
        dom.prevDevices.textContent = (data.device_limit !== undefined && data.device_limit !== null)
            ? String(data.device_limit) : '-';

        state.requestStatus = getRequestStatus(data);
        if (state.requestStatus === 'under_review' && data.plan_request.plan_id) {
            state.selectedPlanId = Number(data.plan_request.plan_id);
        }
        dom.requestNote.textContent = state.requestStatus === 'rejected'
            ? 'Your previous request was rejected. Please select a plan and request again.'
            : '';

        if (state.plans) {
            renderPlans();
        } else {
            loadPlans();
        }
        updateRequestButton();
    }

    function renderQR(screen, data) {
        dom.title.textContent = screen.title;
        dom.qrMessage.textContent = screen.message;

        dom.qrVisit.innerHTML = '';
        if (screen.showVisit) {
            dom.qrVisit.appendChild(document.createTextNode('Visit '));
            dom.qrVisit.appendChild(highlight(websiteHost(data.url)));
            dom.qrVisit.appendChild(document.createTextNode(' or Scan the '));
            dom.qrVisit.appendChild(highlight('QR Code'));
        }

        dom.qrSteps.innerHTML = '';
        for (let i = 0; i < screen.steps.length; i++) {
            dom.qrSteps.appendChild(buildStep(screen.steps[i][0], screen.steps[i][1]));
        }

        const qrcode = data.qrcode || localStorage.getItem('subscription_qrcode');
        if (qrcode) {
            localStorage.setItem('subscription_qrcode', qrcode);
            if (dom.qrImage.getAttribute('src') !== qrcode) dom.qrImage.src = qrcode;
        }

        dom.primaryBtn.disabled = false;
        dom.primaryBtn.innerHTML = screen.primaryHtml;
    }

    function highlight(text) {
        const span = document.createElement('span');
        span.className = 'sub-highlight';
        span.textContent = text;
        return span;
    }

    function buildStep(iconClass, text) {
        const li = document.createElement('li');
        const icon = document.createElement('span');
        icon.className = 'sub-step-icon';
        icon.innerHTML = '<i class="fas ' + iconClass + '"></i>';
        li.appendChild(icon);
        li.appendChild(document.createTextNode(text));
        return li;
    }

    function websiteHost(url) {
        const host = String(url || 'https://streamlytv.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        return host.indexOf('www.') === 0 ? host : 'www.' + host;
    }

    // "2026-09-25 05:54:05" -> "September 25, 2026". Parsed by hand: older
    // Tizen engines don't parse this format with Date().
    function formatDate(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
        if (!m) return '-';
        return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
    }

    // ─── Custom: plans ──────────────────────────────────────────────────────
    function loadPlans() {
        if (state.plansLoading) return;
        state.plansLoading = true;
        dom.planGrid.innerHTML = '<div class="plan-grid-empty">Loading plans...</div>';

        request('GET', API.CUSTOM_SUBSCRIPTION_PLANS, null, function (data) {
            state.plansLoading = false;
            if (!data || !data.data || !data.data.length) {
                // Retried on the next status poll (see startPolling).
                dom.planGrid.innerHTML = '<div class="plan-grid-empty">Unable to load plans. Retrying shortly...</div>';
                return;
            }
            state.plans = data.data
                .filter(function (p) { return Number(p.status) === 1; })
                .sort(function (a, b) { return Number(a.interval_count) - Number(b.interval_count); });
            renderPlans();
            focusDefault();
        });
    }

    function planLabel(plan) {
        const count = Number(plan.interval_count) || 1;
        return count + ' ' + (plan.interval || 'month') + (count > 1 ? 's' : '');
    }

    function findPlan(id) {
        for (let i = 0; i < (state.plans || []).length; i++) {
            if (Number(state.plans[i].id) === Number(id)) return state.plans[i];
        }
        return null;
    }

    function renderPlans() {
        const locked = state.requestStatus === 'under_review';
        dom.planGrid.innerHTML = '';
        for (let i = 0; i < state.plans.length; i++) {
            const plan = state.plans[i];
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'plan-card' + (Number(plan.id) === state.selectedPlanId ? ' selected' : '');
            card.id = 'plan-card-' + plan.id;
            card.setAttribute('data-plan-id', plan.id);
            card.disabled = locked;
            card.innerHTML = '<i class="fas fa-calendar-alt"></i>';
            const label = document.createElement('span');
            label.textContent = planLabel(plan);
            card.appendChild(label);
            card.addEventListener('click', onPlanSelect);
            dom.planGrid.appendChild(card);
        }
    }

    function onPlanSelect(e) {
        const card = e.currentTarget || this;
        if (card.disabled) return;
        const plan = findPlan(card.getAttribute('data-plan-id'));
        if (!plan) return;

        const name = plan.nickname || (planLabel(plan) + ' plan');
        PopupManager.showConfirm('Are you sure you want to select ' + name + '?', function (confirmed) {
            if (!confirmed) return;
            state.selectedPlanId = Number(plan.id);
            renderPlans();
            // PopupManager restores focus to the (now re-rendered) card after
            // this callback; move on to Request Now once it has.
            setTimeout(function () { dom.primaryBtn.focus(); }, 0);
        }, 'Yes', 'No');
    }

    function updateRequestButton() {
        if (state.requestStatus === 'under_review') {
            dom.primaryBtn.innerHTML = '<i class="fas fa-clock"></i> Under Review';
            dom.primaryBtn.disabled = true;
        } else {
            dom.primaryBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Request Now';
            dom.primaryBtn.disabled = false;
        }
    }

    function submitPlanRequest() {
        if (state.requestStatus === 'under_review') return;
        if (!state.selectedPlanId) {
            PopupManager.showAlert('Please Select Plan');
            return;
        }

        const formData = new FormData();
        formData.append('plan_id', String(state.selectedPlanId));

        LoadingManager.show();
        request('POST', API.SUBSCRIPTION_PLAN_REQUEST, formData, function (data) {
            LoadingManager.hide();
            if (!isApiSuccess(data)) {
                PopupManager.showAlert((data && data.message) || 'Unable to send your request. Please try again.');
                return;
            }
            state.requestStatus = 'under_review';
            dom.requestNote.textContent = '';
            renderPlans();
            updateRequestButton();
            focusDefault();
            PopupManager.showAlert('Your request has been sent to your service provider for approval.');
        });
    }

    // ─── Web user: Refresh / Cancel Subscription ────────────────────────────
    function onPrimaryAction() {
        if (dom.primaryBtn.disabled) return;
        if (state.mode === 'custom') {
            submitPlanRequest();
        } else if (state.mode === 'renewal_failed') {
            openPasswordOverlay();
        } else {
            loadStatus('refresh');
        }
    }

    function openPasswordOverlay() {
        state.isPwdOpen = true;
        dom.pwdInput.value = '';
        dom.pwdError.textContent = '';
        dom.pwdOverlay.style.display = 'flex';
        setTimeout(function () { dom.pwdInput.focus(); }, 50);
    }

    function closePasswordOverlay() {
        closeKeypad();
        state.isPwdOpen = false;
        dom.pwdInput.value = '';
        dom.pwdOverlay.style.display = 'none';
        setTimeout(focusDefault, 50);
    }

    function verifyPassword() {
        closeKeypad();
        const password = dom.pwdInput.value;
        if (!password) {
            dom.pwdError.textContent = 'Please enter your password.';
            return;
        }
        dom.pwdError.textContent = '';

        const formData = new FormData();
        formData.append('password', password);

        LoadingManager.show();
        request('POST', API.VERIFY_PASSWORD, formData, function (data) {
            LoadingManager.hide();
            if (!isApiSuccess(data)) {
                dom.pwdError.textContent = (data && data.message) || 'Incorrect password. Please try again.';
                return;
            }
            closePasswordOverlay();
            setTimeout(confirmCancelSubscription, 100);
        });
    }

    function confirmCancelSubscription() {
        PopupManager.showConfirm('Are you sure you want to cancel auto-renewal for this subscription?', function (confirmed) {
            if (confirmed) cancelSubscription();
        }, 'Yes', 'No');
    }

    function cancelSubscription() {
        if (!state.userId) {
            PopupManager.showAlert('Unable to cancel subscription: missing account information.');
            return;
        }
        LoadingManager.show();
        request('DELETE', API.CANCEL_SUBSCRIPTION + state.userId, null, function (data) {
            LoadingManager.hide();
            if (!isApiSuccess(data)) {
                PopupManager.showAlert((data && data.message) || 'Failed to cancel subscription. Please try again.');
                return;
            }
            // Billing stopped: go straight to the expired (QR + Refresh) screen.
            state.cancelled = true;
            render('expired', state.lastData || {});
        });
    }

    // ─── Sign Out ───────────────────────────────────────────────────────────
    function signOut() {
        PopupManager.logout(function (confirmed) {
            if (!confirmed) return;
            stopPolling();
            LoadingManager.show();
            request('POST', API.LOGOUT, null, function () {
                localStorage.clear();
                window.location.href = '../guide/guide.html';
            });
        });
    }

    // ─── On-screen keypad (password field) ──────────────────────────────────
    // Same convention as login: the field stays readonly so remote focus
    // never pops the TV keypad; OK opens it, OK / Back / Done closes it.
    function openKeypad() {
        dom.pwdInput.removeAttribute('readonly');
        state.isKeypadOpen = true;
        dom.pwdInput.focus();
        const len = dom.pwdInput.value.length;
        try { dom.pwdInput.setSelectionRange(len, len); } catch (e) { /* unsupported input type */ }
    }

    function closeKeypad() {
        if (!state.isKeypadOpen) return;
        dom.pwdInput.setAttribute('readonly', 'readonly');
        state.isKeypadOpen = false;
    }

    // ─── Focus / navigation ─────────────────────────────────────────────────
    // Focusable elements as rows: LEFT/RIGHT within a row, UP/DOWN between.
    function getFocusRows() {
        if (state.isPwdOpen) {
            return [[dom.pwdInput], [dom.pwdCancelBtn, dom.pwdSubmitBtn]];
        }
        const rows = [];
        if (state.mode === 'custom') {
            const cards = Array.prototype.slice.call(dom.planGrid.querySelectorAll('.plan-card'))
                .filter(function (c) { return !c.disabled; });
            if (cards.length) rows.push(cards);
        }
        const buttons = [dom.primaryBtn, dom.signoutBtn].filter(function (b) { return !b.disabled; });
        rows.push(buttons);
        return rows;
    }

    function focusDefault() {
        if (state.isPwdOpen || PopupManager.isOpen()) return;
        let target = dom.primaryBtn;
        if (state.mode === 'custom') {
            if (state.requestStatus === 'under_review') {
                target = dom.signoutBtn;
            } else if (!state.selectedPlanId) {
                target = dom.planGrid.querySelector('.plan-card:not([disabled])') || dom.primaryBtn;
            }
        }
        if (target) target.focus();
    }

    function moveFocus(keyCode) {
        const rows = getFocusRows();
        const active = document.activeElement;
        let r = -1;
        let c = -1;
        for (let i = 0; i < rows.length && r === -1; i++) {
            const idx = rows[i].indexOf(active);
            if (idx !== -1) { r = i; c = idx; }
        }
        if (r === -1) {
            if (state.isPwdOpen) dom.pwdInput.focus(); else focusDefault();
            return;
        }

        if (keyCode === KEYS.LEFT && c > 0) {
            rows[r][c - 1].focus();
        } else if (keyCode === KEYS.RIGHT && c < rows[r].length - 1) {
            rows[r][c + 1].focus();
        } else if (keyCode === KEYS.UP && r > 0) {
            rows[r - 1][Math.min(c, rows[r - 1].length - 1)].focus();
        } else if (keyCode === KEYS.DOWN && r < rows.length - 1) {
            rows[r + 1][Math.min(c, rows[r + 1].length - 1)].focus();
        }
    }

    function handlePasswordKeys(e) {
        const onInput = document.activeElement === dom.pwdInput;

        if (state.isKeypadOpen && onInput) {
            if (e.keyCode === KEYS.LEFT || e.keyCode === KEYS.RIGHT) return; // move the caret
            if (e.keyCode === KEYS.ENTER || e.keyCode === KEYS.IME_DONE ||
                e.keyCode === KEYS.BACK || e.keyCode === KEYS.IME_CANCEL) {
                e.preventDefault();
                closeKeypad();
                return;
            }
            closeKeypad(); // UP / DOWN leave the field
        }

        switch (e.keyCode) {
            case KEYS.LEFT:
            case KEYS.RIGHT:
            case KEYS.UP:
            case KEYS.DOWN:
                e.preventDefault();
                moveFocus(e.keyCode);
                break;
            case KEYS.ENTER:
                e.preventDefault();
                if (onInput) {
                    openKeypad();
                } else if (document.activeElement === dom.pwdSubmitBtn) {
                    verifyPassword();
                } else {
                    closePasswordOverlay();
                }
                break;
            case KEYS.BACK:
            case KEYS.EXIT:
                e.preventDefault();
                closePasswordOverlay();
                break;
        }
    }

    function handleKeyDown(e) {
        if (PopupManager.isOpen()) {
            PopupManager.handleKey(e.keyCode);
            e.preventDefault();
            return;
        }
        if (LoadingManager.isVisible()) {
            e.preventDefault();
            return;
        }
        if (state.isPwdOpen) {
            handlePasswordKeys(e);
            return;
        }

        switch (e.keyCode) {
            case KEYS.LEFT:
            case KEYS.RIGHT:
            case KEYS.UP:
            case KEYS.DOWN:
                e.preventDefault();
                moveFocus(e.keyCode);
                break;
            case KEYS.ENTER:
                e.preventDefault();
                if (document.activeElement && document.activeElement.click) {
                    document.activeElement.click();
                }
                break;
            case KEYS.BACK:
            case KEYS.EXIT:
                e.preventDefault();
                PopupManager.exit(function (confirmed) {
                    if (confirmed) {
                        try { tizen.application.getCurrentApplication().exit(); } catch (err) { }
                    }
                });
                break;
        }
    }

    // ─── Init ───────────────────────────────────────────────────────────────
    function init() {
        state.jwt = localStorage.getItem('jwt token');
        state.userId = localStorage.getItem('user_id');

        if (!state.jwt) {
            localStorage.clear();
            window.location.href = '../login/login.html';
            return;
        }

        dom.card = document.getElementById('sub-card');
        dom.title = document.getElementById('sub-title');
        dom.customLeft = document.getElementById('custom-left');
        dom.customRight = document.getElementById('custom-right');
        dom.qrLeft = document.getElementById('qr-left');
        dom.qrRight = document.getElementById('qr-right');
        dom.prevExpiry = document.getElementById('prev-plan-expiry');
        dom.prevDevices = document.getElementById('prev-plan-devices');
        dom.requestNote = document.getElementById('sub-request-note');
        dom.planGrid = document.getElementById('plan-grid');
        dom.qrImage = document.getElementById('sub-qr-image');
        dom.qrMessage = document.getElementById('qr-message');
        dom.qrVisit = document.getElementById('qr-visit');
        dom.qrSteps = document.getElementById('qr-steps');
        dom.primaryBtn = document.getElementById('sub-primary-btn');
        dom.signoutBtn = document.getElementById('sub-signout-btn');
        dom.pwdOverlay = document.getElementById('pwd-overlay');
        dom.pwdInput = document.getElementById('pwd-input');
        dom.pwdError = document.getElementById('pwd-error');
        dom.pwdCancelBtn = document.getElementById('pwd-cancel-btn');
        dom.pwdSubmitBtn = document.getElementById('pwd-submit-btn');

        dom.primaryBtn.addEventListener('click', onPrimaryAction);
        dom.signoutBtn.addEventListener('click', signOut);
        dom.pwdSubmitBtn.addEventListener('click', verifyPassword);
        dom.pwdCancelBtn.addEventListener('click', closePasswordOverlay);
        dom.pwdInput.addEventListener('blur', closeKeypad);

        try {
            tizen.tvinputdevice.registerKey('Exit');
        } catch (e) {
            console.warn('Could not register Exit key:', e);
        }
        document.addEventListener('keydown', handleKeyDown);

        loadStatus('init');
    }

    return { init: init };
})();

window.onload = SubscriptionScreen.init;
