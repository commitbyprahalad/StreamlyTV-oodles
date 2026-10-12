/**
 * Programme details (upcoming programmes). Poster, channel + title, time,
 * duration / quality / genre badges, description, and the schedule grouped
 * into Today / Tomorrow. "Play Now" is only offered for the first card on
 * the row (the programme currently airing). BACK closes, OK plays.
 */
import React from 'react';
import { useKeys, PRIORITY } from '../../core/keys';
import { KEY } from '../../lib/keys';
import { formatTime, formatIsoDuration, formatLongDate } from '../../lib/format';
import { nowSec } from './timeline';

function dayKey(date) {
  return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
}

function groupSchedule(schedule) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const groups = { today: [], tomorrow: [] };
  const now = nowSec();
  (schedule || []).forEach(function (item) {
    const d = new Date(item.start * 1000);
    const entry = { label: formatTime(item.start), live: item.start <= now && now <= item.end };
    if (dayKey(d) === dayKey(today)) groups.today.push(entry);
    else if (dayKey(d) === dayKey(tomorrow)) groups.tomorrow.push(entry);
  });
  return groups;
}

export default function ProgramModal(props) {
  const p = props.program;
  const canPlay = props.programIndex === 0;

  useKeys(function (code) {
    if (code === KEY.BACK) props.onClose();
    else if (code === KEY.ENTER && canPlay) props.onPlay();
  }, { priority: PRIORITY.MODAL });

  const groups = groupSchedule(p.schedule);
  const first = p.schedule && p.schedule[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <div className="program-modal">
      <div className="program-modal-content">
        <div className="pm-left">
          <div className="pm-poster">
            {p.image ? <img src={p.image} alt="" /> : <div className="pm-poster-empty" />}
          </div>
          <div className="pm-info">
            <h1 className="pm-channel">{p.stationName || 'Unknown Channel'}</h1>
            <div className="pm-title">{p.title || 'Untitled'}</div>
            {first && <div className="pm-time">{formatTime(first.start) + ' - ' + formatTime(first.end)}</div>}
            <div className="pm-badges">
              {p.duration && <span className="badge">{formatIsoDuration(p.duration)}</span>}
              {p.quals && <span className="badge">{p.quals}</span>}
              {p.genre && p.genre[0] && <span className="badge badge-genre">{p.genre[0]}</span>}
            </div>
            <p className="pm-description">{p.description || 'No description available.'}</p>
            {canPlay && (
              <button type="button" className="btn btn-primary pm-play focused" onClick={props.onPlay}>
                <img src="images/icons/play-circle.png" alt="" /> Play Now
              </button>
            )}
          </div>
        </div>
        <div className="pm-right">
          <h3 className="pm-schedule-title">Schedule</h3>
          {!groups.today.length && !groups.tomorrow.length && <p className="pm-schedule-empty">No upcoming schedule</p>}
          {groups.today.length > 0 && (
            <div className="pm-day">
              <h4>Today</h4>
              <div className="pm-day-date">{formatLongDate(new Date())}</div>
              <div className="pm-chips">
                {groups.today.map(function (e, i) {
                  return <span key={i} className={'pm-chip' + (e.live ? ' live' : '')}>{e.label}</span>;
                })}
              </div>
            </div>
          )}
          {groups.tomorrow.length > 0 && (
            <div className="pm-day">
              <h4>Tomorrow</h4>
              <div className="pm-day-date">{formatLongDate(tomorrow)}</div>
              <div className="pm-chips">
                {groups.tomorrow.map(function (e, i) {
                  return <span key={i} className="pm-chip">{e.label}</span>;
                })}
              </div>
            </div>
          )}
          <p className="pm-hint">Press BACK to close</p>
        </div>
      </div>
    </div>
  );
}
