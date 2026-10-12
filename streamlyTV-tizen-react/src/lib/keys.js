// Samsung remote key codes (plus desktop equivalents for dev/testing).
export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 10009,
  EXIT: 10182,
  CH_UP: 427,
  CH_DOWN: 428,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 10252,
  STOP: 413,
  BACKSPACE: 8,
  IME_DONE: 65376,
  IME_CANCEL: 65385,
};

export function isDigitKey(code) {
  return (code >= 48 && code <= 57) || (code >= 96 && code <= 105);
}

export function digitFromKey(code) {
  return String(code >= 96 ? code - 96 : code - 48);
}

export function isArrow(code) {
  return code >= 37 && code <= 40;
}
