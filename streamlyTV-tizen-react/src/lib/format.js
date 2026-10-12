const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// Unix seconds -> "7:30 PM"
export function formatTime(unix) {
  const d = new Date(unix * 1000);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
}

export function formatClock(date) {
  let h = date.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + pad2(date.getMinutes()) + ' ' + ampm;
}

// "Mon, Oct 7" (toLocaleDateString options are unreliable on old engines)
export function formatShortDate(date) {
  return DAYS_SHORT[date.getDay()] + ', ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
}

// "Monday, Oct 7"
export function formatLongDate(date) {
  return DAYS_LONG[date.getDay()] + ', ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
}

// "2026-09-25 05:54:05" -> "Sep 25, 2026" (parsed by hand: old engines
// don't parse this format with Date()).
export function formatApiDate(value, longMonth) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  const months = longMonth ? MONTHS_LONG : MONTHS_SHORT;
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

// ISO 8601 duration "PT1H30M" -> "1 HR 30 MIN"
export function formatIsoDuration(iso) {
  const m = /PT(\d+H)?(\d+M)?/.exec(iso || '');
  if (!m) return '';
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h + ' HR ' + min + ' MIN';
}

// Minutes -> "1 Hour 30 Minute" (EPG card wording of the current app)
export function formatDurationWords(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h + ' Hour' + (m > 0 ? ' ' + m + ' Minute' : '');
  }
  return mins + ' Minute';
}

// "2 hours ago" from "2026-10-01 10:00:00"
export function timeAgo(dateString) {
  if (!dateString) return 'N/A';
  const past = new Date(String(dateString).replace(' ', 'T'));
  if (isNaN(past.getTime())) return 'N/A';
  const diff = Math.max(0, Math.floor((Date.now() - past.getTime()) / 1000));
  const days = Math.floor(diff / 86400);
  const hours = Math.floor(diff / 3600) % 24;
  const minutes = Math.floor(diff / 60) % 60;
  const seconds = diff % 60;
  if (days > 0) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  if (hours > 0) return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
  if (minutes > 0) return minutes + ' minute' + (minutes > 1 ? 's' : '') + ' ago';
  return seconds + ' second' + (seconds !== 1 ? 's' : '') + ' ago';
}

export function isValidEmail(email) {
  return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
}

// API sends missing values as null or the literal string "null"/"undefined".
export function isPresent(val) {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  return str !== '' && str !== 'null' && str !== 'undefined';
}

export function firstPresent(values) {
  for (let i = 0; i < values.length; i++) {
    if (isPresent(values[i])) return values[i];
  }
  return '';
}

// Plain-text policy from the API: first line is the title, blank lines
// separate paragraphs.
export function parsePolicyText(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  const title = (lines.shift() || '').trim();
  const paragraphs = lines.join('\n').split(/\n\s*\n/)
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p.length > 0; });
  return { title: title, paragraphs: paragraphs };
}

// Support API message: first two non-empty lines
export function splitLines(text) {
  return String(text || '').split('\n')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}
