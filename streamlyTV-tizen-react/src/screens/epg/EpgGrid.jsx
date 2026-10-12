/**
 * Virtualised EPG grid. Only rows in (or next to) the viewport are in the
 * DOM, and per row only the programmes that overlap the visible time
 * window. Scrolling is a translate3d on composited layers (GPU), never
 * scrollTop/scrollLeft, which keeps navigation smooth on TV hardware even
 * with hundreds of channels.
 *
 * While a scroll animation runs, the render window covers both the old and
 * the new position so nothing pops in mid-animation.
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import {
  ROW_H, CHANNEL_W, GRID_W, GRID_H, TIME_H, SLOT_W, TIMELINE_W, timeToX, isLive,
} from './timeline';
import { formatShortDate } from '../../lib/format';

const H_OVERSCAN = 400;
const V_OVERSCAN = 2;
const ANIM_MS = 180;

function useRenderWindow(scrollX, scrollY) {
  const [win, setWin] = useState({ x0: scrollX, x1: scrollX, y0: scrollY, y1: scrollY });
  const last = useRef({ x: scrollX, y: scrollY });
  useEffect(function () {
    const prev = last.current;
    last.current = { x: scrollX, y: scrollY };
    setWin({
      x0: Math.min(prev.x, scrollX), x1: Math.max(prev.x, scrollX),
      y0: Math.min(prev.y, scrollY), y1: Math.max(prev.y, scrollY),
    });
    const t = setTimeout(function () {
      setWin({ x0: scrollX, x1: scrollX, y0: scrollY, y1: scrollY });
    }, ANIM_MS + 40);
    return function () {
      clearTimeout(t);
    };
  }, [scrollX, scrollY]);
  // Render immediately with the union even before the effect runs
  return {
    x0: Math.min(win.x0, scrollX), x1: Math.max(win.x1, scrollX),
    y0: Math.min(win.y0, scrollY), y1: Math.max(win.y1, scrollY),
  };
}

const ProgramCard = memo(function ProgramCard(props) {
  const c = props.card;
  const shade = props.live ? Math.max(0, Math.min(c.width, props.nowX - c.left)) : 0;
  return (
    <div
      className={'program-card' + (props.live ? ' live' : '') + (props.focused ? ' focused' : '') + (c.noData ? ' no-data' : '')}
      style={{ left: c.left + 'px', width: c.width + 'px' }}
      onClick={props.onClick}
    >
      {props.live && <div className="program-elapsed" style={{ width: shade + 'px' }} />}
      <div className="program-inner">
        <div className="program-title">{c.title}</div>
        <div className="program-time">{c.timeText}</div>
        {!c.noData && (
          <div className="program-meta">
            {c.type && <span className="program-type">{c.type}</span>}
            <span className="program-duration">{c.duration}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default function EpgGrid(props) {
  const rows = props.rows; // [{ channel, cards }]
  const focus = props.focus;
  const win = useRenderWindow(props.scrollX, props.scrollY);
  const nowX = timeToX(props.now, props.firstSlot);

  const firstRow = Math.max(0, Math.floor(win.y0 / ROW_H) - V_OVERSCAN);
  const lastRow = Math.min(rows.length - 1, Math.ceil((win.y1 + GRID_H) / ROW_H) + V_OVERSCAN);
  const minX = win.x0 - H_OVERSCAN;
  const maxX = win.x1 + GRID_W + H_OVERSCAN;

  const channelItems = [];
  const programRows = [];
  for (let i = firstRow; i <= lastRow; i++) {
    const row = rows[i];
    if (!row) continue;
    const ch = row.channel;
    const top = i * ROW_H;
    const rowFocused = props.gridFocused && focus.row === i;
    channelItems.push(
      <div key={'c' + i} className={'channel-item' + (rowFocused && focus.col === -1 ? ' focused' : '')}
        style={{ top: top + 'px' }} onClick={function () { props.onSelect(i, -1); }}>
        {ch.image ? <img className="channel-logo" src={ch.image} alt="" /> : <div className="channel-logo-empty" />}
        <div className="channel-number">{ch.id}</div>
        <div className="channel-name">{ch.callSign && ch.callSign !== 'NA' ? ch.callSign : (ch.stationName || 'Channel ' + ch.id)}</div>
      </div>
    );

    const cards = [];
    for (let j = 0; j < row.cards.length; j++) {
      const c = row.cards[j];
      if (c.left + c.width < minX || c.left > maxX) continue;
      cards.push(
        <ProgramCard key={c.key} card={c} live={isLive(c, props.now)} nowX={nowX}
          focused={rowFocused && focus.col === j} onClick={function () { props.onSelect(i, j); }} />
      );
    }
    programRows.push(
      <div key={'r' + i} className="program-row" style={{ top: top + 'px' }}>{cards}</div>
    );
  }

  // Live line: only across rows that have a programme on air
  const liveVisible = nowX >= props.scrollX && nowX <= props.scrollX + GRID_W && props.liveRange.first !== -1;

  // Day indicator follows the time at the left edge of the viewport
  const leftTime = props.firstSlot + (props.scrollX / 10) * 60;
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  const dayLabel = leftTime * 1000 >= tomorrow.getTime() ? 'Tomorrow' : 'Today';

  const slotFirst = Math.max(0, Math.floor(minX / SLOT_W));
  const slotLast = Math.min(props.slots.length - 1, Math.ceil(maxX / SLOT_W));
  const slotEls = [];
  for (let s = slotFirst; s <= slotLast; s++) {
    slotEls.push(
      <div key={s} className="time-slot" style={{ left: s * SLOT_W + 'px' }}>{props.slots[s].label}</div>
    );
  }

  const y = -props.scrollY;
  const x = -props.scrollX;

  return (
    <div className="epg-grid">
      <div className="day-indicator" style={{ width: CHANNEL_W + 'px', height: TIME_H + 'px' }}>
        <div className="day-text">{dayLabel}</div>
        <div className="date-text">{formatShortDate(new Date(leftTime * 1000))}</div>
      </div>
      <div className="time-header" style={{ left: CHANNEL_W + 'px', height: TIME_H + 'px' }}>
        <div className="time-track" style={{ width: TIMELINE_W + 'px', transform: 'translate3d(' + x + 'px,0,0)' }}>
          {slotEls}
        </div>
      </div>
      <div className="channel-column" style={{ top: TIME_H + 'px', width: CHANNEL_W + 'px' }}>
        <div className="channel-track" style={{ height: rows.length * ROW_H + 'px', transform: 'translate3d(0,' + y + 'px,0)' }}>
          {channelItems}
        </div>
      </div>
      <div className="program-viewport" style={{ top: TIME_H + 'px', left: CHANNEL_W + 'px' }}>
        <div className="program-track"
          style={{ width: TIMELINE_W + 'px', height: rows.length * ROW_H + 'px', transform: 'translate3d(' + x + 'px,' + y + 'px,0)' }}>
          {programRows}
          {liveVisible && (
            <div className="live-line" style={{
              left: nowX + 'px',
              top: props.liveRange.first * ROW_H + 'px',
              height: (props.liveRange.last - props.liveRange.first + 1) * ROW_H + 'px',
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
