/**
 * Subscription blocked (login 410 / relaunch while still blocked). The view
 * comes from POST /auth/subscription/check:
 *
 *   custom          Custom user: previous plan + plan request to the service
 *                   provider ("Under Review" until approved/rejected).
 *   renewal_failed  Web user whose renewal payment failed: QR to the website
 *                   + Cancel Subscription (password -> confirm -> cancel).
 *   expired         Web user with an expired plan: QR + Refresh.
 *
 * Status is re-checked every 30s, so an approval / web payment moves the
 * user on to the app without pressing anything.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  FaExclamationTriangle, FaCrown, FaHandPointer, FaPaperPlane, FaClock, FaBan, FaQrcode, FaCreditCard, FaUser,
  FaSyncAlt, FaSignOutAlt, FaExclamationCircle, FaCalendarAlt,
} from 'react-icons/fa';
import { useKeys, PRIORITY } from '../core/keys';
import { popup } from '../core/popup';
import { loading } from '../core/loading';
import { nav } from '../core/nav';
import { continueAfterLogin, handleSessionExpired, logoutRequest } from '../core/session';
import { KEY } from '../lib/keys';
import { API } from '../config/api';
import { request, formData, isApiSuccess } from '../lib/http';
import { get, set, clearSession, getToken, K } from '../lib/storage';
import { exitApp } from '../lib/tizen';
import { formatApiDate } from '../lib/format';
import TvInput, { handleEditingKey } from '../components/TvInput';

const POLL_MS = 30000;
const RENEWAL_FAILED_STATUSES = ['past_due', 'unpaid', 'incomplete'];

const QR_SCREENS = {
  renewal_failed: {
    title: 'Subscription Renewal Failed',
    message: 'We couldn’t renew your subscription due to a payment issue. ' +
      'Please follow the steps below to continue watching on StreamlyTV.',
    showVisit: false,
    steps: [[FaBan, 'Cancel the current plan'], [FaQrcode, 'Scan the QR code and sign in'],
      [FaCreditCard, 'Renew with a new plan to continue streaming on TV']],
    primary: [FaExclamationCircle, 'Cancel Subscription'],
  },
  expired: {
    title: 'Subscription Expired',
    message: 'Your subscription has expired. Renew your plan to continue watching.',
    showVisit: true,
    steps: [[FaQrcode, 'Scan the QR code'], [FaUser, 'Login & choose the plan'], [FaCreditCard, 'Complete the payment']],
    primary: [FaSyncAlt, 'Refresh'],
  },
};

function websiteHost(url) {
  const host = String(url || 'https://streamlytv.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host.indexOf('www.') === 0 ? host : 'www.' + host;
}

function planLabel(plan) {
  const count = Number(plan.interval_count) || 1;
  return count + ' ' + (plan.interval || 'month') + (count > 1 ? 's' : '');
}

// Parses the body on any HTTP status (check / verify-password return
// meaningful JSON on 410 / 422). 401 goes to the shared session handler.
function api(method, url, body) {
  return request(method, url, { token: getToken(), body: body }).then(function (res) {
    if (res.status === 401 || (res.data && Number(res.data.response_code) === 401)) {
      loading.hide();
      handleSessionExpired();
      return { authFailed: true };
    }
    return res.data;
  }, function () {
    return null;
  });
}

export default function Subscription() {
  const [mode, setMode] = useState(null); // custom | renewal_failed | expired
  const [data, setData] = useState({});
  const [plans, setPlans] = useState(null);
  const [plansMessage, setPlansMessage] = useState('Loading plans...');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [requestStatus, setRequestStatus] = useState(null);
  const [focus, setFocus] = useState(null); // plan-<id> | primary | signout
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdFocus, setPwdFocus] = useState('input'); // input | cancel | submit
  const [pwdEditing, setPwdEditing] = useState(false);

  const st = useRef({ mode: null, requestStatus: null, cancelled: false, pwdOpen: false, plansLoading: false, plans: null });
  st.current.mode = mode;
  st.current.requestStatus = requestStatus;
  st.current.pwdOpen = pwdOpen;
  st.current.plans = plans;
  const pollTimer = useRef(null);

  const isCustom = mode === 'custom';
  const locked = requestStatus === 'under_review';
  const primaryDisabled = isCustom && locked;

  // ── Status ──────────────────────────────────────────────────────────
  function resolveMode(d) {
    if (d.custom_subscription_expired === true || get(K.IS_CUSTOM_USER) === '1') return 'custom';
    const stripe = String(d.stripe_status || '').toLowerCase();
    if (!st.current.cancelled && RENEWAL_FAILED_STATUSES.indexOf(stripe) !== -1) return 'renewal_failed';
    return 'expired';
  }

  function loadPlans() {
    if (st.current.plansLoading) return;
    st.current.plansLoading = true;
    setPlansMessage('Loading plans...');
    api('GET', API.CUSTOM_SUBSCRIPTION_PLANS).then(function (res) {
      st.current.plansLoading = false;
      if (!res || res.authFailed || !Array.isArray(res.data) || !res.data.length) {
        setPlansMessage('Unable to load plans. Retrying shortly...');
        return;
      }
      const list = res.data.filter(function (p) { return Number(p.status) === 1; })
        .sort(function (a, b) { return Number(a.interval_count) - Number(b.interval_count); });
      setPlans(list);
    });
  }

  function render(nextMode, d) {
    setMode(nextMode);
    setData(d || {});
    if (nextMode === 'custom') {
      const status = (d.plan_request && d.plan_request.status) || null;
      setRequestStatus(status);
      if (status === 'under_review' && d.plan_request.plan_id) setSelectedPlan(Number(d.plan_request.plan_id));
      if (!st.current.plans) loadPlans();
    } else {
      setRequestStatus(null);
      const qr = d.qrcode || get(K.SUBSCRIPTION_QR);
      if (qr) set(K.SUBSCRIPTION_QR, qr);
    }
  }

  function applyStatus(d, source) {
    if (d && d.success === true && Number(d.response_code) === 200) {
      stopPolling();
      if (source === 'poll') {
        const msg = st.current.mode === 'custom'
          ? 'Your subscription request has been approved.'
          : 'Your subscription is active again.';
        popup.alert(msg, continueAfterLogin);
      } else {
        continueAfterLogin();
      }
      return;
    }
    const nextMode = resolveMode(d);
    if (source === 'poll') {
      const nextStatus = nextMode === 'custom' ? ((d.plan_request && d.plan_request.status) || null) : null;
      const changed = nextMode !== st.current.mode || nextStatus !== st.current.requestStatus;
      if (!changed || popup.isOpen() || st.current.pwdOpen) return;
    }
    render(nextMode, d);
    if (source === 'refresh' && nextMode !== 'custom') {
      popup.alert('Your subscription is not active yet. Complete the payment on the website, then press Refresh.');
    }
  }

  function loadStatus(source) {
    if (source !== 'poll') loading.show('Checking subscription...');
    api('POST', API.SUBSCRIPTION_CHECK).then(function (d) {
      if (source !== 'poll') loading.hide();
      if (d && d.authFailed) return;
      if (!d) {
        if (source === 'poll') return;
        popup.noInternet(function () { loadStatus(source); },
          'Unable to check your subscription. Please check your connection and try again.');
        return;
      }
      applyStatus(d, source);
    });
  }

  function stopPolling() {
    clearInterval(pollTimer.current);
    pollTimer.current = null;
  }

  useEffect(function () {
    if (!getToken()) {
      clearSession();
      nav.go('login');
      return undefined;
    }
    loadStatus('init');
    pollTimer.current = setInterval(function () {
      if (popup.isOpen() || st.current.pwdOpen || loading.isVisible()) return;
      if (st.current.mode === 'custom' && !st.current.plans) loadPlans();
      loadStatus('poll');
    }, POLL_MS);
    return stopPolling;
  }, []);

  // Default focus whenever the view changes
  useEffect(function () {
    if (!mode) return;
    if (isCustom) {
      if (locked) setFocus('signout');
      else if (!selectedPlan && plans && plans.length) setFocus('plan-' + plans[0].id);
      else setFocus('primary');
    } else {
      setFocus('primary');
    }
  }, [mode, requestStatus, !!plans]);

  // ── Actions ─────────────────────────────────────────────────────────
  function selectPlan(plan) {
    if (locked) return;
    const name = plan.nickname || (planLabel(plan) + ' plan');
    popup.confirm('Are you sure you want to select ' + name + '?', function (yes) {
      if (!yes) return;
      setSelectedPlan(Number(plan.id));
      setFocus('primary');
    }, 'Yes', 'No');
  }

  function submitPlanRequest() {
    if (locked) return;
    if (!selectedPlan) {
      popup.alert('Please Select Plan');
      return;
    }
    loading.show('Sending request...');
    api('POST', API.SUBSCRIPTION_PLAN_REQUEST, formData({ plan_id: selectedPlan })).then(function (d) {
      loading.hide();
      if (d && d.authFailed) return;
      if (!isApiSuccess(d)) {
        popup.alert((d && d.message) || 'Unable to send your request. Please try again.');
        return;
      }
      setRequestStatus('under_review');
      setData(function (old) { return Object.assign({}, old, { plan_request: { status: 'under_review', plan_id: selectedPlan } }); });
      popup.alert('Your request has been sent to your service provider for approval.');
    });
  }

  function onPrimary() {
    if (primaryDisabled) return;
    if (mode === 'custom') submitPlanRequest();
    else if (mode === 'renewal_failed') openPassword();
    else loadStatus('refresh');
  }

  function openPassword() {
    setPwd('');
    setPwdError('');
    setPwdFocus('input');
    setPwdEditing(false);
    setPwdOpen(true);
  }

  function closePassword() {
    setPwdEditing(false);
    setPwdOpen(false);
    setPwd('');
  }

  function verifyPassword() {
    setPwdEditing(false);
    if (!pwd) {
      setPwdError('Please enter your password.');
      return;
    }
    setPwdError('');
    loading.show('Verifying password...');
    api('POST', API.VERIFY_PASSWORD, formData({ password: pwd })).then(function (d) {
      loading.hide();
      if (d && d.authFailed) return;
      if (!isApiSuccess(d)) {
        setPwdError((d && d.message) || 'Incorrect password. Please try again.');
        return;
      }
      closePassword();
      popup.confirm('Are you sure you want to cancel auto-renewal for this subscription?', function (yes) {
        if (yes) cancelSubscription();
      }, 'Yes', 'No');
    });
  }

  function cancelSubscription() {
    const userId = get(K.USER_ID);
    if (!userId) {
      popup.alert('Unable to cancel subscription: missing account information.');
      return;
    }
    loading.show('Cancelling subscription...');
    api('DELETE', API.CANCEL_SUBSCRIPTION + userId).then(function (d) {
      loading.hide();
      if (d && d.authFailed) return;
      if (!isApiSuccess(d)) {
        popup.alert((d && d.message) || 'Failed to cancel subscription. Please try again.');
        return;
      }
      // Billing stopped: straight to the expired (QR + Refresh) view.
      st.current.cancelled = true;
      render('expired', data);
    });
  }

  function signOut() {
    popup.logout(function (yes) {
      if (!yes) return;
      stopPolling();
      loading.show('Signing out...');
      logoutRequest().then(function () {
        loading.hide();
        clearSession();
        nav.go('guide');
      });
    });
  }

  // ── Remote ──────────────────────────────────────────────────────────
  function focusRows() {
    const rows = [];
    if (isCustom && plans && !locked) {
      rows.push(plans.map(function (p) { return 'plan-' + p.id; }));
    }
    rows.push(primaryDisabled ? ['signout'] : ['primary', 'signout']);
    return rows;
  }

  function move(code, rows, current, setter) {
    let r = -1;
    let c = -1;
    for (let i = 0; i < rows.length && r === -1; i++) {
      const idx = rows[i].indexOf(current);
      if (idx !== -1) {
        r = i;
        c = idx;
      }
    }
    if (r === -1) {
      setter(rows[rows.length - 1][0]);
      return;
    }
    if (code === KEY.LEFT && c > 0) setter(rows[r][c - 1]);
    else if (code === KEY.RIGHT && c < rows[r].length - 1) setter(rows[r][c + 1]);
    else if (code === KEY.UP && r > 0) setter(rows[r - 1][Math.min(c, rows[r - 1].length - 1)]);
    else if (code === KEY.DOWN && r < rows.length - 1) setter(rows[r + 1][Math.min(c, rows[r + 1].length - 1)]);
  }

  useKeys(function (code) {
    if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.UP || code === KEY.DOWN) {
      move(code, focusRows(), focus, setFocus);
    } else if (code === KEY.ENTER) {
      if (focus === 'primary') onPrimary();
      else if (focus === 'signout') signOut();
      else if (focus && focus.indexOf('plan-') === 0 && plans) {
        const id = Number(focus.slice(5));
        const plan = plans.filter(function (p) { return Number(p.id) === id; })[0];
        if (plan) selectPlan(plan);
      }
    } else if (code === KEY.BACK || code === KEY.EXIT) {
      popup.exit(function (yes) { if (yes) exitApp(); });
    }
  }, { enabled: !!mode });

  // Password overlay (renewal failed -> Cancel Subscription)
  useKeys(function (code) {
    if (pwdEditing) {
      const r = handleEditingKey(code, function () { setPwdEditing(false); });
      if (r === 'native') return 'native';
      if (r === 'handled') return undefined;
    }
    if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.UP || code === KEY.DOWN) {
      move(code, [['input'], ['cancel', 'submit']], pwdFocus, setPwdFocus);
    } else if (code === KEY.ENTER) {
      if (pwdFocus === 'input') setPwdEditing(true);
      else if (pwdFocus === 'submit') verifyPassword();
      else closePassword();
    } else if (code === KEY.BACK || code === KEY.EXIT) {
      closePassword();
    }
    return undefined;
  }, { priority: PRIORITY.MODAL, enabled: pwdOpen });

  function f(id) {
    return focus === id ? ' focused' : '';
  }

  if (!mode) return <div className="screen subscription" />;

  const screen = QR_SCREENS[mode];
  const qrImage = data.qrcode || get(K.SUBSCRIPTION_QR);
  const PrimaryIcon = isCustom ? (locked ? FaClock : FaPaperPlane) : screen.primary[0];
  const primaryLabel = isCustom ? (locked ? 'Under Review' : 'Request Now') : screen.primary[1];

  return (
    <div className="screen subscription">
      <div className="sub-card">
        <h2 className="sub-title">{isCustom ? 'Subscription Expired' : screen.title}</h2>
        <div className="sub-split">
          <div className="sub-left">
            {isCustom ? (
              <div className="sub-custom-left">
                <FaExclamationTriangle className="sub-warning-icon" />
                <p className="sub-left-text">Your subscription has expired. Renew your plan to continue watching.</p>
                <div className="prev-plan">
                  <div className="prev-plan-crown"><FaCrown /></div>
                  <div className="prev-plan-info">
                    <div className="prev-plan-title">Previous Plan</div>
                    <div className="prev-plan-expiry">
                      {'Expired on ' + (formatApiDate(data.custom_subscription_expired_at, true) || '-')}
                    </div>
                  </div>
                  <div className="prev-plan-devices">
                    <div className="prev-plan-devices-label">Devices</div>
                    <div className="prev-plan-devices-count">
                      {data.device_limit !== undefined && data.device_limit !== null ? String(data.device_limit) : '-'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="sub-qr-box">
                {qrImage ? <img src={qrImage} alt="QR Code" className="sub-qr-image" /> : <FaQrcode className="sub-qr-placeholder" />}
              </div>
            )}
          </div>

          <div className="sub-divider" />

          <div className="sub-right">
            {isCustom ? (
              <div>
                <p className="sub-steps-heading">How to continue watching streamly</p>
                <ul className="sub-steps">
                  <li><span className="sub-step-icon"><FaHandPointer /></span>Select a Plan</li>
                  <li><span className="sub-step-icon"><FaPaperPlane /></span>Click on Request Now</li>
                  <li><span className="sub-step-icon"><FaClock /></span>Waiting For Approval</li>
                </ul>
                {requestStatus === 'rejected' && (
                  <p className="sub-request-note">Your previous request was rejected. Please select a plan and request again.</p>
                )}
                <div className="plan-grid">
                  {plans ? plans.map(function (plan) {
                    return (
                      <button key={plan.id} type="button" disabled={locked}
                        className={'plan-card' + f('plan-' + plan.id) + (Number(plan.id) === selectedPlan ? ' selected' : '')}
                        onClick={function () { selectPlan(plan); }}>
                        <FaCalendarAlt />
                        <span>{planLabel(plan)}</span>
                      </button>
                    );
                  }) : <div className="plan-grid-empty">{plansMessage}</div>}
                </div>
              </div>
            ) : (
              <div>
                <p className="sub-message">{screen.message}</p>
                {screen.showVisit && (
                  <p className="sub-visit">
                    Visit <span className="sub-highlight">{websiteHost(data.url)}</span> or Scan the{' '}
                    <span className="sub-highlight">QR Code</span>
                  </p>
                )}
                <p className="sub-steps-heading sub-steps-heading-bar">QR Steps</p>
                <ul className="sub-steps">
                  {screen.steps.map(function (step, i) {
                    const Icon = step[0];
                    return <li key={i}><span className="sub-step-icon"><Icon /></span>{step[1]}</li>;
                  })}
                </ul>
              </div>
            )}

            <div className="sub-actions">
              <button type="button" disabled={primaryDisabled} className={'btn btn-outline' + f('primary')} onClick={onPrimary}>
                <PrimaryIcon /> {primaryLabel}
              </button>
              <button type="button" className={'btn btn-primary' + f('signout')} onClick={signOut}>
                <FaSignOutAlt /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {pwdOpen && (
        <div className="overlay-dim">
          <div className="dialog">
            <div className="dialog-title">Confirm Your Password</div>
            <div className="dialog-text">Please enter your account password to cancel your current subscription.</div>
            <TvInput id="pwd-input" type="password" value={pwd} onChange={setPwd} placeholder="Enter password"
              focused={pwdFocus === 'input'} editing={pwdEditing} onStopEditing={function () { setPwdEditing(false); }}
              onClick={function () { setPwdFocus('input'); setPwdEditing(true); }} />
            <div className="dialog-error">{pwdError}</div>
            <div className="dialog-buttons">
              <button type="button" className={'btn btn-outline' + (pwdFocus === 'cancel' ? ' focused' : '')} onClick={closePassword}>Cancel</button>
              <button type="button" className={'btn btn-primary' + (pwdFocus === 'submit' ? ' focused' : '')} onClick={verifyPassword}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
