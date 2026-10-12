/**
 * Screen navigation. The whole app is one page; switching screens swaps a
 * React component (no page reload), which is what makes moving between
 * screens instant compared to the current multi-page app.
 *
 *   nav.go('login') / nav.go('epg', params)
 */
import { useEffect, useState } from 'react';
import { trackScreen } from '../lib/analytics';
import { setCrashScreen } from '../lib/crashLogger';

export const SCREEN_TITLES = {
  splash: 'Splash Screen',
  guide: 'Guide Screen',
  login: 'Login Screen',
  device: 'Device Limit Screen',
  personalDevice: 'Personal Device Screen',
  hotelRoom: 'Hotel Room Screen',
  subscription: 'Subscription Screen',
  epg: 'EPG Screen',
  settings: 'Settings Screen',
};

let setRoute = null;
let route = { screen: 'splash', params: {}, id: 0 };
const listeners = [];

export const nav = {
  go: function (screen, params) {
    route = { screen: screen, params: params || {}, id: route.id + 1 };
    setCrashScreen(SCREEN_TITLES[screen] || screen);
    trackScreen(screen, SCREEN_TITLES[screen]);
    if (setRoute) setRoute(route);
    for (let i = 0; i < listeners.length; i++) listeners[i](route);
  },
  current: function () {
    return route;
  },
};

export function useRoute() {
  const [state, setState] = useState(route);
  useEffect(function () {
    setRoute = setState;
    setCrashScreen(SCREEN_TITLES[route.screen] || route.screen);
    return function () {
      setRoute = null;
    };
  }, []);
  return state;
}
