/**
 * Hotel tier users pick their room: 5-column grid (natural sort, "Room 2"
 * before "Room 10"), live search, Logout. Selecting a room syncs the
 * session with it and opens the EPG.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FaSearch } from 'react-icons/fa';
import { useKeys } from '../core/keys';
import { popup } from '../core/popup';
import { loading } from '../core/loading';
import { nav } from '../core/nav';
import {
  addToRecentCheck, handleSessionExpired, handleSubscriptionExpired, logoutRequest,
} from '../core/session';
import { KEY } from '../lib/keys';
import { API } from '../config/api';
import { request, formData } from '../lib/http';
import { get, getJSON, setJSON, set, remove, clearSession, getToken, K } from '../lib/storage';
import { exitApp } from '../lib/tizen';
import TvInput, { handleEditingKey } from '../components/TvInput';
import { LOGO } from '../components/Header';

const COLS = 5;
const ROW_HEIGHT = 230;

function sortRooms(list) {
  return list.slice().sort(function (a, b) {
    return String(a.hotel_room || '').localeCompare(String(b.hotel_room || ''), undefined, {
      numeric: true, sensitivity: 'base',
    });
  });
}

function authFailure(data) {
  const code = data ? Number(data.response_code) : 0;
  if (code === 401) {
    handleSessionExpired();
    return true;
  }
  if (code === 410) {
    handleSubscriptionExpired(data.subscribedmsgis || data.message);
    return true;
  }
  return false;
}

export default function HotelRoom() {
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState('');
  const [zone, setZone] = useState('grid'); // logout | search | grid
  const [pos, setPos] = useState(0);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);

  const filtered = useMemo(function () {
    const q = query.toLowerCase().trim();
    if (!q) return rooms;
    return rooms.filter(function (r) {
      return String(r.hotel_room || '').toLowerCase().indexOf(q) !== -1;
    });
  }, [rooms, query]);

  function showNoRooms() {
    popup.confirm('No rooms available. Would you like to retry?', function (yes) {
      if (yes) fetchRooms();
    }, 'Retry', 'Cancel');
  }

  function fetchRooms() {
    loading.show('Loading rooms...');
    request('POST', API.GET_HOTEL_ROOMS, { token: getToken(), body: new FormData() }).then(function (res) {
      loading.hide();
      if (authFailure(res.data)) return;
      const list = res.data && Array.isArray(res.data.data) ? res.data.data : [];
      if (list.length) {
        setJSON(K.ROOMS, list);
        setRooms(sortRooms(list));
        setReady(true);
      } else {
        showNoRooms();
      }
    }, function () {
      loading.hide();
      showNoRooms();
    });
  }

  useEffect(function () {
    if (!getToken() || get(K.SESSION_EXPIRE) === 'session_expire') {
      handleSessionExpired();
      return;
    }
    const stored = getJSON(K.ROOMS, []);
    if (Array.isArray(stored) && stored.length) {
      setRooms(sortRooms(stored));
      setReady(true);
    } else {
      fetchRooms();
    }
  }, []);

  useEffect(function () {
    if (pos >= filtered.length) setPos(0);
  }, [filtered.length]);

  function syncRoom(room) {
    loading.show('Selecting room...');
    request('POST', API.SYNC_SESSION_WITH_ROOM, { token: getToken(), body: formData({ roomid: room.id }) })
      .then(function (res) {
        loading.hide();
        if (authFailure(res.data)) return;
        if (res.status >= 200 && res.status < 300 && res.data && res.data.success === true) {
          setJSON(K.SELECTED_ROOM, room);
          set(K.VIDEO_SELECTED_LOC, pos);
          nav.go('epg');
        } else {
          popup.alert('Could not sync room. Please try again.');
        }
      }, function () {
        loading.hide();
        popup.alert('Could not sync room. Please try again.');
      });
  }

  function selectRoom(room) {
    addToRecentCheck(function (result) {
      if (result === 'expired') return;
      popup.confirm('Are you sure you want to select ' + room.hotel_room + '?', function (yes) {
        if (yes) syncRoom(room);
      }, 'Yes', 'Cancel');
    });
  }

  function logout() {
    popup.logout(function (yes) {
      if (!yes) return;
      loading.show('Signing out...');
      logoutRequest().then(function () {
        loading.hide();
        clearSession();
        nav.go('login');
      });
    });
  }

  function showExit() {
    popup.exit(function (yes) {
      if (!yes) return;
      remove(K.SELECTED_ROOM);
      remove(K.VIDEO_SELECTED_LOC);
      exitApp();
    });
  }

  useKeys(function (code) {
    if (editing) {
      const r = handleEditingKey(code, function () { setEditing(false); });
      if (r === 'native') return 'native';
      if (r === 'handled') return undefined;
    }
    if (code === KEY.BACK || code === KEY.EXIT) {
      showExit();
      return undefined;
    }
    switch (code) {
      case KEY.UP:
        if (zone === 'search') setZone('logout');
        else if (zone === 'grid') {
          if (pos - COLS >= 0) setPos(pos - COLS);
          else setZone('search');
        }
        break;
      case KEY.DOWN:
        if (zone === 'logout') setZone('search');
        else if (zone === 'search') {
          if (filtered.length) setZone('grid');
        } else if (pos + COLS < filtered.length) setPos(pos + COLS);
        break;
      case KEY.LEFT:
        if (zone === 'grid' && pos > 0) setPos(pos - 1);
        break;
      case KEY.RIGHT:
        if (zone === 'grid' && pos < filtered.length - 1) setPos(pos + 1);
        break;
      case KEY.ENTER:
        if (zone === 'logout') logout();
        else if (zone === 'search') setEditing(true);
        else if (filtered[pos]) selectRoom(filtered[pos]);
        break;
      default:
        break;
    }
    return undefined;
  }, { enabled: ready });

  const row = Math.floor(pos / COLS);
  const offset = Math.max(0, row - 1) * ROW_HEIGHT;

  return (
    <div className="screen hotel-room">
      <div className="app-header hotel-header">
        <img src={LOGO} alt="Streamly" className="app-header-logo" />
        <div className="hotel-header-center">
          <span className="hotel-count">{rooms.length ? 'Total Available Rooms: ' + rooms.length : ''}</span>
          <h1 className="hotel-title">Hotel Login Streamly on your TV select room</h1>
        </div>
        <div className="app-header-right">
          <button type="button" className={'outline-btn' + (zone === 'logout' ? ' focused' : '')} onClick={logout}>Logout</button>
        </div>
      </div>

      <div className="hotel-search">
        <FaSearch className="hotel-search-icon" />
        <TvInput id="search" value={query} onChange={function (v) { setQuery(v); setPos(0); }}
          placeholder="Enter keyword (e.g. Rooms)" focused={zone === 'search'} editing={editing}
          onStopEditing={function () { setEditing(false); }} className="hotel-search-input"
          onClick={function () { setZone('search'); setEditing(true); }} />
      </div>

      <div className="hotel-viewport">
        <div className="hotel-grid" style={{ transform: 'translate3d(0,' + -offset + 'px,0)' }}>
          {filtered.map(function (room, i) {
            return (
              <div key={room.id + '-' + i}
                className={'room-card' + (zone === 'grid' && i === pos ? ' focused' : '')}
                onClick={function () { setZone('grid'); setPos(i); selectRoom(room); }}>
                <img src="images/room.png" alt="Room" className="room-card-icon" />
                <div className="room-card-name">{room.hotel_room}</div>
              </div>
            );
          })}
          {ready && !filtered.length && <p className="empty-text">No rooms match your search.</p>}
        </div>
      </div>
    </div>
  );
}
