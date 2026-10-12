/**
 * Internet connection monitor (port of internet-monitor.js): probes a few
 * public endpoints every 10s (3s while offline); after 2 failures in a row
 * shows the no-internet popup with Retry.
 */
import { useEffect } from 'react';
import { popup } from './popup';

const CHECK_INTERVAL = 10000;
const CHECK_INTERVAL_OFFLINE = 3000;
const TIMEOUT = 5000;
const FAILURE_THRESHOLD = 2;
const ENDPOINTS = [
  'https://www.google.com/favicon.ico',
  'https://www.cloudflare.com/favicon.ico',
  'https://www.gstatic.com/generate_204',
];

export function useInternetMonitor(enabled) {
  useEffect(function () {
    if (!enabled || import.meta.env.VITE_DISABLE_INTERNET_MONITOR === '1') return undefined;

    let failures = 0;
    let popupShown = false;
    let timer = null;
    let stopped = false;

    function schedule(ms) {
      clearInterval(timer);
      timer = setInterval(check, ms);
    }

    function onOnline() {
      failures = 0;
      popupShown = false;
      schedule(CHECK_INTERVAL);
    }

    function onOffline() {
      if (popupShown || stopped) return;
      popupShown = true;
      popup.noInternet(function () {
        popupShown = false;
        check();
      });
      schedule(CHECK_INTERVAL_OFFLINE);
    }

    function onFailure() {
      failures++;
      if (failures >= FAILURE_THRESHOLD) onOffline();
    }

    function check() {
      if (stopped) return;
      const xhr = new XMLHttpRequest();
      const url = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)] + '?_=' + Date.now();
      try {
        xhr.open('HEAD', url, true);
      } catch (e) {
        onFailure();
        return;
      }
      xhr.timeout = TIMEOUT;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || xhr.status === 0) return;
        if (xhr.status >= 200 && xhr.status < 400) onOnline();
        else onFailure();
      };
      xhr.onerror = onFailure;
      xhr.ontimeout = onFailure;
      try {
        xhr.send();
      } catch (e) {
        onFailure();
      }
    }

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    check();
    schedule(CHECK_INTERVAL);

    return function () {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);
}
