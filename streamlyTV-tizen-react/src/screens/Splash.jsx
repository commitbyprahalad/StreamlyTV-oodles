import React, { useEffect } from 'react';
import { nav } from '../core/nav';
import { get, K } from '../lib/storage';
import { LOGO } from '../components/Header';

// Splash: logo for 1.5s, then logged-in users go to the EPG (or back to the
// subscription screen if still blocked there), everyone else to the guide.
export default function Splash() {
  useEffect(function () {
    const timer = setTimeout(function () {
      const token = get(K.JWT);
      if (token && get(K.SUBSCRIPTION_BLOCKED) === '1') nav.go('subscription');
      else if (token) nav.go('epg');
      else nav.go('guide');
    }, 1500);
    return function () {
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="screen splash">
      <div className="splash-gradient" />
      <img src={LOGO} alt="Streamly" className="splash-logo" />
    </div>
  );
}
