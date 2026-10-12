/**
 * Electronic Programme Guide.
 *
 * Remote (same rules as the current app):
 *  - Header: GO LIVE and Settings. GO LIVE resets the timeline to now.
 *  - Channel logo: OK plays the channel. RIGHT enters its programmes.
 *  - Programme: OK on the one airing now plays it; any other opens details.
 *  - UP/DOWN keep the same point in time across rows.
 *  - BACK: grid -> GO LIVE -> exit popup.
 * Channels load page by page in the background (offset API); reaching the
 * last rows also restarts a stalled page load.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useKeys } from '../../core/keys';
import { popup } from '../../core/popup';
import { loading } from '../../core/loading';
import { nav } from '../../core/nav';
import { useInternetMonitor } from '../../core/internet';
import { addToRecentCheck, handleSessionExpired } from '../../core/session';
import { KEY } from '../../lib/keys';
import { get, getToken, K } from '../../lib/storage';
import { exitApp } from '../../lib/tizen';
import { getZipCode } from '../../lib/geo';
import { formatClock } from '../../lib/format';
import { LOGO } from '../../components/Header';
import EpgGrid from './EpgGrid';
import ProgramModal from './ProgramModal';
import Player from './Player';
import { fetchEpgPage, fetchProgramDetails, fetchDrmKeys, storeSubSession } from './epgApi';
import {
  ROW_H, GRID_W, GRID_H, TIMELINE_W, roundedSlotStart, buildSlots, prepareRow, isLive, findCardAt, nowSec,
} from './timeline';

const PAGE_RETRY_MAX = 3;
const KEY_REPEAT_MS = 90;

function clampScrollY(row, total) {
  const max = Math.max(0, total * ROW_H - GRID_H);
  return Math.max(0, Math.min(max, row * ROW_H - GRID_H / 2 + ROW_H / 2));
}

export default function Epg() {
  const [channels, setChannels] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [firstSlot, setFirstSlot] = useState(roundedSlotStart);
  const [now, setNow] = useState(nowSec);
  const [focus, setFocus] = useState({ zone: 'grid', header: 'live', row: 0, col: -1, anchor: null });
  const [scrollX, setScrollX] = useState(0);
  const [modal, setModal] = useState(null); // { program, programIndex, url, row }
  const [player, setPlayer] = useState(null); // { index, id }
  const [clock, setClock] = useState(new Date());

  const paging = useRef({ page: 0, hasMore: false, loading: false, retries: 0, generation: 0 });
  const zipRef = useRef(get(K.ZIPCODE) || '');
  const lastKey = useRef(0);
  const playedFromLive = useRef(false);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  useInternetMonitor(true);

  const rows = useMemo(function () {
    return channels.map(function (ch) {
      return { channel: ch, cards: prepareRow(ch, firstSlot) };
    });
  }, [channels, firstSlot]);

  const slots = useMemo(function () {
    return buildSlots(firstSlot);
  }, [firstSlot]);

  // Rows with a programme on air (live line span); recomputed every tick
  const liveRange = useMemo(function () {
    let first = -1;
    let last = -1;
    for (let i = 0; i < rows.length; i++) {
      const cards = rows[i].cards;
      for (let j = 0; j < cards.length; j++) {
        if (isLive(cards[j], now)) {
          if (first === -1) first = i;
          last = i;
          break;
        }
      }
    }
    return { first: first, last: last };
  }, [rows, now]);

  // ── Data ──────────────────────────────────────────────────────────────
  function loadNextPage(userTriggered) {
    const p = paging.current;
    if (!p.hasMore || p.loading) return;
    if (userTriggered) p.retries = 0;
    p.loading = true;
    const generation = p.generation;
    const next = p.page + 1;
    fetchEpgPage(next, { timeout: 20000, zipcode: zipRef.current }).then(function (res) {
      if (generation !== p.generation) return;
      p.loading = false;
      p.retries = 0;
      p.page = next;
      p.hasMore = res.hasMore;
      if (res.channels.length) {
        setChannels(function (old) { return old.concat(res.channels); });
      }
      if (res.hasMore) setTimeout(function () { loadNextPage(false); }, 50);
    }, function (err) {
      if (generation !== p.generation) return;
      p.loading = false;
      if (err.kind === 'auth') {
        p.hasMore = false;
        return;
      }
      p.retries++;
      if (p.retries <= PAGE_RETRY_MAX) {
        setTimeout(function () {
          if (generation === p.generation) loadNextPage(false);
        }, 2000 * p.retries);
      }
    });
  }

  function loadGuide() {
    const p = paging.current;
    p.generation++;
    p.page = 0;
    p.hasMore = false;
    p.loading = false;
    p.retries = 0;
    const generation = p.generation;

    loading.show('Loading channels...');
    fetchEpgPage(1, { timeout: 30000, zipcode: zipRef.current }).then(function (res) {
      if (generation !== p.generation) return;
      loading.hide();
      p.page = 1;
      p.hasMore = res.hasMore;
      setChannels(res.channels);
      setLoaded(true);
      setFocus({ zone: 'grid', header: 'live', row: 0, col: -1, anchor: null });
      setScrollX(0);
      if (res.hasMore) setTimeout(function () { loadNextPage(false); }, 50);
    }, function (err) {
      if (generation !== p.generation) return;
      loading.hide();
      if (err.kind === 'auth') return;
      const msg = err.kind === 'timeout' ? 'Request timed out. Please try again.'
        : err.kind === 'network' ? 'Network error. Please check your connection and try again.'
          : 'Unable to load the guide. Please try again.';
      popup.alert(msg, loadGuide);
    });
  }

  useEffect(function () {
    if (get(K.SESSION_EXPIRE) === 'session_expire') {
      handleSessionExpired();
      return undefined;
    }
    if (get(K.PERSONAL_DEVICE_POPUP) === 'true') {
      nav.go('personalDevice');
      return undefined;
    }
    if (!getToken()) {
      nav.go('login');
      return undefined;
    }

    storeSubSession();
    addToRecentCheck();
    fetchDrmKeys();
    getZipCode().then(function (zip) {
      zipRef.current = zip;
      loadGuide();
    });

    // Live line / shading / clock tick
    const tick = setInterval(function () {
      setNow(nowSec());
      setClock(new Date());
    }, 10000);

    // At every :00 / :30 the past slot drops off the timeline
    let slotInterval = null;
    const d = new Date();
    const minsToNext = d.getMinutes() < 30 ? 30 - d.getMinutes() : 60 - d.getMinutes();
    const msToNext = (minsToNext * 60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 500;
    function slotRefresh() {
      setFirstSlot(roundedSlotStart());
      setNow(nowSec());
      setScrollX(0);
      setFocus(function (f) {
        return f.zone === 'grid' ? Object.assign({}, f, { col: -1, anchor: null }) : f;
      });
    }
    const slotTimer = setTimeout(function () {
      slotRefresh();
      slotInterval = setInterval(slotRefresh, 30 * 60 * 1000);
    }, msToNext);

    return function () {
      paging.current.generation++;
      clearInterval(tick);
      clearTimeout(slotTimer);
      clearInterval(slotInterval);
      loading.hide();
    };
  }, []);

  // ── Focus helpers ─────────────────────────────────────────────────────
  function cardsOf(row) {
    return rows[row] ? rows[row].cards : [];
  }

  function focusCard(row, col, anchor) {
    const card = cardsOf(row)[col];
    if (!card) return;
    setFocus({ zone: 'grid', header: 'live', row: row, col: col, anchor: anchor === undefined ? null : anchor });
    // Horizontal scroll: bring the card into view, 100px from the left edge
    const visibleW = Math.min(card.width, GRID_W);
    if (card.left < scrollX || card.left + visibleW > scrollX + GRID_W) {
      setScrollX(Math.max(0, Math.min(TIMELINE_W - GRID_W, card.left - 100)));
    }
  }

  function focusChannel(row) {
    setFocus({ zone: 'grid', header: 'live', row: row, col: -1, anchor: null });
  }

  function focusHeader(which) {
    setFocus(Object.assign({}, focus, { zone: 'header', header: which, anchor: null }));
  }

  function goLive() {
    setFirstSlot(roundedSlotStart());
    setNow(nowSec());
    setScrollX(0);
    if (rows.length) focusChannel(0);
  }

  function anchorTime() {
    if (focus.anchor !== null) return focus.anchor;
    const card = cardsOf(focus.row)[focus.col];
    if (!card || card.noData) return null;
    return Math.max(card.start, firstSlot);
  }

  function moveRow(target) {
    if (focus.col >= 0) {
      const time = anchorTime();
      const idx = findCardAt(cardsOf(target), time, focus.col);
      focusCard(target, Math.max(0, idx), time);
    } else {
      focusChannel(target);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function openPlayer(index) {
    const ch = channels[index];
    if (!ch || !ch.url) return;
    setModal(null);
    setPlayer({ index: index, id: Date.now() });
  }

  function onPlayerClosed() {
    setPlayer(null);
    if (playedFromLive.current) {
      playedFromLive.current = false;
      setFocus(function (f) { return Object.assign({}, f, { col: -1, anchor: null }); });
    }
  }

  function openDetails(row, col) {
    const ch = channels[row];
    const card = cardsOf(row)[col];
    if (!ch || !card || !card.tmsId) return;
    let details = null;
    let sessionOk = false;
    let expired = false;
    function showWhenReady() {
      if (!details || !sessionOk || expired) return;
      setModal({ program: details, programIndex: col, row: row });
    }
    addToRecentCheck(function (result) {
      if (result === 'expired') {
        expired = true;
        return;
      }
      sessionOk = true;
      showWhenReady();
    });
    fetchProgramDetails(ch.id, card.tmsId).then(function (data) {
      if (!data) return;
      details = data;
      showWhenReady();
    }, function () {
      popup.alert('Unable to load programme details. Please check your internet connection and try again.');
    });
  }

  function enter() {
    if (focus.zone === 'header') {
      if (focus.header === 'live') goLive();
      else nav.go('settings');
      return;
    }
    if (focus.col === -1) {
      if (!channels[focus.row] || !channels[focus.row].url) return;
      openPlayer(focus.row);
      return;
    }
    const card = cardsOf(focus.row)[focus.col];
    if (!card) return;
    if (isLive(card, nowSec())) {
      playedFromLive.current = true;
      openPlayer(focus.row);
    } else {
      openDetails(focus.row, focus.col);
    }
  }

  function showExit() {
    popup.exit(function (yes) { if (yes) exitApp(); });
  }

  useKeys(function (code) {
    if (code === KEY.EXIT) {
      showExit();
      return;
    }
    if (code === KEY.BACK) {
      if (focus.zone === 'grid') focusHeader('live');
      else showExit();
      return;
    }
    if (code === KEY.ENTER) {
      enter();
      return;
    }
    // Throttle held-down arrows so the grid never falls behind the remote
    const t = Date.now();
    if (t - lastKey.current < KEY_REPEAT_MS) return;
    lastKey.current = t;

    const total = rows.length;
    if (focus.zone === 'header') {
      if (code === KEY.RIGHT && focus.header === 'live') focusHeader('settings');
      else if (code === KEY.LEFT && focus.header === 'settings') focusHeader('live');
      else if (code === KEY.UP && focus.header === 'settings') focusHeader('live');
      else if (code === KEY.DOWN && total) focusChannel(0);
      return;
    }
    switch (code) {
      case KEY.UP:
        if (focus.row === 0) focusHeader('live');
        else moveRow(focus.row - 1);
        break;
      case KEY.DOWN:
        if (focus.row >= total - 3) loadNextPage(true);
        if (focus.row < total - 1) moveRow(focus.row + 1);
        break;
      case KEY.LEFT:
        if (focus.col > 0) focusCard(focus.row, focus.col - 1);
        else if (focus.col === 0) focusChannel(focus.row);
        else focusHeader('live');
        break;
      case KEY.RIGHT:
        if (focus.col < cardsOf(focus.row).length - 1) focusCard(focus.row, focus.col + 1);
        break;
      default:
        break;
    }
  }, { enabled: !player && !modal });

  // Live button: red "LIVE" while the focus is on now (channel / first card)
  const onNow = focus.zone === 'grid' && (focus.col === -1 || focus.col === 0);
  const liveFocused = focus.zone === 'header' && focus.header === 'live';
  const scrollY = clampScrollY(focus.row, rows.length);

  return (
    <div className={'screen epg' + (player ? ' epg-behind-player' : '')}>
      <div className="epg-header">
        <img src={LOGO} alt="StreamlyTV" className="epg-logo" />
        <button type="button" className={'live-btn' + (onNow && !liveFocused ? ' is-live' : '') + (liveFocused ? ' focused' : '')}
          onClick={goLive}>{onNow && !liveFocused ? 'LIVE' : 'GO LIVE'}</button>
        <button type="button" className={'icon-btn' + (focus.zone === 'header' && focus.header === 'settings' ? ' focused' : '')}
          onClick={function () { nav.go('settings'); }}>
          <img src="images/icons/settings-02.png" alt="Settings" />
        </button>
        <div className="epg-clock">{formatClock(clock)}</div>
      </div>

      {loaded && rows.length > 0 && (
        <EpgGrid
          rows={rows}
          slots={slots}
          firstSlot={firstSlot}
          now={now}
          focus={focus}
          gridFocused={focus.zone === 'grid'}
          scrollX={scrollX}
          scrollY={scrollY}
          liveRange={liveRange}
          onSelect={function (row, col) {
            if (col === -1) focusChannel(row);
            else focusCard(row, col);
          }}
        />
      )}
      {loaded && rows.length === 0 && <div className="epg-empty">No channels available.</div>}

      {modal && (
        <ProgramModal
          program={modal.program}
          programIndex={modal.programIndex}
          onClose={function () { setModal(null); }}
          onPlay={function () { openPlayer(modal.row); }}
        />
      )}

      {player && (
        <Player key={player.id} channels={channels} startIndex={player.index} onClose={onPlayerClosed} />
      )}
    </div>
  );
}
