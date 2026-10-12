/**
 * Login: Email / Passcode / QR (one shown on the left, the other two as
 * buttons on the right) + Forgot Password popup + Remember Me.
 *
 * Remote navigation (same as the current app):
 *  - UP/DOWN walk the left column, then the right-side buttons.
 *  - RIGHT from a password field goes to its eye toggle (never DOWN);
 *    RIGHT from Remember Me goes to Forgot Password on the same row;
 *    RIGHT from anything else on the left jumps to the right-side buttons.
 *  - OK on a field opens the TV keyboard; LEFT/RIGHT then move the caret.
 *  - QR: code expires after 60s -> blurred with "QR Code Expired" and a
 *    Refresh QR Code button.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  FaLock, FaEnvelope, FaQrcode, FaChevronRight, FaChevronLeft, FaEye, FaEyeSlash, FaCheck,
  FaHourglassEnd, FaRedoAlt, FaExclamationCircle,
} from 'react-icons/fa';
import { useKeys } from '../core/keys';
import { popup } from '../core/popup';
import { loading, Spinner } from '../core/loading';
import { KEY } from '../lib/keys';
import { get, set, remove, K } from '../lib/storage';
import { exitApp, buildDevicePayload } from '../lib/tizen';
import { getZipCode } from '../lib/geo';
import { isValidEmail } from '../lib/format';
import { friendlyMessage } from '../lib/http';
import TvInput, { handleEditingKey } from '../components/TvInput';
import Header from '../components/Header';
import {
  loginWithEmail, loginWithPasscode, createQrCode, checkQrScan, loginWithQr, forgotPassword, processLoginResponse,
} from '../services/auth';

const QR_SECONDS = 60;
const QR_POLL_MS = 3000;

const SIDE_TABS = {
  email: [['passcode', 'Login with Passcode', FaLock], ['qr', 'Login with QR', FaQrcode]],
  passcode: [['email', 'Login with Email', FaEnvelope], ['qr', 'Login with QR', FaQrcode]],
  qr: [['email', 'Login with Email', FaEnvelope], ['passcode', 'Login with Passcode', FaLock]],
};

const INPUT_IDS = ['username', 'password', 'passcode', 'fpEmail'];
const EYE_FOR = { password: 'eye', passcode: 'passcodeEye' };
const FIELD_FOR_EYE = { eye: 'password', passcodeEye: 'passcode' };
const FIRST_FOCUS = { email: 'username', passcode: 'passcode', qr: 'qrArea' };

function networkMessage(err) {
  if (err && err.kind) return 'Unable to connect. Please check your internet connection and try again.';
  return friendlyMessage(err && err.message, 'Something went wrong. Please try again.');
}

export default function Login() {
  const [tab, setTab] = useState('email');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [focus, setFocus] = useState('username');
  const [editing, setEditing] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [fpEmail, setFpEmail] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [remember, setRemember] = useState(false);
  const [qr, setQr] = useState({ status: 'loading', image: '', message: 'Generating QR code...' });
  const [qrSeconds, setQrSeconds] = useState(QR_SECONDS);
  const [qrExpired, setQrExpired] = useState(false);

  // Values async QR callbacks need to see right now (not as of a past render)
  const live = useRef({ tab: 'email', forgot: false, expired: false, key: null, focus: 'username' });
  live.current.tab = tab;
  live.current.forgot = forgotOpen;
  live.current.expired = qrExpired;
  live.current.focus = focus;
  const timers = useRef({ poll: null, countdown: null, expire: null, retry: null });
  const forgotReturnTab = useRef('email');

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(function () {
    getZipCode();
    if (get(K.REMEMBER_ME) === '1' && get(K.REMEMBER_EMAIL)) {
      setEmail(get(K.REMEMBER_EMAIL) || '');
      setPassword(get(K.REMEMBER_PASSWORD) || '');
      setRemember(true);
    }
    return function () {
      stopPolling();
      clearCountdown();
      clearTimeout(timers.current.retry);
    };
  }, []);

  // ── QR ────────────────────────────────────────────────────────────────
  function qrActive() {
    return live.current.tab === 'qr' && !live.current.forgot;
  }

  function stopPolling() {
    clearInterval(timers.current.poll);
    timers.current.poll = null;
  }

  function clearCountdown() {
    clearInterval(timers.current.countdown);
    clearTimeout(timers.current.expire);
    timers.current.countdown = null;
    timers.current.expire = null;
  }

  function startCountdown() {
    clearCountdown();
    setQrExpired(false);
    live.current.expired = false;
    setQrSeconds(QR_SECONDS);
    timers.current.countdown = setInterval(function () {
      setQrSeconds(function (s) { return Math.max(0, s - 1); });
    }, 1000);
    timers.current.expire = setTimeout(expireQr, QR_SECONDS * 1000);
  }

  function expireQr() {
    stopPolling();
    clearCountdown();
    live.current.key = null;
    live.current.expired = true;
    setQrExpired(true);
    if (live.current.focus === 'qrArea') setFocus('qrRefresh');
  }

  function scheduleQrRetry() {
    clearTimeout(timers.current.retry);
    timers.current.retry = setTimeout(function () {
      if (qrActive() && !live.current.key && !live.current.expired) generateQr();
    }, 3000);
  }

  function generateQr() {
    setQr({ status: 'loading', image: '', message: 'Generating QR code...' });
    createQrCode().then(function (result) {
      if (live.current.expired || !qrActive()) return;
      if (result && result.status === 1) {
        live.current.key = result.key;
        setQr({ status: 'ready', image: result.msg, message: '' });
        startPolling();
      } else {
        setQr({ status: 'error', image: '', message: 'Failed to generate QR. Retrying...' });
        scheduleQrRetry();
      }
    }, function () {
      if (!qrActive()) return;
      setQr({ status: 'error', image: '', message: 'Connection error. Retrying...' });
      scheduleQrRetry();
    });
  }

  function startPolling() {
    stopPolling();
    if (!live.current.key) return;
    timers.current.poll = setInterval(function () {
      const key = live.current.key;
      if (!key) return;
      checkQrScan(key).then(function (result) {
        if (result && result.status === 1 && live.current.key === key && timers.current.poll) {
          stopPolling();
          clearCountdown();
          completeQrLogin(key);
        }
      }, function () { /* keep polling; network may recover */ });
    }, QR_POLL_MS);
  }

  function resetQrToReady() {
    setQr(function (q) { return { status: q.image ? 'ready' : 'error', image: q.image, message: q.image ? '' : 'Scan QR to login' }; });
    // Same key: the user doesn't have to scan again after a transient error
    if (live.current.key) startPolling();
  }

  function completeQrLogin(key) {
    const device = buildDevicePayload();
    setQr(function (q) { return { status: 'logging', image: q.image, message: 'Logging in...' }; });
    loginWithQr(key, device).then(function (data) {
      processLoginResponse(data, { method: 'qr' }, device, {
        failureMessage: 'Login failed. Please try again.',
        onFailure: function (msg) {
          popup.alert(msg);
          resetQrToReady();
        },
        // The key was already scanned; polling it again would re-trigger the
        // login (and the device-limit popup), so leave the QR screen.
        onDeviceLimitCancel: function () {
          switchTab('email');
        },
      });
    }, function () {
      popup.alert('Failed to connect to the server. Please try again.');
      resetQrToReady();
    });
  }

  function refreshQr() {
    if (tab !== 'qr') return;
    stopPolling();
    live.current.key = null;
    startCountdown();
    generateQr();
    setFocus('qrArea');
  }

  // ── Tabs / forgot password ───────────────────────────────────────────
  function switchTab(next) {
    if (next === live.current.tab) return;
    setEditing(null);
    if (live.current.tab === 'qr') {
      stopPolling();
      clearCountdown();
      clearTimeout(timers.current.retry);
      live.current.key = null;
    }
    live.current.tab = next;
    setTab(next);
    setFocus(FIRST_FOCUS[next]);
    if (next === 'qr') {
      live.current.expired = false;
      setQrExpired(false);
      startCountdown();
      generateQr();
    }
  }

  function openForgot() {
    setEditing(null);
    forgotReturnTab.current = tab;
    if (tab === 'qr') {
      stopPolling();
      clearCountdown();
    }
    live.current.forgot = true;
    setForgotOpen(true);
    setFpEmail('');
    setFocus('fpEmail');
  }

  function closeForgot() {
    setEditing(null);
    live.current.forgot = false;
    setForgotOpen(false);
    const back = forgotReturnTab.current;
    if (back === 'email') {
      setFocus('forgotLink');
    } else {
      setFocus(FIRST_FOCUS[back]);
      if (back === 'qr') {
        if (live.current.key) startPolling();
        else generateQr();
        startCountdown();
      }
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────
  function applyRememberMe(mail, pwd) {
    if (remember) {
      set(K.REMEMBER_ME, '1');
      set(K.REMEMBER_EMAIL, mail);
      set(K.REMEMBER_PASSWORD, pwd);
    } else {
      clearRemembered();
    }
  }

  function clearRemembered() {
    remove(K.REMEMBER_ME);
    remove(K.REMEMBER_EMAIL);
    remove(K.REMEMBER_PASSWORD);
  }

  function submitEmail() {
    const mail = email.trim();
    const pwd = password.trim();
    if (!mail) return popup.alert('Please enter an email.');
    if (!isValidEmail(mail)) return popup.alert('Please enter a valid email.');
    if (!pwd) return popup.alert('Please enter a password.');
    if (pwd.length < 6) return popup.alert('Password must be at least 6 characters long.');

    const device = buildDevicePayload();
    loading.show('Logging in...');
    loginWithEmail(mail, pwd, device).then(function (data) {
      const code = data ? Number(data.response_code) : 0;
      if (data && (data.success || code === 479 || code === 410)) applyRememberMe(mail, pwd);
      processLoginResponse(data, { method: 'email', email: mail, password: pwd }, device, {
        onFailure: function (msg) { popup.alert(msg); },
      });
    }, function (err) {
      loading.hide();
      popup.alert(networkMessage(err));
    });
  }

  function submitPasscode() {
    const code = passcode.trim();
    if (!code) return popup.alert('Please enter a passcode.');
    if (code.length < 4) return popup.alert('Passcode must be at least 4 characters.');

    const device = buildDevicePayload();
    loading.show('Logging in...');
    loginWithPasscode(code, device).then(function (data) {
      processLoginResponse(data, { method: 'passcode', passcode: code }, device, {
        failureMessage: 'Login failed. Please check your passcode.',
        onFailure: function (msg) { popup.alert(msg); },
      });
    }, function (err) {
      loading.hide();
      popup.alert(networkMessage(err));
    });
  }

  function submitForgot() {
    const mail = fpEmail.trim();
    if (!mail) return popup.alert('Please enter your email.');
    if (!isValidEmail(mail)) return popup.alert('Please enter a valid email.');
    loading.show('Sending reset link...');
    forgotPassword(mail).then(function (data) {
      loading.hide();
      if (!data) return popup.alert('Empty response from server. Please try again.');
      if (!data.success) return popup.alert(data.message || 'Email not found. Please check and try again.');
      popup.alert(data.message || 'Reset password link sent to your email.', closeForgot);
    }, function (err) {
      loading.hide();
      popup.alert(networkMessage(err));
    });
  }

  // ── Remote ────────────────────────────────────────────────────────────
  function leftList() {
    if (forgotOpen) return ['fpBack', 'fpEmail', 'fpSubmit'];
    if (tab === 'email') return ['username', 'password', 'remember', 'signin'];
    if (tab === 'passcode') return ['passcode', 'passcodeLogin'];
    return qrExpired ? ['qrRefresh'] : ['qrArea'];
  }

  function rightList() {
    return forgotOpen ? [] : ['side-0', 'side-1'];
  }

  function activate(id) {
    if (id === 'signin') submitEmail();
    else if (id === 'passcodeLogin') submitPasscode();
    else if (id === 'eye') setShowPwd(!showPwd);
    else if (id === 'passcodeEye') setShowPasscode(!showPasscode);
    else if (id === 'side-0' || id === 'side-1') switchTab(SIDE_TABS[tab][id === 'side-0' ? 0 : 1][0]);
    else if (id === 'qrRefresh') refreshQr();
    else if (id === 'remember') {
      const next = !remember;
      setRemember(next);
      if (!next) clearRemembered();
    } else if (id === 'forgotLink') openForgot();
    else if (id === 'fpBack') closeForgot();
    else if (id === 'fpSubmit') submitForgot();
    else if (INPUT_IDS.indexOf(id) !== -1) setEditing(id);
  }

  useKeys(function (code) {
    if (editing) {
      const r = handleEditingKey(code, function () { setEditing(null); });
      if (r === 'native') return 'native';
      if (r === 'handled') return undefined;
    }

    const left = leftList();
    const right = rightList();
    const all = left.concat(right);
    const idx = all.indexOf(focus);
    const onEye = !!FIELD_FOR_EYE[focus];

    if (code === KEY.BACK || code === KEY.EXIT) {
      if (forgotOpen) closeForgot();
      else popup.exit(function (yes) { if (yes) exitApp(); });
      return undefined;
    }
    if (code === KEY.ENTER) {
      activate(focus);
      return undefined;
    }

    // Forgot Password (right of Remember Me) has fixed neighbours
    if (focus === 'forgotLink') {
      if (code === KEY.LEFT) setFocus('remember');
      else if (code === KEY.UP) setFocus('password');
      else if (code === KEY.DOWN) setFocus('signin');
      else if (code === KEY.RIGHT && right.length) setFocus(right[0]);
      return undefined;
    }

    switch (code) {
      case KEY.LEFT:
        if (onEye) setFocus(FIELD_FOR_EYE[focus]);
        else if (idx >= left.length) setFocus(left[left.length - 1]);
        break;
      case KEY.UP:
        if (onEye) setFocus(FIELD_FOR_EYE[focus]);
        else if (idx > 0) setFocus(all[idx - 1]);
        break;
      case KEY.RIGHT:
        if (EYE_FOR[focus]) setFocus(EYE_FOR[focus]);
        else if (focus === 'remember') setFocus('forgotLink');
        else if ((onEye || (idx >= 0 && idx < left.length)) && right.length) setFocus(right[0]);
        break;
      case KEY.DOWN:
        if (onEye) {
          const src = left.indexOf(FIELD_FOR_EYE[focus]);
          if (src >= 0 && src < left.length - 1) setFocus(left[src + 1]);
        } else if (idx >= 0 && idx < all.length - 1) setFocus(all[idx + 1]);
        else if (idx === -1 && all.length) setFocus(all[0]);
        break;
      default:
        break;
    }
    return undefined;
  });

  function f(id) {
    return focus === id ? ' focused' : '';
  }

  function inputProps(id) {
    return {
      id: id,
      focused: focus === id,
      editing: editing === id,
      onStopEditing: function () { setEditing(null); },
      onClick: function () { setFocus(id); setEditing(id); },
    };
  }

  const side = SIDE_TABS[tab];

  return (
    <div className="screen login">
      <Header />
      <div className="login-wrap">
        <h2 className="login-title">Log In</h2>
        <h4 className="login-subtitle">Enter the necessary information to Log In</h4>

        <div className="login-split">
          <div className="login-form">
            {tab === 'email' && (
              <div className="login-pane">
                <label className="field-label">Email <span>*</span></label>
                <TvInput {...inputProps('username')} value={email} onChange={setEmail} placeholder="Enter your email" />
                <label className="field-label">Password <span>*</span></label>
                <div className="field-group">
                  <TvInput {...inputProps('password')} type={showPwd ? 'text' : 'password'} value={password}
                    onChange={setPassword} placeholder="Enter Password" />
                  <button type="button" className={'eye-btn' + f('eye')} onClick={function () { setShowPwd(!showPwd); }}>
                    {showPwd ? <FaEye /> : <FaEyeSlash />}
                  </button>
                </div>
                <div className="login-row">
                  <button type="button" className={'remember-btn' + f('remember') + (remember ? ' checked' : '')}
                    onClick={function () { activate('remember'); }}>
                    <span className="remember-box">{remember && <FaCheck />}</span>
                    <span>Remember Me</span>
                  </button>
                  <button type="button" className={'link-btn' + f('forgotLink')} onClick={openForgot}>Forgot Password?</button>
                </div>
                <button type="button" className={'btn btn-primary login-btn' + f('signin')} onClick={submitEmail}>LOG IN</button>
              </div>
            )}

            {tab === 'passcode' && (
              <div className="login-pane">
                <label className="field-label">Passcode <span>*</span></label>
                <div className="field-group">
                  <TvInput {...inputProps('passcode')} type={showPasscode ? 'text' : 'password'} value={passcode}
                    onChange={setPasscode} placeholder="Enter Passcode" />
                  <button type="button" className={'eye-btn' + f('passcodeEye')}
                    onClick={function () { setShowPasscode(!showPasscode); }}>
                    {showPasscode ? <FaEye /> : <FaEyeSlash />}
                  </button>
                </div>
                <button type="button" className={'btn btn-primary login-btn' + f('passcodeLogin')} onClick={submitPasscode}>LOG IN</button>
              </div>
            )}

            {tab === 'qr' && (
              <div className={'login-pane qr-pane' + (qrExpired ? ' qr-expired' : '')}>
                <div className={'qr-area' + f('qrArea')}>
                  {qr.status === 'ready' || (qr.status === 'logging' && qr.image) ? (
                    <img src={qr.image} alt="QR Code" className="qr-image"
                      onError={function () { setQr({ status: 'error', image: '', message: 'Scan QR to login' }); }} />
                  ) : null}
                  {qr.status !== 'ready' && (
                    <div className="qr-fallback">
                      {qr.status === 'error' ? <FaExclamationCircle className="qr-fallback-icon error" />
                        : qr.status === 'loading' || qr.status === 'logging' ? <Spinner />
                          : <FaQrcode className="qr-fallback-icon" />}
                      <p>{qr.message}</p>
                    </div>
                  )}
                  {qrExpired && (
                    <div className="qr-expired-overlay">
                      <FaHourglassEnd className="qr-expired-icon" />
                      <p>QR Code Expired</p>
                    </div>
                  )}
                </div>
                <p className="qr-instruction">Scan this QR code with your phone</p>
                <p className="qr-sub">Open your phone camera and scan the code above</p>
                {qrExpired ? (
                  <button type="button" className={'btn btn-primary qr-refresh' + f('qrRefresh')} onClick={refreshQr}>
                    <FaRedoAlt /> Refresh QR Code
                  </button>
                ) : (
                  <p className={'qr-countdown' + (qrSeconds <= 10 ? ' warning' : '')}>
                    {'This code expires in ' + qrSeconds + 's'}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="login-divider">
            <div className="login-divider-line" />
            <span>OR</span>
            <div className="login-divider-line" />
          </div>

          <div className="login-side">
            {side.map(function (item, i) {
              const Icon = item[2];
              return (
                <button key={item[0]} type="button" className={'side-btn' + f('side-' + i)}
                  onClick={function () { switchTab(item[0]); }}>
                  <Icon className="side-btn-icon" />
                  <span className="side-btn-text">{item[1]}</span>
                  <FaChevronRight className="side-btn-arrow" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {forgotOpen && (
        <div className="overlay-dim">
          <div className="dialog forgot-dialog">
            <button type="button" className={'link-btn fp-back' + f('fpBack')} onClick={closeForgot}>
              <FaChevronLeft /> Back to login
            </button>
            <h2 className="dialog-title">Forgot Password</h2>
            <p className="dialog-text">Enter your email to reset your password.</p>
            <label className="field-label">Send reset password link to</label>
            <TvInput {...inputProps('fpEmail')} value={fpEmail} onChange={setFpEmail} placeholder="Enter registered email" />
            <button type="button" className={'btn btn-primary fp-submit' + f('fpSubmit')} onClick={submitForgot}>
              Reset Password Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
