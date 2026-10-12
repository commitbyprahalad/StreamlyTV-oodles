/**
 * Local mock of the StreamlyTV backend for testing the UI without touching
 * production. Same paths and response shapes the app expects.
 *
 *   node scripts/mock-api.mjs            (port 4010)
 *
 * Test logins: email test@streamly.tv / password123
 *              passcode 1234abcd (normal), 4790limit (device limit)
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4010);
const CHANNEL_COUNT = 60;
const crashReports = [];
const calls = [];

function now() {
  return Math.floor(Date.now() / 1000);
}

function slotStart() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30);
  return Math.floor(d.getTime() / 1000);
}

const TITLES = ['Morning News', 'Cooking Live', 'Wildlife World', 'Sports Center', 'Movie Night', 'Tech Today',
  'Kids Club', 'Late Show', 'Travel Diaries', 'Comedy Hour', 'Documentary', 'Weather Watch'];

function channel(i) {
  const base = slotStart() - 3600;
  const programs = [];
  let t = base;
  let k = 0;
  while (t < base + 30 * 3600) {
    const len = [30, 60, 90, 45, 120][(i + k) % 5] * 60;
    programs.push({
      title: TITLES[(i * 3 + k) % TITLES.length] + (k % 3 === 0 ? ' Special' : ''),
      start: t,
      end: t + len,
      TMSId: ['EP', 'MV', 'SH'][(i + k) % 3] + String(100000000000 + i * 1000 + k),
      image: '',
      description: 'Episode ' + (k + 1) + ' of a great programme on channel ' + (i + 1) + '.',
    });
    t += len;
    k++;
  }
  return {
    id: 100 + i,
    callSign: 'CH' + (i + 1),
    stationName: 'Station ' + (i + 1),
    image: '',
    url: 'https://example.invalid/stream/' + (i + 1) + '/manifest.mpd',
    quals: 'HD 1080i',
    // Every 9th channel has no programme data
    program: i % 9 === 8 ? [] : programs,
  };
}

const ALL_CHANNELS = Array.from({ length: CHANNEL_COUNT }, (_, i) => channel(i));

const USER = {
  success: true,
  response_code: 200,
  message: 'logged in successfully',
  access_token: 'mock-jwt-token',
  personaldeviceid: 'pd123',
  device_type: 'non-web',
  personaldevicename_popup: false,
  userrole: 'user',
  is_hoa_main_user: false,
  is_hoa_sub_user: false,
  rooms: [],
  user: { id: 42, name: 'Test User', email: 'test@streamly.tv', zipcode: '18344', is_custom_user: 0, user_type: '' },
};

const QR_SVG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/>' +
  Array.from({ length: 140 }, (_, n) => {
    const x = (n * 7) % 29;
    const y = Math.floor((n * 7) / 29) % 29;
    return '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
  }).join('') +
  '<rect x="1" y="1" width="7" height="7" fill="none" stroke="#000"/><rect x="21" y="1" width="7" height="7" fill="none" stroke="#000"/>' +
  '<rect x="1" y="21" width="7" height="7" fill="none" stroke="#000"/></svg>').toString('base64');

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
  });
}

function field(raw, name) {
  // multipart/form-data or JSON — good enough for a mock
  const m = new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)').exec(raw);
  if (m) return m[1];
  try {
    const j = JSON.parse(raw);
    return j[name];
  } catch (e) {
    return undefined;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, customdata');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/^\/api/, '');
  const raw = await readBody(req);
  calls.push(req.method + ' ' + p);

  switch (p) {
    case '/__calls':
      return send(res, 200, { calls, crashReports });
    case '/loginguide':
      return send(res, 200, {
        success: true,
        data: [
          { title: 'Watch Live TV', description: 'Hundreds of channels streaming live on your Samsung TV.' },
          { title: 'Programme Guide', description: 'See what is on now and next across all channels.' },
          { title: 'One Account', description: 'Use your Streamly account on every screen in your home.' },
        ],
      });
    case '/auth/privacypol':
      return send(res, 200, { success: true, response_code: 200, data: 'Streamly Privacy Policy\n\n' + Array.from({ length: 14 }, (_, i) => 'Section ' + (i + 1) + '. We respect your privacy and only use your data to provide the service. This paragraph is placeholder text for testing scrolling on the TV screen.').join('\n\n') });
    case '/auth/termofuse':
      return send(res, 200, { success: true, response_code: 200, data: 'Streamly Terms of Use\n\n' + Array.from({ length: 10 }, (_, i) => 'Term ' + (i + 1) + '. Placeholder terms text for testing.').join('\n\n') });
    case '/auth/support':
      return send(res, 200, { success: true, message: 'Our team is available 24/7.\nReach us any time.', data: { email: 'support@streamlytv.com', num1: '1-888-309-0838' } });
    case '/auth/login': {
      const email = field(raw, 'email');
      const password = field(raw, 'password');
      if (email === 'test@streamly.tv' && password === 'password123') return send(res, 200, USER);
      return send(res, 200, { success: false, message: 'Invalid credentials' });
    }
    case '/auth/login-with-passcode': {
      const passcode = field(raw, 'passcode');
      if (passcode === '1234abcd') return send(res, 200, USER);
      if (passcode === 'pdname01') return send(res, 200, Object.assign({}, USER, { personaldevicename_popup: true }));
      if (passcode === 'hotel001') {
        return send(res, 200, Object.assign({}, USER, { userrole: 'tieruser', rooms: [], user: Object.assign({}, USER.user, { is_custom_user: 0 }) }));
      }
      if (passcode === 'expired1') {
        return send(res, 410, Object.assign({}, USER, { success: false, response_code: 410, user: Object.assign({}, USER.user, { is_custom_user: 1, user_type: 'custom' }) }));
      }
      if (passcode === 'hoasub01') {
        return send(res, 200, Object.assign({}, USER, { userrole: 'hoa', is_hoa_sub_user: true, user: Object.assign({}, USER.user, { is_custom_user: 1, user_type: 'custom' }) }));
      }
      if (passcode === '4790limit') {
        return send(res, 200, {
          success: false, response_code: 479,
          loggedindeviceinfolist: { data: [
            { session_id: 's1', device_name: 'Living Room TV', user_ip: '10.0.0.4', device_type: 'non-web', logintime: '2026-10-01 10:00:00', personaldevicename: 'Living' },
            { session_id: 's2', device_name: 'iPhone', user_ip: '10.0.0.9', device_type: 'web', logintime: '2026-10-07 08:00:00', personaldevicename: '' },
          ] },
        });
      }
      return send(res, 200, { success: false, message: 'Invalid passcode' });
    }
    case '/login/create/qrcode':
      return send(res, 200, { status: 1, key: 'qr-key-1', msg: QR_SVG });
    case '/login/scan/qrcode':
      return send(res, 200, { status: 0 });
    case '/password/email':
      return send(res, 200, { success: true, message: 'Reset password link sent to your email.' });
    case '/v2/auth/epg-guide-test': {
      const start = Number(field(raw, 'start') || 0);
      const limit = Number(field(raw, 'limit') || 20);
      const page = ALL_CHANNELS.slice(start, start + limit);
      return send(res, 200, { success: true, response_code: 200, data: page, has_more: start + limit < ALL_CHANNELS.length });
    }
    case '/auth/program-details': {
      const ch = ALL_CHANNELS.find((c) => String(c.id) === String(field(raw, 'channel_id'))) || ALL_CHANNELS[0];
      const tms = field(raw, 'TMSId');
      const prog = ch.program.find((x) => x.TMSId === tms) || ch.program[0];
      return send(res, 200, {
        success: true, response_code: 200,
        data: {
          stationName: ch.stationName, title: prog.title, image: '', duration: 'PT1H30M', quals: 'HD 1080i',
          genre: ['Drama'], description: prog.description + ' A longer synopsis for the details popup.',
          schedule: ch.program.filter((x) => x.end > now()).slice(0, 8).map((x) => ({ start: x.start, end: x.end })),
        },
      });
    }
    case '/auth/getdrmkey':
      return send(res, 200, { success: true, data: 'mock-custom-data', widevinelicense: 'https://example.invalid/license' });
    case '/auth/sub-session/store':
    case '/auth/addtorecent':
      return send(res, 200, { success: true, response_code: 200 });
    case '/auth/setting-details':
      return send(res, 200, {
        success: true,
        data: {
          userinfo: { id: 42, name: 'Test User', email: 'test@streamly.tv', passcode: '1234abcd' },
          timezone: 'Eastern Daylight Time', zipcode: '18344',
          subscription: { name: 'Monthly $79.98/1 month', renewaldatetime: '2026-11-07 10:00:00', canceled: false },
          card_details: { card_brand: 'visa', card_last_four: '4242' },
        },
      });
    case '/auth/newconnecteddevice':
      return send(res, 200, {
        success: true, numofdevice: 3, userDeviceLimit: 5,
        data: [
          { session_id: 'a', device_id: 'other-1', device_name: 'iPhone', user_ip: '10.0.0.9', device_type: 'web', logintime: '2026-10-07 08:00:00' },
          { session_id: 'b', device_id: 'other-2', device_name: 'Bedroom TV', user_ip: '10.0.0.5', device_type: 'non-web', logintime: '2026-10-06 21:00:00', personaldevicename: 'Bedroom' },
          { session_id: 'c', device_id: 'other-3', device_name: 'Laptop', user_ip: '10.0.0.7', device_type: 'web', logintime: '2026-10-05 12:00:00' },
        ],
      });
    case '/auth/faq':
      return send(res, 200, { success: true, data: [
        { question_key: 'How do I change channel?', question_answer: 'Press LEFT or RIGHT while watching to open the channel strip.' },
        { question_key: 'How many devices can I use?', question_answer: 'Your plan sets the device limit shown in Settings > Devices.' },
        { question_key: 'How do I log out?', question_answer: 'Open Settings and choose Sign Out.' },
      ] });
    case '/auth/personaldevicename/pd123':
      return send(res, 200, { success: true, data: { devicename: field(raw, 'devicename') } });
    case '/auth/get-hotelrooms':
      return send(res, 200, { success: true, data: Array.from({ length: 13 }, (_, i) => ({ id: i + 1, hotel_room: 'Room ' + (13 - i) })) });
    case '/auth/sync-session-with-room':
      return send(res, 200, { success: true });
    case '/auth/same-device-id-logout':
      return send(res, 200, { success: true });
    case '/auth/subscription/check':
      return send(res, 410, {
        success: false, response_code: 410, custom_subscription_expired: true,
        custom_subscription_expired_at: '2026-09-25 05:54:05', device_limit: 4, plan_request: null,
      });
    case '/auth/custom/subscription/plan':
      return send(res, 200, { success: true, data: [
        { id: 3, interval: 'month', interval_count: 6, status: 1, nickname: '6 Month Plan' },
        { id: 1, interval: 'month', interval_count: 1, status: 1, nickname: 'Monthly Plan' },
        { id: 2, interval: 'month', interval_count: 3, status: 1 },
      ] });
    case '/auth/subscription/plan-request':
      return send(res, 200, { success: true, message: 'Request sent' });
    case '/auth/logout':
      return send(res, 200, { success: true });
    case '/crash-report/store': {
      try {
        const body = JSON.parse(raw);
        crashReports.push(...(body.crash_reports || []));
      } catch (e) { /* ignore */ }
      return send(res, 201, { success: true });
    }
    default:
      return send(res, 404, { success: false, message: 'Not mocked: ' + p });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Mock StreamlyTV API on http://127.0.0.1:' + PORT + '/api');
});
