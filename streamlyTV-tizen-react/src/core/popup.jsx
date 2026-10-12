/**
 * Unified popup (alert / confirm / exit / logout / session / no-internet),
 * same wording and button order as the current app's PopupManager.
 *
 * Callable from anywhere (React or plain modules) through `popup`:
 *   popup.alert(msg, cb)
 *   popup.confirm(msg, cb(confirmed), confirmLabel='Yes', cancelLabel='Cancel')
 *   popup.exit(cb(confirmed)) / popup.logout(cb(confirmed), msg)
 *   popup.session(cb, msg) / popup.noInternet(retry, msg) / popup.isOpen()
 */
import React, { useEffect, useState } from 'react';
import { MdWifiOff } from 'react-icons/md';
import { useKeys, PRIORITY } from './keys';
import { KEY } from '../lib/keys';

let setPopupState = null;
let current = null;

function show(config) {
  current = config;
  if (setPopupState) setPopupState(config);
}

function close(index, cancelled) {
  const cfg = current;
  current = null;
  if (setPopupState) setPopupState(null);
  if (!cfg) return;
  if (cancelled && cfg.onCancel) cfg.onCancel();
  else if (cfg.onSelect) cfg.onSelect(index);
}

export const popup = {
  isOpen: function () {
    return !!current;
  },
  close: function () {
    current = null;
    if (setPopupState) setPopupState(null);
  },
  alert: function (message, cb) {
    show({ type: 'alert', message: message, buttons: ['OK'], focus: 0, onSelect: function () { if (cb) cb(); } });
  },
  confirm: function (message, cb, confirmLabel, cancelLabel) {
    show({
      type: 'confirm',
      message: message,
      buttons: [cancelLabel || 'Cancel', confirmLabel || 'Yes'],
      focus: 0,
      onSelect: function (idx) { if (cb) cb(idx === 1); },
      onCancel: function () { if (cb) cb(false); },
    });
  },
  exit: function (cb) {
    show({
      type: 'exit',
      message: 'Do you want to exit StreamlyTV?',
      buttons: ['Cancel', 'Exit'],
      focus: 0,
      onSelect: function (idx) { if (cb) cb(idx === 1); },
      onCancel: function () { if (cb) cb(false); },
    });
  },
  logout: function (cb, message) {
    show({
      type: 'logout',
      message: message || 'Are you sure you want to logout?',
      buttons: ['Cancel', 'Logout'],
      focus: 0,
      onSelect: function (idx) { if (cb) cb(idx === 1); },
      onCancel: function () { if (cb) cb(false); },
    });
  },
  session: function (cb, message) {
    show({
      type: 'session',
      message: message || 'Your session has expired. Please login again.',
      buttons: ['OK'],
      focus: 0,
      onSelect: function () { if (cb) cb(); },
    });
  },
  noInternet: function (retry, message) {
    show({
      type: 'nointernet',
      message: message || 'No internet connection. Please check your connection and try again.',
      buttons: ['Retry'],
      focus: 0,
      icon: 'wifi',
      onSelect: function () { if (retry) retry(); },
    });
  },
};

export function PopupHost() {
  const [state, setState] = useState(current);

  useEffect(function () {
    setPopupState = setState;
    return function () {
      setPopupState = null;
    };
  }, []);

  // On a TV the <video> element sits in a hardware plane above the page and
  // would hide the popup; hide it while a popup is open.
  useEffect(function () {
    const video = document.getElementById('video-player');
    if (!video) return undefined;
    if (state) {
      video.style.visibility = 'hidden';
      return function () {
        video.style.visibility = '';
      };
    }
    return undefined;
  }, [!!state]);

  useKeys(function (code) {
    if (!state) return;
    const count = state.buttons.length;
    if (code === KEY.LEFT || code === KEY.RIGHT) {
      const dir = code === KEY.RIGHT ? 1 : -1;
      const next = (state.focus + dir + count) % count;
      current = Object.assign({}, state, { focus: next });
      setState(current);
    } else if (code === KEY.ENTER) {
      close(state.focus, false);
    } else if (code === KEY.BACK) {
      // Back = Cancel when the popup has one, else the (only) button.
      close(0, !!state.onCancel);
    }
  }, { priority: PRIORITY.POPUP, enabled: !!state });

  if (!state) return null;

  return (
    <div className="pm-overlay">
      <div className="pm-box">
        {state.icon === 'wifi' && (
          <div className="pm-icon"><MdWifiOff /></div>
        )}
        <p className="pm-message">{state.message}</p>
        <div className="pm-buttons">
          {state.buttons.map(function (label, i) {
            return (
              <button
                key={label + i}
                type="button"
                className={'pm-btn' + (i === state.focus ? ' focused' : '')}
                onClick={function () { close(i, false); }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
