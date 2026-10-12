/**
 * User's zipcode via IP geolocation (cached in localStorage). Falls back to
 * the default zipcode when the lookup fails.
 */
import { get, set, K } from './storage';
import { DEFAULT_ZIPCODE } from '../config/api';
import { request } from './http';

export function getZipCode() {
  const cached = get(K.ZIPCODE);
  if (cached) return Promise.resolve(cached);
  return request('GET', 'https://ipapi.co/json/', { timeout: 8000 })
    .then(function (res) {
      const zip = res.data && res.data.postal ? String(res.data.postal).trim() : '';
      if (res.status === 200 && zip.length >= 4) {
        set(K.ZIPCODE, zip);
        return zip;
      }
      return DEFAULT_ZIPCODE;
    })
    .catch(function () {
      return DEFAULT_ZIPCODE;
    });
}
