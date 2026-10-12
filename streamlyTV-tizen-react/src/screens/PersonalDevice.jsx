/**
 * First login on this TV: choose a name for the device (2-32 chars), then
 * continue to hotel rooms (tier users) or the EPG. Logout in the corner.
 */
import React, { useEffect, useState } from 'react';
import { FaAngleRight } from 'react-icons/fa';
import { useKeys } from '../core/keys';
import { popup } from '../core/popup';
import { loading } from '../core/loading';
import { nav } from '../core/nav';
import { checkApiResponse, addToRecentCheck, handleSessionExpired, logoutRequest } from '../core/session';
import { KEY } from '../lib/keys';
import { API } from '../config/api';
import { request, formData } from '../lib/http';
import { get, set, clearSession, getToken, sanitize, K } from '../lib/storage';
import { exitApp } from '../lib/tizen';
import TvInput, { handleEditingKey } from '../components/TvInput';
import { LOGO } from '../components/Header';

function routeAfterSetup() {
  if (get(K.USER_ROLE) === 'tieruser' && (get(K.IS_CUSTOM_USER) || '0') === '0' && !get(K.USER_TYPE)) {
    nav.go('hotelRoom');
  } else {
    nav.go('epg');
  }
}

function toLogin() {
  clearSession();
  nav.go('login');
}

export default function PersonalDevice() {
  const [focus, setFocus] = useState('next'); // logout | input | next
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(function () {
    if (!getToken()) {
      popup.alert('Session expired. Please login again.', toLogin);
      return;
    }
    if (!get(K.PERSONAL_DEVICE_ID)) {
      popup.alert('Device ID missing. Please login again.', toLogin);
      return;
    }
    if (get(K.SESSION_EXPIRE) === 'session_expire') {
      handleSessionExpired();
      return;
    }
    if (get(K.PERSONAL_DEVICE_POPUP) === 'false' && get(K.DEVICE_NAME)) {
      routeAfterSetup();
      return;
    }
    setReady(true);
  }, []);

  function save() {
    const value = name.trim();
    if (!value) return popup.alert('Please enter a device name.');
    if (value.length < 2) return popup.alert('Device name must be at least 2 characters.');
    if (value.length > 32) return popup.alert('Device name must be 32 characters or less.');

    addToRecentCheck(function (result) {
      if (result === 'expired') return;
      loading.show('Saving...');
      request('PUT', API.PERSONAL_DEVICE_NAME + get(K.PERSONAL_DEVICE_ID), {
        token: getToken(),
        body: formData({ device_type: 'non-web', devicename: value }),
      }).then(function (res) {
        loading.hide();
        if (res.status === 401) {
          popup.alert('Session expired. Please login again.', toLogin);
          return;
        }
        if (res.status < 200 || res.status >= 300) {
          popup.alert('Server error (' + res.status + '). Please try again.');
          return;
        }
        const data = res.data;
        if (!data || checkApiResponse(data)) return;
        if (data.success === true) {
          set(K.DEVICE_NAME, sanitize((data.data && data.data.devicename) || value));
          set(K.PERSONAL_DEVICE_POPUP, 'false');
          routeAfterSetup();
        } else {
          popup.alert(sanitize(data.message) || 'Failed to save device name. Please try again.');
        }
      }, function () {
        loading.hide();
        popup.alert('Network error. Please check your connection.');
      });
    });
  }

  function logout() {
    popup.logout(function (yes) {
      if (!yes) return;
      loading.show('Signing out...');
      logoutRequest().then(function () {
        loading.hide();
        toLogin();
      });
    });
  }

  useKeys(function (code) {
    if (editing) {
      const r = handleEditingKey(code, function () { setEditing(false); });
      if (r === 'native') return 'native';
      if (r === 'handled') return undefined;
    }
    switch (code) {
      case KEY.UP:
        if (focus === 'input') setFocus('logout');
        else if (focus === 'next') setFocus('input');
        break;
      case KEY.DOWN:
        if (focus === 'logout') setFocus('input');
        else if (focus === 'input') setFocus('next');
        break;
      case KEY.LEFT:
        if (focus === 'next') setFocus('input');
        break;
      case KEY.RIGHT:
        if (focus === 'input') setFocus('next');
        break;
      case KEY.ENTER:
        if (focus === 'next') save();
        else if (focus === 'logout') logout();
        else setEditing(true);
        break;
      case KEY.BACK:
      case KEY.EXIT:
        popup.exit(function (yes) { if (yes) exitApp(); });
        break;
      default:
        break;
    }
    return undefined;
  }, { enabled: ready });

  return (
    <div className="screen personal-device">
      <div className="app-header">
        <img src={LOGO} alt="Streamly" className="app-header-logo" />
        <div className="app-header-right">
          <button type="button" className={'outline-btn' + (focus === 'logout' ? ' focused' : '')} onClick={logout}>Logout</button>
        </div>
      </div>
      {ready && (
        <div className="pd-body">
          <h3 className="pd-title">Choose a name for your streamly device</h3>
          <p className="pd-text">
            A name will help identify your device when accessing it from other devices like your phone, tablet or computer.
          </p>
          <div className="pd-form">
            <TvInput id="devicename" value={name} onChange={setName} placeholder="Enter Device Name" maxLength={32}
              focused={focus === 'input'} editing={editing} onStopEditing={function () { setEditing(false); }}
              onClick={function () { setFocus('input'); setEditing(true); }} className="pd-input" />
            <button type="button" className={'btn btn-primary pd-next' + (focus === 'next' ? ' focused' : '')} onClick={save}>
              Next <FaAngleRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
