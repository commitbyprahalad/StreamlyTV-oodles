/**
 * Google Analytics 4 + Tag Manager (same property and container as the
 * current app). A packaged Tizen app runs from file://, where GA cookies do
 * not persist, so the client id is kept in localStorage instead.
 *
 * The app is a single page, so each screen change is sent as a page_view.
 */
import { get, set, K } from './storage';

const GA_MEASUREMENT_ID = 'G-E50Q5Q9J8D';
const GTM_CONTAINER_ID = 'GTM-T3Z4VHS';

let initialized = false;

function loadScript(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function getClientId() {
  let id = get(K.GA_CLIENT_ID);
  if (!id) {
    id = Math.floor(Math.random() * 2147483647) + '.' + Math.floor(Date.now() / 1000);
    set(K.GA_CLIENT_ID, id);
  }
  return id;
}

export function initAnalytics() {
  if (initialized || import.meta.env.VITE_DISABLE_ANALYTICS === '1') return;
  initialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    client_id: getClientId(),
    client_storage: 'none',
    send_page_view: false,
  });
  loadScript('https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID);

  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  loadScript('https://www.googletagmanager.com/gtm.js?id=' + GTM_CONTAINER_ID);
}

export function trackScreen(screen, title) {
  if (!initialized || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_title: title || screen,
    page_location: 'app://streamlytv/' + screen,
    page_path: '/' + screen,
  });
}
