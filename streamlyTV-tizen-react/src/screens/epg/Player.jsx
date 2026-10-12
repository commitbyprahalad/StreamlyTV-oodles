/**
 * Full-screen player overlay on top of the EPG.
 *
 * Remote:
 *   UP          now-playing info (toggle)        DOWN  hide info
 *   LEFT/RIGHT  channel strip; then LEFT/RIGHT move, OK switches channel
 *   CH+ / CH-   previous / next channel          OK    play / pause (Retry on error)
 *   Play/Pause media keys toggle; Stop or BACK closes (BACK hides overlays first)
 *
 * While open: DRM-key session heartbeat 8s after start and every 2 min, plus
 * a 6h-inactivity session check (same as the current app).
 */
import React, { useEffect, useRef, useState } from 'react';
import { FaPlay, FaPause } from 'react-icons/fa';
import { useKeys, onAnyKey, PRIORITY } from '../../core/keys';
import { popup } from '../../core/popup';
import { addToRecentCheck, handleSessionExpired } from '../../core/session';
import { Spinner } from '../../core/loading';
import { KEY } from '../../lib/keys';
import { set, remove, getToken, K } from '../../lib/storage';
import { exitApp } from '../../lib/tizen';
import { createPlayerEngine } from './playerEngine';
import { fetchDrmKeys, getDrm } from './epgApi';
import { nowSec } from './timeline';

const CARD_W = 160;
const CARD_GAP = 14;
const STRIP_W = 1820;
const STRIP_WINDOW = 14;

function liveProgram(ch) {
  if (!ch || !Array.isArray(ch.program)) return null;
  const now = nowSec();
  for (let i = 0; i < ch.program.length; i++) {
    if (ch.program[i].start <= now && now <= ch.program[i].end) return ch.program[i];
  }
  return null;
}

export default function Player(props) {
  const channels = props.channels;
  const videoRef = useRef(null);
  const engineRef = useRef(null);
  const [index, setIndex] = useState(props.startIndex);
  const [spinner, setSpinner] = useState(true);
  const [error, setError] = useState(false);
  const [icon, setIcon] = useState(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [listVisible, setListVisible] = useState(false);
  const [listFocus, setListFocus] = useState(props.startIndex);
  const timers = useRef({ icon: null, list: null });
  const activeRef = useRef(true);

  function close() {
    activeRef.current = false;
    if (engineRef.current) engineRef.current.destroy();
    remove(K.CHANNEL_URL);
    props.onClose();
  }

  function play(i) {
    const ch = channels[i];
    if (!ch || !ch.url) return;
    if (!getToken()) {
      handleSessionExpired();
      return;
    }
    setIndex(i);
    setListFocus(i);
    setError(false);
    setSpinner(true);
    set(K.CHANNEL_URL, ch.url);
    const drm = getDrm();
    engineRef.current.load(ch.url, drm.drmData, drm.license);
    // Start playing right away; the session check runs in parallel.
    addToRecentCheck(function (result) {
      if (result === 'expired' && activeRef.current) close();
    });
  }

  // Engine + lifecycle
  useEffect(function () {
    engineRef.current = createPlayerEngine({
      video: videoRef.current,
      onSpinner: setSpinner,
      onError: function () { setError(true); },
      onStarted: function () { setError(false); },
    });

    function onVisibility() {
      if (!engineRef.current) return;
      if (document.hidden) engineRef.current.suspend();
      else engineRef.current.restore();
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Session heartbeat (fetchDrmKeys shows the session popup on 401)
    let lastActivity = Date.now();
    const offKey = onAnyKey(function () { lastActivity = Date.now(); });
    const first = setTimeout(fetchDrmKeys, 8000);
    const heartbeat = setInterval(fetchDrmKeys, 2 * 60 * 1000);
    const inactivity = setInterval(function () {
      if (Date.now() - lastActivity > 6 * 60 * 60 * 1000) fetchDrmKeys();
    }, 60 * 60 * 1000);

    play(props.startIndex);

    return function () {
      activeRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      offKey();
      clearTimeout(first);
      clearInterval(heartbeat);
      clearInterval(inactivity);
      clearTimeout(timers.current.icon);
      clearTimeout(timers.current.list);
      if (engineRef.current) engineRef.current.destroy();
    };
  }, []);

  function flashIcon(kind) {
    if (!kind) return;
    setIcon(kind);
    clearTimeout(timers.current.icon);
    timers.current.icon = setTimeout(function () { setIcon(null); }, 2000);
  }

  function toggle(force) {
    flashIcon(engineRef.current.togglePlayPause(force));
  }

  function resetListTimer() {
    clearTimeout(timers.current.list);
    timers.current.list = setTimeout(function () { setListVisible(false); }, 5000);
  }

  function showList() {
    setInfoVisible(false);
    setListFocus(index);
    setListVisible(true);
    resetListTimer();
  }

  function step(dir) {
    const next = dir === 'up' ? Math.max(0, index - 1) : Math.min(channels.length - 1, index + 1);
    if (next === index) return;
    setListVisible(false);
    setInfoVisible(false);
    play(next);
  }

  function showExit() {
    popup.exit(function (yes) { if (yes) exitApp(); });
  }

  useKeys(function (code) {
    if (code === KEY.EXIT) {
      showExit();
      return;
    }
    if (code === KEY.CH_UP) {
      step('up');
      return;
    }
    if (code === KEY.CH_DOWN) {
      step('down');
      return;
    }
    if (listVisible) {
      switch (code) {
        case KEY.LEFT:
          setListFocus(Math.max(0, listFocus - 1));
          resetListTimer();
          break;
        case KEY.RIGHT:
          setListFocus(Math.min(channels.length - 1, listFocus + 1));
          resetListTimer();
          break;
        case KEY.ENTER:
          setListVisible(false);
          if (listFocus !== index) play(listFocus);
          break;
        case KEY.UP:
          setListVisible(false);
          setInfoVisible(true);
          break;
        case KEY.DOWN:
        case KEY.BACK:
          setListVisible(false);
          break;
        default:
          break;
      }
      return;
    }
    switch (code) {
      case KEY.UP:
        setInfoVisible(!infoVisible);
        break;
      case KEY.DOWN:
        setInfoVisible(false);
        break;
      case KEY.LEFT:
      case KEY.RIGHT:
        showList();
        break;
      case KEY.ENTER:
        if (error) {
          setError(false);
          engineRef.current.retry();
        } else toggle();
        break;
      case KEY.PLAY_PAUSE:
        toggle();
        break;
      case KEY.PLAY:
        toggle('play');
        break;
      case KEY.PAUSE:
        toggle('pause');
        break;
      case KEY.STOP:
        close();
        break;
      case KEY.BACK:
        if (infoVisible) setInfoVisible(false);
        else close();
        break;
      default:
        break;
    }
  }, { priority: PRIORITY.PLAYER });

  const ch = channels[index] || {};
  const prog = infoVisible ? liveProgram(ch) : null;
  let durText = '';
  if (prog && prog.end && prog.start) {
    const mins = Math.round((prog.end - prog.start) / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    durText = (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'min' : '');
  }

  // Channel strip: only a window of cards around the focused one
  const stripOffset = Math.max(0, listFocus * (CARD_W + CARD_GAP) - STRIP_W / 2 + CARD_W / 2);
  const stripCards = [];
  if (listVisible) {
    const from = Math.max(0, listFocus - STRIP_WINDOW);
    const to = Math.min(channels.length - 1, listFocus + STRIP_WINDOW);
    for (let i = from; i <= to; i++) {
      const c = channels[i];
      stripCards.push(
        <div key={i} className={'pch-card' + (i === listFocus ? ' focused' : '') + (i === index ? ' active' : '')}
          style={{ left: i * (CARD_W + CARD_GAP) + 'px' }}
          onClick={function () { setListVisible(false); play(i); }}>
          <span className="pch-num">{c.id || ''}</span>
          {c.image ? <img className="pch-logo" src={c.image} alt="" /> : <span className="pch-name">{c.callSign || ''}</span>}
        </div>
      );
    }
  }

  return (
    <div className="player">
      <video id="video-player" ref={videoRef} className="player-video" />

      {spinner && !error && (
        <div className="player-spinner"><Spinner /></div>
      )}

      {icon && (
        <div className="player-icon">{icon === 'play' ? <FaPlay /> : <FaPause />}</div>
      )}

      {error && (
        <div className="player-error">
          <p>Technical issue. Please try again later.</p>
          <button type="button" className="btn btn-primary focused"
            onClick={function () { setError(false); engineRef.current.retry(); }}>Retry</button>
        </div>
      )}

      {infoVisible && (
        <div className="npo">
          <div className="npo-logo-wrap">
            {(prog && prog.image) || ch.image
              ? <img className="npo-logo" src={(prog && prog.image) || ch.image} alt="" />
              : <div className="npo-logo-empty" />}
          </div>
          <div className="npo-info">
            <div className="npo-live">LIVE</div>
            <div className="npo-title">{(prog && prog.title) || ch.stationName || 'Live TV'}</div>
            <div className="npo-meta">
              {durText && <span className="npo-badge">{durText}</span>}
              {ch.quals && <span className="npo-badge">{ch.quals}</span>}
            </div>
            <div className="npo-desc">{(prog && prog.description) || ''}</div>
          </div>
        </div>
      )}

      {listVisible && (
        <div className="pch-list">
          <div className="pch-track" style={{ transform: 'translate3d(' + -stripOffset + 'px,0,0)' }}>{stripCards}</div>
        </div>
      )}
    </div>
  );
}
