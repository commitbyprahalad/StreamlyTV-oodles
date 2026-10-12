/**
 * Settings: sidebar (Settings/back, Account, Devices, Support, Privacy and
 * Policy, Terms of Use, FAQ, Sign Out) + content card.
 *
 * Remote (same as the current app):
 *  - Sidebar: UP/DOWN move, OK opens the page (and moves into it), RIGHT
 *    goes back into the open page, BACK leaves Settings.
 *  - Content: UP/DOWN between items (Privacy/Terms scroll instead), LEFT or
 *    BACK return to the sidebar; device cards are a 3-column grid.
 *  - Account: OK on Account Details starts Delete Account (not for HOA sub
 *    users); OK on Subscription cancels / resumes it (not for custom users).
 */
import React, { useEffect, useRef, useState } from 'react';
import { FaArrowLeft, FaChevronDown } from 'react-icons/fa';
import { useKeys, PRIORITY } from '../../core/keys';
import { popup } from '../../core/popup';
import { loading } from '../../core/loading';
import { nav } from '../../core/nav';
import { useInternetMonitor } from '../../core/internet';
import { logoutRequest } from '../../core/session';
import { KEY } from '../../lib/keys';
import { API } from '../../config/api';
import { formData } from '../../lib/http';
import { get, clearSession, getToken, sanitize, K } from '../../lib/storage';
import { exitApp, getAppVersion } from '../../lib/tizen';
import { timeAgo } from '../../lib/format';
import OtpDialog from '../../components/OtpDialog';
import TvInput, { handleEditingKey } from '../../components/TvInput';
import { fetchPrivacyPolicy, fetchTermsOfUse, fetchSupportInfo } from '../../services/content';
import { apiPage, apiOtp, isApiSuccess, isOtpLimitReached, OTP_LIMIT_MESSAGE } from './settingsApi';
import { buildAccountView, unwrapAccount } from './accountView';

const MENU = [
  { page: 'account', label: 'Account', icon: 'images/icons/user-03.png', title: 'Account Settings' },
  { page: 'device', label: 'Devices', icon: 'images/icons/devices.png', title: 'Connected Devices' },
  { page: 'support', label: 'Support', icon: 'images/icons/24-support.svg', title: 'Support' },
  { page: 'privacy', label: 'Privacy and Policy', icon: 'images/icons/file-05.png', title: 'Privacy and Policy' },
  { page: 'terms', label: 'Terms of Use', icon: 'images/icons/terms.svg', title: 'Terms of Use' },
  { page: 'faq', label: 'FAQ', icon: 'images/icons/annotation-question.svg', title: 'FAQ' },
  { page: 'signout', label: 'Sign Out', icon: 'images/icons/log-out-01.png', title: 'Sign Out' },
];
const DEVICE_COLS = 3;
const TEXT_SCROLL = 60;

function personalName(device) {
  const n = device.personaldevicename;
  return n === null || n === undefined || n === '' ? 'NA' : n;
}

export default function Settings() {
  const [page, setPage] = useState('account');
  const [zone, setZone] = useState('sidebar'); // sidebar | content
  const [sideIndex, setSideIndex] = useState(1); // 0 = back
  const [contentIndex, setContentIndex] = useState(0);
  const [faqOpen, setFaqOpen] = useState(-1);
  const [data, setData] = useState({}); // per-page cache
  const [failed, setFailed] = useState({});
  const [signoutFocus, setSignoutFocus] = useState(null); // null | 0 | 1
  const [otp, setOtp] = useState(null); // { kind, subtext, error, sentAt, resetToken, verifyToken }
  const [pwd, setPwd] = useState(null); // { value, error, focus, editing }
  const textRef = useRef(null);
  const contentRef = useRef(null);
  const cache = useRef({});

  useInternetMonitor(true);

  useEffect(function () {
    if (!getToken()) {
      nav.go('login');
      return;
    }
    loadPage('account');
    return function () {
      loading.hide();
    };
  }, []);

  // ── Data ──────────────────────────────────────────────────────────────
  function store(key, value) {
    cache.current[key] = value;
    setData(Object.assign({}, cache.current));
  }

  function markFailed(key, value) {
    setFailed(function (f) {
      const next = Object.assign({}, f);
      next[key] = value;
      return next;
    });
  }

  function loadPage(p, force) {
    if (!force && cache.current[p]) return;
    markFailed(p, false);
    if (p === 'account') {
      loading.show();
      apiPage('GET', API.SETTING_DETAILS).then(function (res) {
        loading.hide();
        if (res) store('account', unwrapAccount(res));
        else markFailed('account', true);
      });
    } else if (p === 'device') {
      loading.show();
      apiPage('GET', API.NEW_CONNECTED_DEVICE).then(function (res) {
        loading.hide();
        if (res && res.success) store('device', res);
        else markFailed('device', true);
      });
    } else if (p === 'faq') {
      loading.show();
      apiPage('GET', API.FAQ).then(function (res) {
        loading.hide();
        if (!res) {
          markFailed('faq', true);
          return;
        }
        let items = res.data && (res.success || res.status === 'success') ? res.data : res;
        if (!Array.isArray(items)) items = items.faq || items.FAQ || items.questions || items.data || [];
        store('faq', items);
      });
    } else if (p === 'privacy' || p === 'terms') {
      loading.show();
      (p === 'privacy' ? fetchPrivacyPolicy() : fetchTermsOfUse()).then(function (doc) {
        loading.hide();
        store(p, doc);
      }, function () {
        loading.hide();
        markFailed(p, true);
      });
    } else if (p === 'support') {
      fetchSupportInfo().then(function (info) { store('support', info); });
    }
  }

  // Subscription changed: always refetch (never flip local flags)
  function refreshAccount(done) {
    loading.show('Updating subscription...');
    apiPage('GET', API.SETTING_DETAILS).then(function (res) {
      loading.hide();
      if (res) store('account', unwrapAccount(res));
      else popup.alert('Failed to refresh subscription details.');
      if (done) done();
    });
  }

  const account = data.account ? buildAccountView(data.account) : buildAccountView(null);
  const deviceList = (function () {
    const list = data.device && Array.isArray(data.device.data) ? data.device.data.slice() : [];
    const current = get(K.DEVICE_ID) || '';
    // "This Device" always first
    list.sort(function (a, b) {
      const ac = !!current && a.device_id === current;
      const bc = !!current && b.device_id === current;
      return ac === bc ? 0 : (ac ? -1 : 1);
    });
    return list.map(function (d) {
      return Object.assign({}, d, { isCurrent: !!current && d.device_id === current });
    });
  })();
  const faqItems = Array.isArray(data.faq) ? data.faq : [];

  // Focusable content items of the open page
  function contentItems() {
    if (page === 'account') {
      if (!data.account) return [];
      const items = ['account', 'subscription'];
      if (!account.isCustomUser) items.push('card');
      return items;
    }
    if (page === 'device') return deviceList.map(function (d, i) { return 'device-' + i; });
    if (page === 'faq') return faqItems.map(function (f, i) { return 'faq-' + i; });
    if (page === 'privacy' || page === 'terms') return data[page] ? ['text'] : [];
    return [];
  }

  // ── Navigation ────────────────────────────────────────────────────────
  function openPage(p) {
    if (p === 'signout') {
      setSignoutFocus(0);
      return;
    }
    if (p !== page) {
      setPage(p);
      setContentIndex(0);
      setFaqOpen(-1);
      if (textRef.current) textRef.current.scrollTop = 0;
      loadPage(p);
    }
    if (p !== 'support') setZone('content');
  }

  function toSidebar() {
    setZone('sidebar');
    const idx = MENU.map(function (m) { return m.page; }).indexOf(page);
    setSideIndex(idx + 1);
  }

  function leaveSettings() {
    nav.go('epg');
  }

  // ── Device removal ────────────────────────────────────────────────────
  function confirmRemoveDevice(device) {
    if (!device.session_id) return;
    popup.confirm('Are you sure you want to remove this device?', function (yes) {
      if (!yes) return;
      loading.show('Removing device...');
      apiPage('POST', API.SAME_DEVICE_ID_LOGOUT, { id: device.session_id }).then(function (res) {
        loading.hide();
        if (res && res.success) {
          delete cache.current.device;
          loadPage('device', true);
        } else {
          popup.alert((res && res.message) || 'Failed to remove device.');
        }
      });
    }, 'Yes', 'No');
  }

  // ── Sign out ──────────────────────────────────────────────────────────
  function signOut() {
    setSignoutFocus(null);
    loading.show('Signing out...');
    logoutRequest().then(function () {
      loading.hide();
      clearSession();
      nav.go('guide');
    });
  }

  // ── OTP flows (Delete Account / Resume Subscription) ─────────────────
  const OTP_FLOWS = {
    delete: {
      sendUrl: API.ACCOUNT_DELETE_OTP,
      verifyUrl: API.ACCOUNT_DELETE_OTP_VERIFY,
      action: 'delete_account',
      name: 'Delete Account',
      defaultText: 'OTP sent to your email. Enter it below to delete your account.',
    },
    resume: {
      sendUrl: API.ACCOUNT_OTP_SEND,
      verifyUrl: API.ACCOUNT_OTP_VERIFY,
      action: 'resume_subscription',
      name: 'Resume Subscription',
      defaultText: 'OTP sent to your email. Enter it below to resume your subscription.',
    },
  };

  function sendOtp(kind, resend) {
    const flow = OTP_FLOWS[kind];
    loading.show(resend ? 'Resending OTP...' : 'Sending OTP...');
    apiOtp('POST', flow.sendUrl, formData({ action: flow.action })).then(function (res) {
      loading.hide();
      if (isApiSuccess(res)) {
        setOtp(function (o) {
          return {
            kind: kind,
            subtext: (res && res.message) || flow.defaultText,
            error: '',
            sentAt: Date.now(),
            resetToken: Date.now(),
            verifyToken: 0,
          };
        });
        return;
      }
      const limit = isOtpLimitReached(res);
      const msg = limit ? ((res && res.message) || OTP_LIMIT_MESSAGE)
        : ((res && res.message) || (kind === 'delete' ? 'Something went wrong. Please try again.'
          : (resend ? 'Failed to resend OTP. Please try again.' : 'Failed to send OTP. Please try again.')));
      // Delete: any send failure closes the dialog. Resume: only the daily
      // limit does (a resend can be retried once the timer allows).
      if (kind === 'delete' || limit) setOtp(null);
      popup.alert(msg);
    });
  }

  function setOtpError(message, reset) {
    setOtp(function (o) {
      if (!o) return o;
      return Object.assign({}, o, { error: message, resetToken: reset ? Date.now() : o.resetToken });
    });
  }

  function verifyOtp(code) {
    if (!otp) return;
    const kind = otp.kind;
    const flow = OTP_FLOWS[kind];
    if (!/^[0-9]{6}$/.test(code)) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }
    setOtpError('');
    loading.show('Verifying OTP...');
    apiOtp('POST', flow.verifyUrl, formData({ otp: code, action: flow.action })).then(function (res) {
      loading.hide();
      if (!isApiSuccess(res)) {
        // Wrong / expired code: clear the digits so a fresh code is entered
        setOtpError((res && res.message) || 'Invalid or expired OTP. Please try again.', true);
        return;
      }
      if (kind === 'delete') {
        popup.confirm('Are you sure you want to delete your account? Your subscription will be cancelled and this action cannot be undone.',
          function (yes) {
            if (yes) deleteAccount();
            else setOtp(function (o) { return o ? Object.assign({}, o, { verifyToken: Date.now() }) : o; });
          }, 'Yes', 'Cancel');
      } else {
        setOtp(null);
        popup.confirm('Are you sure you want to resume your subscription?', function (yes) {
          if (yes) resumeSubscription();
        }, 'Yes', 'No');
      }
    });
  }

  function deleteAccount() {
    loading.show('Deleting account...');
    apiPage('POST', API.USER_DELETE).then(function (res) {
      loading.hide();
      if (isApiSuccess(res)) {
        setOtp(null);
        clearSession();
        nav.go('login');
      } else {
        setOtpError((res && res.message) || 'Failed to delete account. Please try again.');
      }
    });
  }

  function resumeSubscription() {
    loading.show('Resuming subscription...');
    apiPage('POST', API.SUBSCRIPTION_RESUME).then(function (res) {
      loading.hide();
      if (res && (res.success || isApiSuccess(res))) {
        popup.alert(res.message || 'Your subscription has been resumed.');
        refreshAccount();
      } else {
        popup.alert((res && res.message) || 'Failed to resume subscription. Please try again.');
      }
    });
  }

  function closeOtp() {
    if (!otp) return;
    popup.confirm('Are you sure you want to stop the ' + OTP_FLOWS[otp.kind].name + ' process?', function (yes) {
      if (yes) setOtp(null);
    }, 'Yes', 'No');
  }

  // ── Cancel subscription (password -> confirm -> DELETE) ──────────────
  function openPassword() {
    setPwd({ value: '', error: '', focus: 'input', editing: false });
  }

  function updatePwd(patch) {
    setPwd(function (p) { return p ? Object.assign({}, p, patch) : p; });
  }

  function verifyPassword() {
    if (!pwd) return;
    updatePwd({ editing: false });
    if (!pwd.value) {
      updatePwd({ error: 'Please enter your password.' });
      return;
    }
    loading.show('Verifying password...');
    apiOtp('POST', API.VERIFY_PASSWORD, formData({ password: pwd.value }), true).then(function (res) {
      loading.hide();
      if (!isApiSuccess(res)) {
        updatePwd({ error: (res && res.message) || 'Incorrect password. Please try again.' });
        return;
      }
      setPwd(null);
      popup.confirm('Are you sure you want to cancel your subscription?', function (yes) {
        if (yes) cancelSubscription();
      }, 'Yes', 'No');
    });
  }

  function cancelSubscription() {
    if (!account.userId) {
      popup.alert('Unable to cancel subscription: missing account information.');
      return;
    }
    loading.show('Cancelling subscription...');
    apiPage('DELETE', API.CANCEL_SUBSCRIPTION + account.userId).then(function (res) {
      loading.hide();
      if (res && (res.success || isApiSuccess(res))) {
        popup.alert(res.message || 'Your subscription has been cancelled.');
        refreshAccount();
      } else {
        popup.alert((res && res.message) || 'Failed to cancel subscription. Please try again.');
      }
    });
  }

  // ── Content OK ────────────────────────────────────────────────────────
  function activateContent(id) {
    if (!id) return;
    if (id === 'account') {
      if (account.canDelete) {
        popup.confirm('Are you sure you want to delete your account?', function (yes) {
          if (yes) sendOtp('delete');
        }, 'OK', 'Cancel');
      }
    } else if (id === 'subscription') {
      if (!account.isCustomUser) {
        if (account.canceled) sendOtp('resume');
        else openPassword();
      }
    } else if (id.indexOf('faq-') === 0) {
      const i = Number(id.slice(4));
      setFaqOpen(faqOpen === i ? -1 : i);
    } else if (id.indexOf('device-') === 0) {
      const d = deviceList[Number(id.slice(7))];
      if (d && !d.isCurrent) confirmRemoveDevice(d);
    }
  }

  // ── Keys: main ────────────────────────────────────────────────────────
  useKeys(function (code) {
    if (code === KEY.EXIT) {
      popup.exit(function (yes) { if (yes) exitApp(); });
      return;
    }
    if (zone === 'sidebar') {
      if (code === KEY.UP && sideIndex > 0) setSideIndex(sideIndex - 1);
      else if (code === KEY.DOWN && sideIndex < MENU.length) setSideIndex(sideIndex + 1);
      else if (code === KEY.ENTER) {
        if (sideIndex === 0) leaveSettings();
        else openPage(MENU[sideIndex - 1].page);
      } else if (code === KEY.RIGHT) {
        const idx = MENU.map(function (m) { return m.page; }).indexOf(page);
        setSideIndex(idx + 1);
        if (contentItems().length) setZone('content');
      } else if (code === KEY.BACK) leaveSettings();
      return;
    }

    const items = contentItems();
    const i = Math.min(contentIndex, Math.max(0, items.length - 1));
    const isText = page === 'privacy' || page === 'terms';
    const isGrid = page === 'device';
    switch (code) {
      case KEY.UP:
        if (isText) {
          if (textRef.current) textRef.current.scrollTop -= TEXT_SCROLL;
        } else if (isGrid) {
          if (i - DEVICE_COLS >= 0) setContentIndex(i - DEVICE_COLS);
        } else if (i > 0) setContentIndex(i - 1);
        break;
      case KEY.DOWN:
        if (isText) {
          if (textRef.current) textRef.current.scrollTop += TEXT_SCROLL;
        } else if (isGrid) {
          if (i + DEVICE_COLS < items.length) setContentIndex(i + DEVICE_COLS);
          else if (Math.floor(i / DEVICE_COLS) < Math.floor((items.length - 1) / DEVICE_COLS)) setContentIndex(items.length - 1);
        } else if (i < items.length - 1) setContentIndex(i + 1);
        break;
      case KEY.LEFT:
        if (isGrid && i % DEVICE_COLS !== 0) setContentIndex(i - 1);
        else toSidebar();
        break;
      case KEY.RIGHT:
        if (isGrid && i % DEVICE_COLS < DEVICE_COLS - 1 && i + 1 < items.length) setContentIndex(i + 1);
        break;
      case KEY.ENTER:
        activateContent(items[i]);
        break;
      case KEY.BACK:
        toSidebar();
        break;
      default:
        break;
    }
  }, { enabled: signoutFocus === null && !otp && !pwd });

  // Sign-out overlay
  useKeys(function (code) {
    if (code === KEY.LEFT) setSignoutFocus(0);
    else if (code === KEY.RIGHT) setSignoutFocus(1);
    else if (code === KEY.ENTER) {
      if (signoutFocus === 1) signOut();
      else setSignoutFocus(null);
    } else if (code === KEY.BACK) setSignoutFocus(null);
  }, { priority: PRIORITY.MODAL, enabled: signoutFocus !== null });

  // Cancel-subscription password overlay
  useKeys(function (code) {
    if (!pwd) return undefined;
    if (pwd.editing) {
      const r = handleEditingKey(code, function () { updatePwd({ editing: false }); });
      if (r === 'native') return 'native';
      if (r === 'handled') return undefined;
    }
    const f = pwd.focus;
    if (code === KEY.UP && f !== 'input') updatePwd({ focus: 'input' });
    else if (code === KEY.DOWN && f === 'input') updatePwd({ focus: 'submit' });
    else if (code === KEY.LEFT && f === 'submit') updatePwd({ focus: 'cancel' });
    else if (code === KEY.RIGHT && (f === 'cancel' || f === 'input')) updatePwd({ focus: 'submit' });
    else if (code === KEY.ENTER) {
      if (f === 'input') updatePwd({ editing: true });
      else if (f === 'cancel') setPwd(null);
      else verifyPassword();
    } else if (code === KEY.BACK) setPwd(null);
    return undefined;
  }, { priority: PRIORITY.MODAL, enabled: !!pwd });

  // Keep the focused content item in view
  useEffect(function () {
    const box = contentRef.current;
    if (!box || zone !== 'content') return;
    const el = box.querySelector('.focus-target');
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 20);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 20;
  }, [contentIndex, zone, page, faqOpen]);

  // ── Render ────────────────────────────────────────────────────────────
  const items = contentItems();
  const focusedId = zone === 'content' ? items[Math.min(contentIndex, Math.max(0, items.length - 1))] : null;
  function cf(id, silent) {
    if (focusedId !== id) return '';
    return silent ? ' focus-target' : ' focused focus-target';
  }

  const menuItem = MENU.filter(function (m) { return m.page === page; })[0];

  function renderAccount() {
    if (failed.account) return <div className="muted-text">Failed to load account data</div>;
    if (!data.account) return <div className="muted-text">Loading...</div>;
    return (
      <div>
        <div className={'settings-section' + cf('account')}>
          <div className="section-title">Account Details</div>
          <div className="detail-grid">
            {account.details.map(function (row) {
              return (
                <div key={row[0]} className="detail-item">
                  <div className="detail-label">{row[0]}</div>
                  <div className="detail-value">{sanitize(row[1])}</div>
                </div>
              );
            })}
          </div>
          {account.canDelete && <div className="section-action danger">Delete Account</div>}
        </div>
        <div className={'settings-section' + cf('subscription', account.isCustomUser)}>
          <div className="section-title">Subscription</div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-label">Current Plan</div>
              <div className="detail-value">{sanitize(account.planDisplay)}</div>
            </div>
            <div className="detail-item">
              <div className="detail-label">{account.dateLabel}</div>
              <div className="detail-value">{sanitize(account.dateValue)}</div>
            </div>
          </div>
          {!account.isCustomUser && (
            <div className={'section-action' + (account.canceled ? ' resume' : ' danger')}>
              {account.canceled ? 'Resume Subscription' : 'Cancel Subscription'}
            </div>
          )}
        </div>
        {!account.isCustomUser && (
          <div className={'settings-section' + cf('card', true)}>
            <div className="section-title">Card Details</div>
            <div className="detail-grid">
              <div className="detail-item">
                <div className="detail-label">Card Type</div>
                <div className="detail-value">{sanitize(account.cardBrand)}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Card Number</div>
                <div className="detail-value">{sanitize(account.cardNumber)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderDevices() {
    if (failed.device) return <div className="muted-text">Failed to load devices</div>;
    if (!data.device) return <div className="muted-text">Loading devices...</div>;
    const total = data.device.numofdevice !== undefined && data.device.numofdevice !== null ? data.device.numofdevice : deviceList.length;
    const limit = data.device.userDeviceLimit !== undefined && data.device.userDeviceLimit !== null ? data.device.userDeviceLimit : '—';
    return (
      <div>
        <div className="device-count">Devices <span>{total + ' / ' + limit}</span></div>
        {!deviceList.length && <div className="muted-text">No devices connected.</div>}
        <div className="settings-device-grid">
          {deviceList.map(function (d, i) {
            return (
              <div key={(d.session_id || '') + i} className={'settings-device-card' + cf('device-' + i)}
                onClick={function () { if (!d.isCurrent) confirmRemoveDevice(d); }}>
                <div className="sd-top">
                  <img src={d.device_img || 'images/normaltv.png'} alt="" className="sd-img" />
                  {d.isCurrent
                    ? <span className="sd-badge"><img src="images/icons/check-circle.png" alt="" />This Device</span>
                    : <span className="sd-logout">Logout Device</span>}
                </div>
                <div className="sd-ip"><span>IP</span><span>{sanitize(d.user_ip || 'N/A')}</span></div>
                <div className="sd-line"><strong>Device:</strong> {sanitize(d.device_name || 'Device')}</div>
                <div className="sd-line"><strong>Type:</strong> {sanitize(d.device_type || 'N/A')}</div>
                <div className="sd-line"><strong>Login:</strong> {timeAgo(d.logintime)}</div>
                <div className="sd-line"><strong>Name:</strong> {sanitize(personalName(d))}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSupport() {
    const s = data.support;
    if (!s) return <div className="muted-text">Loading...</div>;
    return (
      <div className="support-layout">
        <img src="images/help.png" alt="" className="support-img" />
        <p className="support-text">{s.message1}</p>
        {s.message2 && <p className="support-text small">{s.message2}</p>}
        <div className="support-contacts">
          <div className="support-contact">
            <img src="images/icons/phone.png" alt="" />
            <div><span className="contact-label">Phone</span><span className="contact-value">{s.phone}</span></div>
          </div>
          <div className="support-contact">
            <img src="images/icons/mail-01.png" alt="" />
            <div><span className="contact-label">Email</span><span className="contact-value">{s.email}</span></div>
          </div>
        </div>
        <div className="support-version">{'Version ' + (s.version || getAppVersion())}</div>
      </div>
    );
  }

  function renderText(key, fallbackTitle) {
    if (failed[key]) return <div className="muted-text">{'Failed to load ' + fallbackTitle}</div>;
    const doc = data[key];
    if (!doc) return <div className="muted-text">Loading...</div>;
    return (
      <div className="policy">
        <div className="policy-title">{doc.title || fallbackTitle}</div>
        {doc.paragraphs.map(function (p, i) {
          return <p key={i} className="policy-text">{p}</p>;
        })}
      </div>
    );
  }

  function renderFaq() {
    if (failed.faq) return <div className="muted-text">Failed to load FAQ</div>;
    if (!data.faq) return <div className="muted-text">Loading...</div>;
    if (!faqItems.length) return <div className="muted-text">No FAQs available</div>;
    return (
      <div className="faq-list">
        {faqItems.map(function (item, i) {
          const q = item.question_key || item.question || item.Question || item.title || 'Question';
          const a = item.question_answer || item.answer || item.Answer || item.description || '';
          return (
            <div key={i} className={'faq-item' + cf('faq-' + i) + (faqOpen === i ? ' expanded' : '')}
              onClick={function () { setFaqOpen(faqOpen === i ? -1 : i); }}>
              <div className="faq-question"><span>{sanitize(q)}</span><FaChevronDown className="faq-arrow" /></div>
              {faqOpen === i && <div className="faq-answer">{sanitize(a)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  const isText = page === 'privacy' || page === 'terms';

  return (
    <div className="screen settings">
      <div className="settings-sidebar">
        <div className={'sidebar-back' + (zone === 'sidebar' && sideIndex === 0 ? ' focused' : '')} onClick={leaveSettings}>
          <FaArrowLeft className="back-arrow" />
          <span>Settings</span>
        </div>
        {MENU.map(function (m, i) {
          const active = m.page === page;
          const focused = zone === 'sidebar' && sideIndex === i + 1;
          return (
            <div key={m.page}
              className={'menu-item' + (active ? ' active' : '') + (focused ? ' focused' : '') + (m.page === 'signout' ? ' signout' : '')}
              onClick={function () { setSideIndex(i + 1); openPage(m.page); }}>
              <img src={m.icon} alt="" className="menu-icon" />
              <span>{m.label}</span>
            </div>
          );
        })}
      </div>

      <div className="settings-content">
        <div className="content-card">
          <div className="content-header">{menuItem ? menuItem.title : ''}</div>
          <div
            className={'content-body' + (isText ? ' scrollbar-primary' : '') + (isText && zone === 'content' ? ' text-focused' : '')}
            ref={function (el) { contentRef.current = el; textRef.current = isText ? el : null; }}
          >
            {page === 'account' && renderAccount()}
            {page === 'device' && renderDevices()}
            {page === 'support' && renderSupport()}
            {page === 'privacy' && renderText('privacy', 'Privacy & Policy')}
            {page === 'terms' && renderText('terms', 'Terms of Use')}
            {page === 'faq' && renderFaq()}
          </div>
        </div>
      </div>

      {signoutFocus !== null && (
        <div className="overlay-dim">
          <div className="dialog signout-dialog">
            <img src="images/logout-bg.png" alt="" className="signout-img" />
            <div className="dialog-title">Are you sure you want to logout from this device?</div>
            <div className="dialog-buttons">
              <button type="button" className={'btn btn-outline' + (signoutFocus === 0 ? ' focused' : '')}
                onClick={function () { setSignoutFocus(null); }}>No</button>
              <button type="button" className={'btn btn-primary' + (signoutFocus === 1 ? ' focused' : '')}
                onClick={signOut}>Yes, I'm Sure</button>
            </div>
          </div>
        </div>
      )}

      {otp && (
        <OtpDialog
          title="Verification Code"
          subtext={otp.subtext}
          error={otp.error}
          sentAt={otp.sentAt}
          resetToken={otp.resetToken}
          focusVerifyToken={otp.verifyToken}
          onClearError={function () { if (otp.error) setOtpError(''); }}
          onVerify={verifyOtp}
          onResend={function () { sendOtp(otp.kind, true); }}
          onClose={closeOtp}
        />
      )}

      {pwd && (
        <div className="overlay-dim">
          <div className="dialog">
            <div className="dialog-title">Confirm Your Password</div>
            <div className="dialog-text">Please enter your account password to continue cancelling your subscription.</div>
            <TvInput id="cancel-sub-password" type="password" value={pwd.value}
              onChange={function (v) { updatePwd({ value: v, error: '' }); }} placeholder="Enter password"
              focused={pwd.focus === 'input'} editing={pwd.editing}
              onStopEditing={function () { updatePwd({ editing: false }); }}
              onClick={function () { updatePwd({ focus: 'input', editing: true }); }} />
            <div className="dialog-error">{pwd.error}</div>
            <div className="dialog-buttons">
              <button type="button" className={'btn btn-outline' + (pwd.focus === 'cancel' ? ' focused' : '')}
                onClick={function () { setPwd(null); }}>Cancel</button>
              <button type="button" className={'btn btn-primary' + (pwd.focus === 'submit' ? ' focused' : '')}
                onClick={verifyPassword}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
