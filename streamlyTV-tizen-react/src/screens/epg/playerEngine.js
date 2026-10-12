/**
 * Playback engine (port of the current modern-epg-player.js):
 *
 * - Samsung AVPlay (webapis.avplay) is the primary engine: native hardware
 *   pipeline, faster start and smoother channel changes than MSE/dash.js.
 *   Widevine licences are fetched by us from the AVPlay challenge, with the
 *   same `customdata` header dash.js sends.
 * - dash.js on <video> is the fallback. If AVPlay can't start a stream
 *   (open/prepare/DRM error or no start within 12s) the same stream is
 *   retried with dash.js, and AVPlay is skipped for the rest of the app
 *   session. dash.js (~700KB) is only downloaded when that happens.
 *
 * AVPlay draws on the TV's video plane under the page, so while it plays
 * the page must be transparent: the `avplay-mode` class on <html> does that
 * (see styles/epg.css).
 *
 * createPlayerEngine({ video, onSpinner(bool), onError(), onStarted() })
 *   .load(url, drmData, license) / .retry() / .togglePlayPause() -> 'play'|'pause'|null
 *   .destroy() / .suspend() / .restore()
 */
import { crashLogger } from '../../lib/crashLogger';
import { get, K } from '../../lib/storage';

const AVPLAY_ENABLED = true;
const AVPLAY_START_TIMEOUT = 12000;
const AVPLAY_UNAVAILABLE_KEY = 'avplay_unavailable'; // sessionStorage
const BUFFER_TIMEOUT = 30000;

function avplay() {
  return window.webapis && window.webapis.avplay;
}

function setAVPlayMode(on) {
  const root = document.documentElement;
  if (on) root.className = (root.className.replace(/\s?avplay-mode/g, '') + ' avplay-mode').trim();
  else root.className = root.className.replace(/\s?avplay-mode/g, '');
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

let dashScriptRequested = false;
function ensureDashScript() {
  if (typeof window.dashjs !== 'undefined' || dashScriptRequested) return;
  dashScriptRequested = true;
  const script = document.createElement('script');
  script.src = 'js/dash.min.js';
  script.async = true;
  document.body.appendChild(script);
}

export function createPlayerEngine(cb) {
  const state = {
    engine: null, // 'avplay' | 'dash'
    token: 0, // bumped per stream so late callbacks of an old stream are ignored
    dash: null,
    bufferTimer: null,
    dashWaitTimer: null,
    dashWaitCount: 0,
    drm: null,
    url: null,
    drmData: null,
    license: null,
  };
  const video = cb.video;

  function report(exception, message, err) {
    crashLogger.log({
      exception: exception,
      message: '[' + (state.engine || 'no engine') + '] ' + message +
        (err ? ' – ' + (err.message || err.name || String(err)) : ''),
      stack_trace: err && err.stack,
      screen: 'Player Screen',
      api_url: state.url,
    });
  }

  function showError() {
    clearTimeout(state.bufferTimer);
    cb.onSpinner(false);
    cb.onError();
  }

  function canUseAVPlay() {
    if (!AVPLAY_ENABLED || !document.getElementById('av-player') || !avplay()) return false;
    try {
      if (window.sessionStorage.getItem(AVPLAY_UNAVAILABLE_KEY) === '1') return false;
    } catch (e) {
      /* storage unavailable: just try AVPlay */
    }
    return true;
  }

  function stopAVPlay() {
    if (state.engine !== 'avplay') return;
    try {
      const s = avplay().getState();
      if (s !== 'NONE' && s !== 'IDLE') avplay().stop();
      avplay().close();
    } catch (e) {
      /* already closed */
    }
  }

  function destroy() {
    state.token++;
    stopAVPlay();
    setAVPlayMode(false);
    state.engine = null;
    clearTimeout(state.bufferTimer);
    clearTimeout(state.dashWaitTimer);
    if (state.dash) {
      try {
        state.dash.pause();
        state.dash.reset();
      } catch (e) {
        /* ignore */
      }
      state.dash = null;
    }
    if (video) {
      try {
        video.removeAttribute('src');
        video.load();
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ── AVPlay ───────────────────────────────────────────────────────────
  function onAVPlayDrmEvent(drmInfo, token, fail) {
    if (!drmInfo || token !== state.token) return;
    if (drmInfo.name === 'DrmError') {
      fail('DRM error ' + (drmInfo.code || drmInfo.message || ''));
      return;
    }
    if (drmInfo.name !== 'Challenge' || !state.drm) return;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', state.drm.licenseUrl, true);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('customdata', state.drm.customData);
    xhr.timeout = 10000;
    xhr.onload = function () {
      if (token !== state.token) return;
      if (xhr.status !== 200 || !xhr.response) {
        fail('licence HTTP ' + xhr.status);
        return;
      }
      try {
        avplay().setDrm('WIDEVINE_CDM', 'widevine_license_data', arrayBufferToBase64(xhr.response));
      } catch (e) {
        fail('licence apply: ' + (e && (e.name || e.message)));
      }
    };
    xhr.onerror = function () { fail('licence network error'); };
    xhr.ontimeout = function () { fail('licence timeout'); };
    try {
      xhr.send(base64ToBytes(drmInfo.challenge));
    } catch (e) {
      fail('licence request: ' + (e && e.message));
    }
  }

  function loadAVPlay() {
    const av = avplay();
    const token = state.token;
    let started = false;
    let fellBack = false;

    state.engine = 'avplay';
    setAVPlayMode(true);

    function stale() {
      return token !== state.token;
    }

    // Before the first frame any failure falls back to dash.js; once the
    // stream is playing, failures are stream problems -> Retry screen.
    function fallBackToDash(reason) {
      if (stale() || fellBack) return;
      fellBack = true;
      report('AVPlayStartFailed', 'AVPlay could not start (' + reason + '), falling back to dash.js');
      try {
        window.sessionStorage.setItem(AVPLAY_UNAVAILABLE_KEY, '1');
      } catch (e) {
        /* not persisted */
      }
      clearTimeout(state.bufferTimer);
      stopAVPlay();
      setAVPlayMode(false);
      state.engine = null;
      loadDash();
    }

    function fail(reason) {
      if (stale()) return;
      if (started) {
        report('AVPlayPlaybackError', 'AVPlay error while playing: ' + reason);
        showError();
      } else {
        fallBackToDash(reason);
      }
    }

    try {
      av.open(state.url);
      av.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
      av.setListener({
        onbufferingstart: function () {
          if (stale() || !started) return;
          cb.onSpinner(true);
          clearTimeout(state.bufferTimer);
          state.bufferTimer = setTimeout(function () {
            if (stale()) return;
            report('BufferingTimeout', 'Stalled buffering for 30s while playing');
            showError();
          }, BUFFER_TIMEOUT);
        },
        onbufferingcomplete: function () {
          if (stale() || !started) return;
          clearTimeout(state.bufferTimer);
          cb.onSpinner(false);
        },
        onstreamcompleted: function () {
          fail('stream completed');
        },
        onerror: function (eventType) {
          fail('onerror ' + eventType);
        },
        ondrmevent: function (drmEvent, drmInfo) {
          onAVPlayDrmEvent(drmInfo, token, fail);
        },
        onevent: function () {},
      });
      if (state.drmData && state.license) {
        state.drm = { licenseUrl: state.license, customData: state.drmData };
        av.setDrm('WIDEVINE_CDM', 'SetProperties', JSON.stringify({
          AppSession: 'streamly-' + Date.now(),
          DataType: 'MPEG-DASH',
        }));
      } else {
        state.drm = null;
      }
    } catch (e) {
      fail('open: ' + (e && (e.name || e.message)));
      return;
    }

    clearTimeout(state.bufferTimer);
    state.bufferTimer = setTimeout(function () {
      fail('no start within ' + AVPLAY_START_TIMEOUT + 'ms');
    }, AVPLAY_START_TIMEOUT);

    av.prepareAsync(function () {
      if (stale()) return;
      try {
        av.play();
      } catch (e) {
        fail('play: ' + (e && (e.name || e.message)));
        return;
      }
      started = true;
      clearTimeout(state.bufferTimer);
      cb.onSpinner(false);
      cb.onStarted();
    }, function (err) {
      fail('prepare: ' + (err && (err.name || err.message)));
    });
  }

  // ── dash.js ──────────────────────────────────────────────────────────
  function loadDash() {
    const token = state.token;
    state.engine = 'dash';
    ensureDashScript();

    if (!video) {
      report('DashLoadError', 'videoElement not found');
      showError();
      return;
    }
    const dashjs = window.dashjs;
    if (typeof dashjs === 'undefined' || !dashjs.MediaPlayer) {
      // dash.js loads async; wait for it (up to ~5s) instead of failing.
      state.dashWaitCount++;
      if (state.dashWaitCount <= 25) {
        clearTimeout(state.dashWaitTimer);
        state.dashWaitTimer = setTimeout(function () {
          if (token === state.token) loadDash();
        }, 200);
        return;
      }
      state.dashWaitCount = 0;
      report('DashLoadError', 'dash.js library not loaded after 5s');
      showError();
      return;
    }
    state.dashWaitCount = 0;

    let player;
    try {
      player = dashjs.MediaPlayer().create();
      state.dash = player;
    } catch (e) {
      report('DashLoadError', 'Could not create dash.js player', e);
      showError();
      return;
    }

    const ev = dashjs.MediaPlayer.events;
    function on(name, fn) {
      try {
        if (ev[name]) player.on(ev[name], fn);
      } catch (e) {
        /* event not supported by this dash.js build */
      }
    }
    on('BUFFER_EMPTY', function () {
      if (token !== state.token) return;
      cb.onSpinner(true);
      clearTimeout(state.bufferTimer);
      state.bufferTimer = setTimeout(function () {
        report('BufferingTimeout', 'dash.js buffer empty for 30s');
        showError();
      }, BUFFER_TIMEOUT);
    });
    on('BUFFER_LOADED', function () {
      if (token !== state.token) return;
      cb.onSpinner(false);
      clearTimeout(state.bufferTimer);
    });
    on('PLAYBACK_STARTED', function () {
      if (token !== state.token) return;
      try {
        video.muted = false;
        video.volume = 1;
        player.setMute(false);
        player.setVolume(1);
      } catch (e) {
        /* ignore */
      }
      cb.onSpinner(false);
      clearTimeout(state.bufferTimer);
      cb.onStarted();
    });
    on('PLAYBACK_ERROR', function (e) {
      if (token !== state.token) return;
      report('DashPlaybackError', 'PLAYBACK_ERROR ' + JSON.stringify((e && e.error) || e || {}));
      showError();
    });
    on('KEY_ERROR', function (e) {
      report('DRMKeyError', 'KEY_ERROR ' + JSON.stringify((e && e.error) || e || {}));
    });

    // DRM must be configured BEFORE initialize()
    if (state.drmData && state.license) {
      try {
        player.setProtectionData({
          'com.widevine.alpha': {
            serverURL: state.license,
            httpRequestHeaders: { customdata: state.drmData },
            robustnessLevel: 'SW_SECURE_CRYPTO',
          },
          'com.microsoft.playready': {
            serverURL: get(K.PLAYREADY) || state.license,
            httpRequestHeaders: { customdata: state.drmData },
          },
        });
      } catch (e) {
        report('DRMSetupError', 'dash.js setProtectionData failed', e);
      }
    }

    clearTimeout(state.bufferTimer);
    state.bufferTimer = setTimeout(function () {
      report('BufferingTimeout', 'dash.js stream did not start within 30s');
      showError();
    }, BUFFER_TIMEOUT);

    try {
      video.muted = true; // autoplay policy; unmuted on PLAYBACK_STARTED
      player.initialize(video, state.url, true);
      setTimeout(function () {
        if (token !== state.token) return;
        try {
          player.play();
        } catch (e) {
          /* autoplay already running */
        }
      }, 500);
    } catch (e) {
      report('DashLoadError', 'dashPlayer.initialize() threw', e);
      showError();
    }
  }

  function load(url, drmData, license) {
    destroy();
    state.url = url;
    state.drmData = drmData;
    state.license = license;
    cb.onSpinner(true);
    // Short yield so the overlay/spinner can paint first
    const token = state.token;
    setTimeout(function () {
      if (token !== state.token) return;
      if (canUseAVPlay()) loadAVPlay();
      else loadDash();
    }, 30);
  }

  return {
    load: load,
    retry: function () {
      if (state.url) load(state.url, state.drmData, state.license);
    },
    destroy: destroy,
    engine: function () {
      return state.engine;
    },
    togglePlayPause: function (forceAction) {
      if (state.engine === 'avplay') {
        try {
          const s = avplay().getState();
          if (s === 'PLAYING' && forceAction !== 'play') {
            avplay().pause();
            return 'play';
          }
          if (s === 'PAUSED' && forceAction !== 'pause') {
            avplay().play();
            return 'pause';
          }
        } catch (e) {
          /* ignore */
        }
        return null;
      }
      if (!state.dash || !video) return null;
      if (video.paused && forceAction !== 'pause') {
        state.dash.play();
        return 'pause';
      }
      if (!video.paused && forceAction !== 'play') {
        state.dash.pause();
        return 'play';
      }
      return null;
    },
    // App sent to background (Home, source switch): AVPlay must be suspended
    suspend: function () {
      if (state.engine !== 'avplay') return;
      try {
        avplay().suspend();
      } catch (e) {
        /* ignore */
      }
    },
    restore: function () {
      if (state.engine !== 'avplay') return;
      try {
        avplay().restore();
      } catch (e) {
        /* ignore */
      }
    },
  };
}
