# StreamlyTV – Tizen (React)

A React rebuild of the `StreamlyTV/` Samsung Tizen app. It covers the same screens, uses the same APIs and the same `localStorage` keys, and follows the same remote-control rules. It builds to a signed `.wgt`.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (Esc = remote BACK)
npm run package      # build + sign -> release/StreamlyTV-React-<version>.wgt
```

Install on a TV in Developer Mode:

```bash
~/tizen-studio/tools/sdb connect <TV-IP>
~/tizen-studio/tools/ide/bin/tizen install -n release/StreamlyTV-React-3.0.0.wgt -t <device-name>
```

## How it differs from `StreamlyTV/`

- **One page instead of one HTML file per screen.** Screens are React components, so moving between them is instant, with no page reload.
- **Faster EPG.** The grid only draws the rows and programmes that are on screen, and scrolls with GPU transforms. A few hundred channels stay smooth.
- **Runs on old TVs.** `@vitejs/plugin-legacy` compiles everything to ES5 with polyfills for Tizen 3.0 (Chromium 47). The CSS avoids features that engine lacks: CSS variables, flex `gap` and `position: sticky`.
- **Remote keys in one place.** A single key router gives each layer exclusive control of the remote: screen, then modal, then player, then loading overlay, then popup.
- **Smaller package.** 1.2 MB against 3.9 MB. Icons come from `react-icons` instead of Font Awesome fonts, and Bootstrap and unused images are gone.

## Layout

```
public/            config.xml, icon, images, js/dash.min.js (copied as-is into the .wgt)
src/config/api.js  all endpoints (VITE_API_BASE overrides the host for testing)
src/core/          key router, popup, loading overlay, navigation, session (401/410), internet monitor
src/lib/           http (XHR), storage keys, Tizen wrappers, crash logger, analytics, formatting
src/services/      login flows (email / passcode / QR), shared guide/settings content
src/components/    TvInput (OK opens the TV keyboard), OtpDialog, Header
src/screens/       Splash, Guide, Login, DeviceLimit, PersonalDevice, HotelRoom, Subscription,
                   epg/ (grid, programme modal, player + AVPlay/dash.js engine), settings/
scripts/           mock API, smoke + flow tests, .wgt packaging
```

| Old file | New file |
|---|---|
| `js/PopupManager.js`, `LoadingManager.js` | `src/core/popup.jsx`, `loading.jsx` |
| `js/auth-session.js` | `src/core/session.js` |
| `js/crash-logger.js` | `src/lib/crashLogger.js` |
| `login/login.js` | `src/screens/Login.jsx`, `src/services/auth.js` |
| `programmeguide/modern-epg-*.js` | `src/screens/epg/*` |
| `programmeguide/modern-epg-player.js` | `src/screens/epg/playerEngine.js` + `Player.jsx` |
| `settings/settings.js` | `src/screens/settings/*` |

## Testing without a TV

The tests run the built app from `file://` in headless Chrome, which is how a `.wgt` loads on the TV. They drive it with remote keys only, against a local mock of the backend.

```bash
npm run build:test                 # build pointing at the mock API
node scripts/mock-api.mjs &        # mock backend on :4010
node scripts/smoke-test.mjs        # guide, login, EPG, player, settings (34 checks)
node scripts/flows-test.mjs        # device naming, hotel rooms, device limit, subscription, HOA sub user (20 checks)
```

Screenshots are written to `test-shots/`. Mock logins:
- **Email:** `test@streamly.tv` / `password123`.
- **Passcodes:**
  - `1234abcd`: normal user
  - `pdname01`: device naming
  - `hotel001`: hotel tier user
  - `4790limit`: device limit
  - `expired1`: custom user with an expired subscription
  - `hoasub01`: HOA sub user

## Release notes

- **App ID:** `public/config.xml` uses a test ID (`StrReact01.StreamlyReact`), so this app installs next to the current one. To ship it as the store update, change it to `Z3APSRzuXq.StreamlyTV` and set `version` above the version currently in Seller Office.
- **Signing profile:** set `TIZEN_PROFILE` to package with a different certificate profile.
- **Endpoints:** the EPG uses `/v2/auth/epg-guide-test` (offset `start`/`limit`). Crash reports go to staging. Both are set in `src/config/api.js`.
