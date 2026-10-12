/**
 * Onboarding guide: Privacy / Help in the header, a 3-slide carousel from
 * the login-guide API and "Get Started" -> login.
 *
 * Privacy modal: UP/DOWN scroll; its OK button only appears (and takes
 * focus) once the policy has been scrolled to the end. Help modal: BACK
 * closes. BACK with no modal open asks to exit the app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useKeys } from '../core/keys';
import { popup } from '../core/popup';
import { Spinner } from '../core/loading';
import { nav } from '../core/nav';
import { KEY } from '../lib/keys';
import { exitApp, getAppVersion } from '../lib/tizen';
import { LOGO } from '../components/Header';
import { fetchGuideSlides, fetchPrivacyPolicy, fetchSupportInfo, SUPPORT_DEFAULTS } from '../services/content';
import { FiPhone, FiMail } from 'react-icons/fi';

const SCROLL_STEP = 60;
const SLIDE_MS = 3000;

const FOCUS_MAP = {
  left: { help: 'privacy' },
  right: { privacy: 'help' },
  up: { privacy: 'help', help: 'privacy', start: 'privacy' },
  down: { privacy: 'start', help: 'start' },
};

function isAtEnd(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
}

export default function Guide() {
  // null while loading: a small spinner in the carousel, never a blocking
  // overlay, so the remote works immediately.
  const [slides, setSlides] = useState(null);
  const [slide, setSlide] = useState(0);
  const [focus, setFocus] = useState('privacy');
  const [modal, setModal] = useState(null); // 'privacy' | 'help'
  const [privacy, setPrivacy] = useState({ title: 'Privacy & Policy', paragraphs: ['Loading...'] });
  const [support, setSupport] = useState(SUPPORT_DEFAULTS);
  const [okVisible, setOkVisible] = useState(false);
  const [okFocused, setOkFocused] = useState(false);
  const scrollRef = useRef(null);

  useEffect(function () {
    fetchGuideSlides().then(setSlides, function () {
      setSlides([{ title: 'Welcome to Streamly', description: 'Live TV on your Samsung TV.' }]);
    });
    fetchPrivacyPolicy().then(setPrivacy, function () {
      setPrivacy({ title: 'Privacy & Policy', paragraphs: ['Failed to load Privacy & Policy. Please try again later.'] });
    });
    fetchSupportInfo().then(setSupport);
  }, []);

  useEffect(function () {
    const timer = setInterval(function () {
      setSlide(function (s) { return s + 1; });
    }, SLIDE_MS);
    return function () {
      clearInterval(timer);
    };
  }, []);

  // Short policy (or new text while the modal is open): OK may be due now.
  useEffect(function () {
    if (modal !== 'privacy') return;
    const el = scrollRef.current;
    if (el && isAtEnd(el)) {
      setOkVisible(true);
      setOkFocused(true);
    }
  }, [modal, privacy]);

  function openModal(name) {
    setModal(name);
    setOkVisible(false);
    setOkFocused(false);
    setTimeout(function () {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, 0);
  }

  function closeModal() {
    const opener = modal;
    setModal(null);
    setOkVisible(false);
    setOkFocused(false);
    setFocus(opener || 'privacy');
  }

  function scroll(dir) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop += dir * SCROLL_STEP;
    if (modal === 'privacy' && dir > 0 && isAtEnd(el)) {
      setOkVisible(true);
      setOkFocused(true);
    }
  }

  function showExit() {
    popup.exit(function (yes) {
      if (yes) exitApp();
    });
  }

  useKeys(function (code) {
    if (modal) {
      if (code === KEY.BACK) closeModal();
      else if (code === KEY.EXIT) showExit();
      else if (code === KEY.UP) {
        if (okFocused) {
          setOkFocused(false);
          setOkVisible(false);
        }
        scroll(-1);
      } else if (code === KEY.DOWN) {
        if (!okFocused) scroll(1);
      } else if (code === KEY.ENTER && modal === 'privacy' && okFocused) {
        closeModal();
      }
      return;
    }
    switch (code) {
      case KEY.LEFT:
        if (FOCUS_MAP.left[focus]) setFocus(FOCUS_MAP.left[focus]);
        break;
      case KEY.RIGHT:
        if (FOCUS_MAP.right[focus]) setFocus(FOCUS_MAP.right[focus]);
        break;
      case KEY.UP:
        if (FOCUS_MAP.up[focus]) setFocus(FOCUS_MAP.up[focus]);
        break;
      case KEY.DOWN:
        if (FOCUS_MAP.down[focus]) setFocus(FOCUS_MAP.down[focus]);
        break;
      case KEY.ENTER:
        if (focus === 'start') nav.go('login');
        else openModal(focus);
        break;
      case KEY.BACK:
      case KEY.EXIT:
        showExit();
        break;
      default:
        break;
    }
  });

  return (
    <div className="screen guide">
      <div className="app-header">
        <img src={LOGO} alt="Streamly" className="app-header-logo" />
        <div className="app-header-right">
          <button type="button" className={'outline-btn' + (focus === 'privacy' && !modal ? ' focused' : '')}
            onClick={function () { openModal('privacy'); }}>Privacy</button>
          <button type="button" className={'outline-btn' + (focus === 'help' && !modal ? ' focused' : '')}
            onClick={function () { openModal('help'); }}>Help</button>
        </div>
      </div>

      <div className="guide-carousel">
        {slides ? (
          <div className="guide-slide" key={slide % slides.length}>
            <h2>{slides[slide % slides.length].title}</h2>
            <h5>{slides[slide % slides.length].description}</h5>
          </div>
        ) : (
          <div className="guide-slide"><Spinner small /></div>
        )}
        <div className="guide-dots">
          {(slides || [0, 1, 2]).map(function (x, i) {
            return <span key={i} className={'guide-dot' + (slides && i === slide % slides.length ? ' active' : '')} />;
          })}
        </div>
        <button type="button" className={'btn btn-primary guide-start' + (focus === 'start' && !modal ? ' focused' : '')}
          onClick={function () { nav.go('login'); }}>Get Started</button>
      </div>

      {modal === 'privacy' && (
        <div className="overlay-dim">
          <div className="dialog guide-modal scrollbar-primary" ref={scrollRef}>
            <h4 className="guide-modal-title">{privacy.title}</h4>
            {privacy.paragraphs.map(function (p, i) {
              return <p key={i} className="guide-modal-text">{p}</p>;
            })}
            <button type="button" className={'btn btn-primary guide-ok' + (okFocused ? ' focused' : '')}
              style={{ visibility: okVisible ? 'visible' : 'hidden' }} onClick={closeModal}>Ok</button>
          </div>
        </div>
      )}

      {modal === 'help' && (
        <div className="overlay-dim">
          <div className="dialog guide-modal help-modal" ref={scrollRef}>
            <img src="images/help.png" alt="Help" className="help-img" />
            <p className="help-text">{support.message1}</p>
            {support.message2 && <p className="help-text">{support.message2}</p>}
            <div className="help-contacts">
              <div className="help-contact"><FiPhone /><span>{support.phone}</span></div>
              <div className="help-contact"><FiMail /><span>{support.email}</span></div>
            </div>
            <p className="help-version">{'Version ' + getAppVersion()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
