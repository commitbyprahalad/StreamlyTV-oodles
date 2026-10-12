/**
 * End-to-end smoke test: drives the built app with remote keys only, in
 * headless Chrome, against scripts/mock-api.mjs. The app is opened from
 * file:// exactly like a packaged .wgt on the TV.
 *
 *   npm run build:test && node scripts/mock-api.mjs &
 *   node scripts/smoke-test.mjs [distDir] [screenshotDir]
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const DIST = path.resolve(process.argv[2] || 'dist-test');
const SHOTS = path.resolve(process.argv[3] || 'test-shots');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const errors = [];
let page;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function text() {
  return page.evaluate(() => document.body.innerText);
}

async function press(key, times = 1, wait = 140) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await sleep(wait);
  }
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function check(name, fn) {
  try {
    const ok = await fn();
    results.push([ok ? 'PASS' : 'FAIL', name]);
  } catch (e) {
    results.push(['FAIL', name + ' — ' + e.message]);
  }
}

async function waitText(str, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await text()).indexOf(str) !== -1) return true;
    await sleep(100);
  }
  return false;
}

async function focusedText() {
  return page.evaluate(() => {
    const el = document.querySelector('.focused');
    return el ? el.innerText || el.value || el.className : '';
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  defaultViewport: { width: 1920, height: 1080 },
});
page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/webapis|ERR_FILE_NOT_FOUND|example\.invalid|Failed to load resource/.test(m.text())) {
    errors.push('console: ' + m.text());
  }
});
// Known zipcode so the test never calls the real IP-geolocation service
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('streamly_zipcode', '18344'); } catch (e) { /* ignore */ }
});

await page.goto('file://' + path.join(DIST, 'index.html'));

// ── Splash -> Guide ──────────────────────────────────────────────────────
await sleep(400);
await shot('01-splash');
await check('splash shows logo', async () => !!(await page.$('.splash-logo')));
await check('guide loads slides from API', () => waitText('Watch Live TV', 5000));
await shot('02-guide');

await press('ArrowDown');
await check('DOWN focuses Get Started', async () => (await focusedText()).indexOf('Get Started') !== -1);
await press('ArrowUp');
await press('Enter');
await check('Privacy modal opens with policy text', () => waitText('Streamly Privacy Policy'));
await shot('03-guide-privacy');
await press('ArrowDown', 40, 40);
await check('Privacy OK appears after scrolling to the end', async () => (await focusedText()).indexOf('Ok') !== -1);
await press('Enter');
await press('ArrowRight');
await press('Enter');
await check('Help modal shows support info', () => waitText('support@streamlytv.com'));
await shot('04-guide-help');
await press('Escape');
await press('ArrowDown');
await press('Enter');

// ── Login ────────────────────────────────────────────────────────────────
await check('login screen', () => waitText('Enter the necessary information'));
await shot('05-login-email');

// Wrong password first: error popup
await press('Enter'); // edit email
await page.keyboard.type('test@streamly.tv');
await press('Enter');
await press('ArrowDown');
await press('Enter');
await page.keyboard.type('wrongpass');
await press('Enter');
await press('ArrowDown', 2);
await check('focus reaches LOG IN', async () => (await focusedText()).indexOf('LOG IN') !== -1);
await press('Enter');
await check('invalid login shows server message', () => waitText('Invalid credentials'));
await shot('06-login-error');
await press('Enter'); // close popup

// Passcode + QR tabs
await press('ArrowRight');
await press('Enter');
await check('passcode tab', () => waitText('Passcode'));
await shot('07-login-passcode');
await press('ArrowRight');
await check('RIGHT from passcode field goes to its eye toggle', async () =>
  page.evaluate(() => !!document.querySelector('.eye-btn.focused')));
await press('ArrowRight'); // -> "Login with Email"
await press('ArrowDown'); // -> "Login with QR"
await press('Enter');
await check('QR tab shows countdown', () => waitText('This code expires in'));
await sleep(600);
await shot('08-login-qr');
await press('ArrowRight');
await press('Enter'); // back to email

// Forgot password popup
await press('ArrowDown', 2);
await press('ArrowRight');
await check('RIGHT from Remember Me reaches Forgot Password', async () => (await focusedText()).indexOf('Forgot') !== -1);
await press('Enter');
await check('forgot password popup', () => waitText('Reset Password Link'));
await shot('09-forgot');
await press('Escape');

// Correct password
await press('ArrowUp');
await press('Enter');
await page.keyboard.down('Control');
await page.keyboard.press('A');
await page.keyboard.up('Control');
await page.keyboard.type('password123');
await press('Enter');
await press('ArrowDown', 2);
const loginStart = Date.now();
await press('Enter');

// ── EPG ──────────────────────────────────────────────────────────────────
await check('login -> EPG loads channels', () => waitText('CH1', 8000));
const loginMs = Date.now() - loginStart;
await sleep(1500); // background pages
await shot('10-epg');
await check('EPG paged in all 60 channels in background', async () => page.evaluate(() =>
  document.querySelector('.channel-track') && parseInt(document.querySelector('.channel-track').style.height, 10) === 60 * 120));
await check('virtualised: only a few rows in the DOM', async () => {
  const n = await page.evaluate(() => document.querySelectorAll('.program-row').length);
  return n > 0 && n < 20;
});
await check('live line visible', async () => !!(await page.$('.live-line')));

await press('ArrowRight');
await check('RIGHT enters programmes (LIVE badge on first card)', async () =>
  (await page.evaluate(() => document.querySelector('.live-btn').innerText)) === 'LIVE');
// Navigation speed: 20 DOWN presses, measure time to settle
const navStart = Date.now();
await press('ArrowDown', 20, 100);
const navMs = Date.now() - navStart;
await sleep(300);
await shot('11-epg-scrolled');
await check('DOWN x20 moved focus to row 21', async () => page.evaluate(() => {
  const f = document.querySelector('.program-card.focused');
  return !!f && parseInt(f.parentNode.style.top, 10) === 20 * 120;
}));
await press('ArrowRight', 2);
await press('Enter');
await check('OK on upcoming programme opens details', () => waitText('Schedule', 5000));
await shot('12-program-details');
await press('Escape');
await check('BACK closes details', async () => !(await page.$('.program-modal')));

// Player (no real stream in the test: dash.js path, ends on error / spinner)
await press('ArrowLeft', 3);
await press('Enter');
await sleep(800);
await check('OK on channel opens the player', async () => !!(await page.$('.player')));
await press('ArrowUp');
await check('UP shows now-playing info', async () => !!(await page.$('.npo')));
await shot('13-player-info');
await press('ArrowRight');
await check('RIGHT shows channel strip', async () => !!(await page.$('.pch-list')));
await shot('14-player-strip');
await press('Escape');
await press('Escape');
await check('BACK closes the player', async () => !(await page.$('.player')));

// Header -> Settings
await press('Escape'); // grid -> GO LIVE
await press('ArrowRight');
await press('Enter');

// ── Settings ─────────────────────────────────────────────────────────────
await check('settings account page', () => waitText('Monthly $79.98/1 month', 5000));
await shot('15-settings-account');
await check('normal user sees Delete Account + Cancel Subscription', async () => {
  const t = await text();
  return t.indexOf('Delete Account') !== -1 && t.indexOf('Cancel Subscription') !== -1;
});
await press('ArrowDown');
await press('Enter');
await check('Devices page lists devices', () => waitText('Bedroom TV', 5000));
await shot('16-settings-devices');
await press('ArrowLeft');
await press('ArrowDown', 4);
await press('Enter');
await check('FAQ page', () => waitText('How do I change channel?', 5000));
await press('Enter');
await check('FAQ expands', () => waitText('channel strip'));
await shot('17-settings-faq');
await press('ArrowLeft');
await press('ArrowUp', 5);
await press('Enter'); // open Account (focus moves into it)
await press('Enter'); // OK on Account Details
await check('Delete Account asks for confirmation', () => waitText('Are you sure you want to delete your account?'));
await press('Escape');
await press('ArrowDown');
await press('Enter');
await check('Cancel Subscription opens password prompt', () => waitText('Confirm Your Password'));
await shot('18-settings-cancel-sub');
await press('Escape');

// Crash reports were uploaded on login?
const mock = await (await fetch('http://127.0.0.1:4010/api/__calls')).json();
await check('EPG paging used start/limit offsets', async () =>
  mock.calls.filter((c) => c === 'POST /v2/auth/epg-guide-test').length >= 3);

await browser.close();

for (const r of results) console.log(r[0] + '  ' + r[1]);
console.log('\nlogin -> EPG rendered: ' + loginMs + 'ms (incl. waits)');
console.log('20 x DOWN in the EPG: ' + navMs + 'ms (100ms between presses)');
if (errors.length) {
  console.log('\nJS errors:');
  errors.forEach((e) => console.log('  ' + e));
}
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed || errors.length ? 1 : 0);
