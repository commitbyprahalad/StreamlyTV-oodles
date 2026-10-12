/**
 * EPG geometry and data preparation. The grid is a 48h timeline (96 x 30min
 * slots) starting at the current half hour; 10px per minute.
 */
import { formatTime, formatDurationWords } from '../../lib/format';

export const PX_PER_MIN = 10;
export const SLOT_W = 300; // 30 min
export const SLOT_COUNT = 96; // 48h
export const TIMELINE_W = SLOT_W * SLOT_COUNT;
export const ROW_H = 120;
export const CHANNEL_W = 220;
export const HEADER_H = 100;
export const TIME_H = 60;
export const GRID_W = 1920 - CHANNEL_W;
export const GRID_H = 1080 - HEADER_H - TIME_H;

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Current time rounded down to :00 / :30
export function roundedSlotStart() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30);
  return Math.floor(d.getTime() / 1000);
}

export function timeToX(t, firstSlot) {
  return ((t - firstSlot) / 60) * PX_PER_MIN;
}

export function buildSlots(firstSlot) {
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = firstSlot + i * 1800;
    slots.push({ time: t, label: formatTime(t) });
  }
  return slots;
}

// EP/MV/SH from the TMSId prefix ("EP005927270130" -> "EP")
function programType(tmsId) {
  if (!tmsId || tmsId.length < 2) return '';
  const code = tmsId.substring(0, 2).toUpperCase();
  return code === 'EP' || code === 'MV' || code === 'SH' ? code : '';
}

function stationFallbackTitle(ch) {
  const raw = String(ch.stationName || '').trim();
  // callSign is often the literal "NA"; stationName is the display name.
  return raw && raw.toUpperCase() !== 'NA' ? raw + ' Programme' : 'No Data Available';
}

/**
 * Cards for one channel row, positioned on the timeline. Programmes that
 * ended before the first slot are dropped (same as the current app); a row
 * with nothing left gets one full-width "no data" card so it can still be
 * focused.
 */
export function prepareRow(ch, firstSlot) {
  const cards = [];
  const progs = Array.isArray(ch.program) ? ch.program : [];
  for (let j = 0; j < progs.length; j++) {
    const p = progs[j];
    const start = Number(p.start) || 0;
    const end = Number(p.end) || 0;
    if (end <= firstSlot) continue;
    const left = Math.max(0, timeToX(start, firstSlot));
    const right = timeToX(end, firstSlot);
    const width = Math.max(0, right - left);
    const mins = Math.round((end - start) / 60);
    cards.push({
      key: j,
      title: p.title || 'Untitled',
      start: start,
      end: end,
      tmsId: p.TMSId || '',
      left: left,
      width: width,
      timeText: formatTime(start) + ' - ' + formatTime(end),
      type: programType(p.TMSId),
      duration: formatDurationWords(mins),
      noData: false,
    });
  }
  if (!cards.length) {
    cards.push({
      key: 'none',
      title: stationFallbackTitle(ch),
      start: 0,
      end: 0,
      tmsId: '',
      left: 0,
      width: TIMELINE_W,
      timeText: '--:-- - --:--',
      type: '',
      duration: '',
      noData: true,
    });
  }
  return cards;
}

export function isLive(card, now) {
  return !card.noData && card.start <= now && now <= card.end;
}

/**
 * Index of the card on a row airing at `time`, else the next one after it,
 * else the last; index-based when times are unknown (no-data rows).
 */
export function findCardAt(cards, time, fallback) {
  if (!cards.length) return -1;
  if (time === null || time === undefined) return Math.max(0, Math.min(fallback, cards.length - 1));
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].noData) return Math.max(0, Math.min(fallback, cards.length - 1));
    if (time < cards[i].end) return i;
  }
  return cards.length - 1;
}
