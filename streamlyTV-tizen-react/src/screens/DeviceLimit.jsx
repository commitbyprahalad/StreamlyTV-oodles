/**
 * Device limit reached (login returned 479): the logged-in devices are shown
 * as cards; OK on one removes it, then the app logs in again with the same
 * method (email / passcode) and continues normally.
 */
import React, { useState } from 'react';
import { useKeys } from '../core/keys';
import { popup } from '../core/popup';
import { loading } from '../core/loading';
import { nav } from '../core/nav';
import { checkApiResponse } from '../core/session';
import { KEY } from '../lib/keys';
import { API } from '../config/api';
import { request, requestWithRetry } from '../lib/http';
import { get, getJSON, setJSON, K } from '../lib/storage';
import { exitApp, buildDevicePayload, appendDeviceFields } from '../lib/tizen';
import { timeAgo } from '../lib/format';
import Header from '../components/Header';
import { processLoginResponse } from '../services/auth';

function deviceName(device) {
  const name = device.personaldevicename;
  return name === null || name === undefined || name === '' ? 'NA' : name;
}

export default function DeviceLimit() {
  const [devices] = useState(function () {
    const list = getJSON(K.DEVICE_LIST, null) || getJSON(K.DEVICES, []);
    return Array.isArray(list) ? list : [];
  });
  const [focus, setFocus] = useState(0);

  function relogin() {
    const device = buildDevicePayload();
    const method = get(K.LOGIN_METHOD);
    const fd = new FormData();
    let url = API.LOGIN;
    let identity;
    if (method === 'passcode') {
      url = API.LOGIN_WITH_PASSCODE;
      fd.append('passcode', get(K.PASSCODE) || '');
      identity = { method: 'passcode', passcode: get(K.PASSCODE) || '' };
    } else {
      fd.append('email', get(K.EMAIL) || '');
      fd.append('password', get(K.PASSWORD) || '');
      identity = { method: method || 'email', email: get(K.EMAIL) || '', password: get(K.PASSWORD) || '' };
    }
    appendDeviceFields(fd, device);

    requestWithRetry('POST', url, { body: fd }).then(function (data) {
      // Still over the limit: refresh the list and stay here.
      if (data && Number(data.response_code) === 479 && data.loggedindeviceinfolist) {
        setJSON(K.DEVICE_LIST, data.loggedindeviceinfolist.data || []);
        loading.hide();
        nav.go('device');
        return;
      }
      if (data && !data.success && Number(data.response_code) !== 410) {
        loading.hide();
        nav.go('login');
        return;
      }
      processLoginResponse(data, identity, device, {
        onFailure: function () { nav.go('login'); },
      });
    }, function () {
      loading.hide();
      popup.alert('Network error. Please try again.');
    });
  }

  function removeDevice(sessionId) {
    loading.show('Removing device...');
    request('POST', API.SAME_DEVICE_ID_LOGOUT, { body: { id: sessionId } }).then(function (res) {
      if (res.status < 200 || res.status >= 300 || !res.data) {
        loading.hide();
        popup.alert('Network error. Please try again.');
        return;
      }
      if (checkApiResponse(res.data)) {
        loading.hide();
        return;
      }
      if (res.data.success) {
        relogin();
      } else {
        loading.hide();
        popup.alert(res.data.message || 'Failed to remove device.');
      }
    }, function () {
      loading.hide();
      popup.alert('Network error. Please try again.');
    });
  }

  function confirmRemove(device) {
    popup.confirm('Are you sure you want to remove this device?', function (yes) {
      if (yes) removeDevice(device.session_id || '');
    });
  }

  useKeys(function (code) {
    switch (code) {
      case KEY.LEFT:
      case KEY.UP:
        if (focus > 0) setFocus(focus - 1);
        break;
      case KEY.RIGHT:
      case KEY.DOWN:
        if (focus < devices.length - 1) setFocus(focus + 1);
        break;
      case KEY.ENTER:
        if (devices[focus]) confirmRemove(devices[focus]);
        break;
      case KEY.BACK:
        nav.go('login');
        break;
      case KEY.EXIT:
        popup.confirm('Do you want to exit?', function (yes) { if (yes) exitApp(); });
        break;
      default:
        break;
    }
  });

  // Keep the focused card in view (4 cards per row, 330px per row)
  const row = Math.floor(focus / 4);
  const offset = Math.max(0, row - 1) * 330;

  return (
    <div className="screen device-limit">
      <Header />
      <div className="device-limit-body">
        <h2 className="page-heading">Devices</h2>
        <p className="page-subheading">{'Total connected devices: ' + devices.length}</p>
        <p className="page-hint">Your device limit is over. Select a device and press OK to remove it.</p>
        <div className="device-limit-viewport">
          <div className="device-limit-grid" style={{ transform: 'translate3d(0,' + -offset + 'px,0)' }}>
            {devices.length === 0 && <p className="empty-text">No devices connected.</p>}
            {devices.map(function (device, i) {
              return (
                <div key={(device.session_id || '') + i} className={'device-card' + (i === focus ? ' focused' : '')}
                  onClick={function () { setFocus(i); confirmRemove(device); }}>
                  <img src="images/normaltv.png" alt="TV" className="device-card-icon" />
                  <div className="device-card-info">
                    <p className="device-card-name">{device.device_name || 'Device'}</p>
                    <p className="device-card-detail"><span>IP:</span> {device.user_ip || 'N/A'}</p>
                    <p className="device-card-detail"><span>Type:</span> {device.device_type || 'N/A'}</p>
                    <p className="device-card-detail"><span>Login:</span> {timeAgo(device.logintime)}</p>
                    <p className="device-card-detail"><span>Name:</span> {deviceName(device)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
