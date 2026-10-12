/**
 * Remote-key routing. One document keydown listener; components register
 * "layers" with a priority, and only the top layer receives each key — so
 * an open popup / overlay owns the remote exactly like the current app's
 * "if (PopupManager.isOpen()) ..." checks, without every screen repeating it.
 *
 * Priorities: screen 0, screen overlays 20-60, loading 900, popup 1000.
 *
 * A handler returns 'native' to let the browser keep the key's default
 * action (moving the caret in a text field). Otherwise arrow / OK / Back
 * defaults are prevented so the page never scrolls on its own.
 */
import { useEffect, useRef } from 'react';
import { KEY } from '../lib/keys';
import { isTizen } from '../lib/tizen';

const layers = [];
let seq = 0;
let installed = false;
const activityListeners = [];

export const PRIORITY = {
  SCREEN: 0,
  OVERLAY: 20,
  MODAL: 40,
  PLAYER: 60,
  LOADING: 900,
  POPUP: 1000,
};

const NAV_KEYS = [KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN, KEY.ENTER, KEY.BACK, KEY.EXIT];

// Desktop browser (dev + automated tests): Escape acts as the remote's Back.
function normalize(e) {
  const code = e.keyCode || e.which || 0;
  if (!isTizen() && code === 27) return KEY.BACK;
  return code;
}

function topLayer() {
  let best = null;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!best || l.priority > best.priority || (l.priority === best.priority && l.seq > best.seq)) best = l;
  }
  return best;
}

function onKeyDown(e) {
  const code = normalize(e);
  for (let i = 0; i < activityListeners.length; i++) activityListeners[i](code);
  const layer = topLayer();
  let result;
  if (layer) result = layer.ref.current(code, e);
  if (result !== 'native' && NAV_KEYS.indexOf(code) !== -1 && e.preventDefault) e.preventDefault();
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKeyDown);
}

/**
 * useKeys(handler, { priority, enabled })
 * handler(keyCode, event) is always the latest render's function.
 */
export function useKeys(handler, options) {
  const priority = (options && options.priority) || 0;
  const enabled = !options || options.enabled === undefined ? true : !!options.enabled;
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(function () {
    if (!enabled) return undefined;
    install();
    const layer = { priority: priority, seq: ++seq, ref: ref };
    layers.push(layer);
    return function () {
      const idx = layers.indexOf(layer);
      if (idx !== -1) layers.splice(idx, 1);
    };
  }, [priority, enabled]);
}

// Any key press (used by the player's inactivity check).
export function onAnyKey(fn) {
  install();
  activityListeners.push(fn);
  return function () {
    const idx = activityListeners.indexOf(fn);
    if (idx !== -1) activityListeners.splice(idx, 1);
  };
}
