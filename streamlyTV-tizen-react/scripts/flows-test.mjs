/**
 * Role / routing flows, each from a fresh install (empty storage), driven
 * with remote keys against scripts/mock-api.mjs. Logins use mock passcodes:
 *   pdname01  device must be named first      hotel001  hotel tier user
 *   4790limit device limit (479)               expired1  custom user, 410
 *   hoasub01  HOA sub user
 *
 *   node scripts/flows-test.mjs [distDir] [screenshotDir]
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const DIST = path.resolve(process.argv[2] || 'dist-test');
const SHOTS = path.resolve(process.argv[3] || 'test-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox'],
  defaultViewport: { width: 1920, height: 1080 },
});

async function freshPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('streamly_zipcode', '18344'); } catch (e) { /* ignore */ }
  });
  await page.goto('file://' + path.join(DIST, 'index.html'));
  return page;
}

function helpers(page) {
  const text = () => page.evaluate(() => document.body.innerText);
  return {
    text,
    press: async (key, times = 1, wait = 150) => {
      for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await sleep(wait);
      }
    },
    waitText: async (str, timeout = 6000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if ((await text()).includes(str)) return true;
        await sleep(100);
      }
      return false;
    },
    shot: (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') }),
  };
}

async function check(name, fn) {
  try {
    results.push([(await fn()) ? 'PASS' : 'FAIL', name]);
  } catch (e) {
    results.push(['FAIL', name + ' — ' + e.message]);
  }
}

// Guide -> Login -> passcode tab -> log in with `code`
async function loginWithPasscode(page, code) {
  const h = helpers(page);
  await h.waitText('Get Started', 6000);
  await h.press('ArrowDown');
  await h.press('Enter');
  await h.waitText('Log In');
  await h.press('ArrowRight'); // username -> "Login with Passcode"
  await h.press('Enter');
  await h.press('Enter'); // edit passcode
  await page.keyboard.type(code);
  await h.press('Enter');
  await h.press('ArrowDown');
  await h.press('Enter');
  return h;
}

// ── A: name the device, then EPG ────────────────────────────────────────
{
  const page = await freshPage();
  const h = await loginWithPasscode(page, 'pdname01');
  await check('A: new device goes to "name your device"', () => h.waitText('Choose a name for your streamly device'));
  await h.press('Enter'); // Next with empty name
  await check('A: empty name is rejected', () => h.waitText('Please enter a device name.'));
  await h.press('Enter');
  await h.press('ArrowUp');
  await h.press('Enter');
  await page.keyboard.type('Living Room');
  await h.press('Enter');
  await h.shot('20-personal-device');
  await h.press('ArrowDown');
  await h.press('Enter');
  await check('A: after naming -> EPG', () => h.waitText('CH1', 8000));
  await page.browserContext().close();
}

// ── B: hotel rooms ──────────────────────────────────────────────────────
{
  const page = await freshPage();
  const h = await loginWithPasscode(page, 'hotel001');
  await check('B: tier user goes to hotel rooms', () => h.waitText('select room', 8000));
  await check('B: rooms in natural order (Room 1, 2, … 10)', async () => page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.room-card-name')).map((e) => e.innerText);
    return names[0] === 'Room 1' && names[1] === 'Room 2' && names[9] === 'Room 10';
  }));
  await h.shot('21-hotel-rooms');
  await h.press('ArrowRight');
  await h.press('Enter');
  await check('B: OK asks to confirm the room', () => h.waitText('Are you sure you want to select Room 2?'));
  await h.press('ArrowRight');
  await h.press('Enter');
  await check('B: room selected -> EPG', () => h.waitText('CH1', 8000));
  await page.browserContext().close();
}

// ── C: device limit ─────────────────────────────────────────────────────
{
  const page = await freshPage();
  const h = await loginWithPasscode(page, '4790limit');
  await check('C: 479 shows device-limit popup', () => h.waitText('Your device limit is over'));
  await h.press('ArrowRight');
  await h.press('Enter');
  await check('C: device list screen', () => h.waitText('Total connected devices: 2'));
  await h.shot('22-device-limit');
  await h.press('ArrowRight');
  await h.press('Enter');
  await check('C: OK on a device asks to remove it', () => h.waitText('Are you sure you want to remove this device?'));
  await h.press('ArrowRight');
  await h.press('Enter');
  // mock still answers 479 for this passcode -> list again
  await check('C: remove -> relogin -> back on the device list', () => h.waitText('Total connected devices: 2', 8000));
  await page.browserContext().close();
}

// ── D: custom user, subscription expired ────────────────────────────────
{
  const page = await freshPage();
  const h = await loginWithPasscode(page, 'expired1');
  await check('D: 410 opens subscription screen (custom)', () => h.waitText('Previous Plan', 8000));
  await check('D: previous plan expiry formatted', () => h.waitText('Expired on September 25, 2026'));
  await check('D: plans sorted 1 / 3 / 6 months', async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.plan-card span')).map((e) => e.innerText).join(',') === '1 month,3 months,6 months'));
  await h.shot('23-subscription-custom');
  await h.press('Enter'); // first plan
  await check('D: selecting a plan asks to confirm', () => h.waitText('Are you sure you want to select Monthly Plan?'));
  await h.press('ArrowRight');
  await h.press('Enter');
  await h.press('Enter'); // Request Now (focus moved there)
  await check('D: request sent', () => h.waitText('sent to your service provider'));
  await h.press('Enter');
  await check('D: button becomes Under Review', () => h.waitText('Under Review'));
  await h.shot('24-subscription-under-review');
  await page.browserContext().close();
}

// ── E: HOA sub user in settings ─────────────────────────────────────────
{
  const page = await freshPage();
  const h = await loginWithPasscode(page, 'hoasub01');
  await h.waitText('CH1', 8000);
  await h.press('ArrowUp'); // row 0 -> GO LIVE
  await h.press('ArrowRight');
  await h.press('Enter');
  await check('E: settings opens', () => h.waitText('Account Details', 6000));
  await check('E: HOA sub user has no Delete Account', async () => !(await h.text()).includes('Delete Account'));
  await check('E: custom user has no Cancel Subscription / Card Details', async () => {
    const t = await h.text();
    return !t.includes('Cancel Subscription') && !t.includes('Card Details');
  });
  await h.shot('25-settings-hoa-sub');
  await page.browserContext().close();
}

await browser.close();
for (const r of results) console.log(r[0] + '  ' + r[1]);
if (errors.length) {
  console.log('\nJS errors:');
  errors.forEach((e) => console.log('  ' + e));
}
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed || errors.length ? 1 : 0);
