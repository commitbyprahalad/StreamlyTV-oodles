/**
 * 6-digit OTP entry popup with an on-screen number pad (used by Delete
 * Account and Resume Subscription). Same behaviour as the current app:
 *
 *   1 2 3 4 5 6
 *   7 8 9 0 ⌫ Clear
 *      [Verify]
 *      [Resend]   (after the 60s cooldown)
 *
 * The remote's number keys type digits directly. Once 6 digits are in,
 * focus jumps to Verify.
 *
 * props: title, subtext, error, sentAt (restart the 60s timer when it
 * changes), resetToken (clear digits + refocus pad when it changes),
 * focusVerifyToken, onVerify(code), onResend(), onClose()
 */
import React, { useEffect, useState } from 'react';
import { useKeys, PRIORITY } from '../core/keys';
import { KEY, isDigitKey, digitFromKey } from '../lib/keys';

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'back', 'clear'];
const COLS = 6;
const RESEND_SECONDS = 60;

function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 9l6 6M18 9l-6 6" />
    </svg>
  );
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

export default function OtpDialog(props) {
  const [digits, setDigits] = useState([]);
  const [focus, setFocus] = useState('key-0'); // key-N | verify | resend
  const [lastKey, setLastKey] = useState(0);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const onError = props.onClearError;

  // 60s resend cooldown, restarted whenever a code is (re)sent
  useEffect(function () {
    setSeconds(RESEND_SECONDS);
    const timer = setInterval(function () {
      setSeconds(function (s) {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return function () {
      clearInterval(timer);
    };
  }, [props.sentAt]);

  useEffect(function () {
    setDigits([]);
    setFocus('key-0');
    setLastKey(0);
  }, [props.resetToken]);

  useEffect(function () {
    if (props.focusVerifyToken) setFocus('verify');
  }, [props.focusVerifyToken]);

  const resendEnabled = seconds === 0;

  function goTo(target) {
    if (target === 'resend' && !resendEnabled) target = 'verify';
    if (target.indexOf('key-') === 0) setLastKey(parseInt(target.slice(4), 10) || 0);
    setFocus(target);
  }

  function append(d) {
    if (digits.length >= 6) return;
    const next = digits.concat([d]);
    setDigits(next);
    if (onError) onError();
    if (next.length === 6) goTo('verify');
  }

  function backspace() {
    if (!digits.length) return;
    setDigits(digits.slice(0, -1));
    if (onError) onError();
  }

  function press(key) {
    if (key === 'back') backspace();
    else if (key === 'clear') {
      setDigits([]);
      if (onError) onError();
    } else append(key);
  }

  useKeys(function (code) {
    if (isDigitKey(code)) {
      append(digitFromKey(code));
      return;
    }
    if (code === KEY.BACKSPACE) {
      backspace();
      return;
    }
    const onKey = focus.indexOf('key-') === 0;
    const idx = onKey ? lastKey : -1;
    const col = idx % COLS;
    switch (code) {
      case KEY.LEFT:
        if (onKey && col > 0) goTo('key-' + (idx - 1));
        break;
      case KEY.RIGHT:
        if (onKey && col < COLS - 1 && idx + 1 < PAD.length) goTo('key-' + (idx + 1));
        break;
      case KEY.UP:
        if (onKey) {
          if (idx - COLS >= 0) goTo('key-' + (idx - COLS));
        } else if (focus === 'resend') goTo('verify');
        else goTo('key-' + lastKey);
        break;
      case KEY.DOWN:
        if (onKey) {
          if (idx + COLS < PAD.length) goTo('key-' + (idx + COLS));
          else goTo('verify');
        } else if (focus === 'verify' && resendEnabled) goTo('resend');
        break;
      case KEY.ENTER:
        if (onKey) press(PAD[idx]);
        else if (focus === 'verify') props.onVerify(digits.join(''));
        else if (focus === 'resend' && resendEnabled) props.onResend();
        break;
      case KEY.BACK:
        props.onClose();
        break;
      default:
        break;
    }
  }, { priority: PRIORITY.MODAL });

  const cursor = Math.min(digits.length, 5);

  return (
    <div className="overlay-dim">
      <div className="dialog otp-dialog">
        <div className="dialog-title">{props.title || 'Verification Code'}</div>
        <div className="dialog-text">{props.subtext}</div>
        <div className="otp-boxes">
          {[0, 1, 2, 3, 4, 5].map(function (i) {
            return (
              <div key={i} className={'otp-box' + (digits[i] ? ' filled' : '') + (i === cursor ? ' cursor' : '')}>
                {digits[i] || ''}
              </div>
            );
          })}
        </div>
        <div className="otp-error">{props.error || ''}</div>
        <div className="otp-pad">
          {PAD.map(function (key, i) {
            const isAction = key === 'back' || key === 'clear';
            return (
              <button
                key={key}
                type="button"
                className={'otp-key' + (isAction ? ' otp-key-action' : '') + (focus === 'key-' + i ? ' focused' : '')}
                onClick={function () { goTo('key-' + i); press(key); }}
              >
                {key === 'back' ? <BackspaceIcon /> : key === 'clear' ? 'Clear' : key}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={'btn btn-primary otp-verify' + (focus === 'verify' ? ' focused' : '')}
          onClick={function () { props.onVerify(digits.join('')); }}
        >
          Verify
        </button>
        <div className="otp-resend-row">
          <span className="otp-resend-label">Didn't receive your OTP?</span>
          {resendEnabled ? (
            <button
              type="button"
              className={'otp-resend-btn' + (focus === 'resend' ? ' focused' : '')}
              onClick={props.onResend}
            >
              Resend Now
            </button>
          ) : (
            <span className="otp-timer">{'Resend code in 00:' + pad2(seconds)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
