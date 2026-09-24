/**
 * Geolocation utility — determines the user's zipcode dynamically
 * via IP geolocation, then caches it in localStorage.
 *
 * Usage:
 *   GeoLocation.getZipCode(function (zipcode) { ... });
 *     → Returns the zipcode from cache or fetches it asynchronously.
 *     → Falls back to '302020' if the lookup fails.
 *
 *   GeoLocation.ZIPCODE_FALLBACK  → '302020'
 */
const GeoLocation = (function () {
    'use strict';

    const LS_KEY = 'streamly_zipcode';
    const FALLBACK = '302020';

    /**
     * Fetch zipcode from an IP geolocation service.
     * Calls callback(zipcode) on completion.
     */
    function fetchZipCode(callback) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://ipapi.co/json/', true);
        xhr.timeout = 8000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        const zip = data && data.postal ? String(data.postal).trim() : null;
                        if (zip && zip.length >= 4) {
                            localStorage.setItem(LS_KEY, zip);
                            if (callback) callback(zip);
                            return;
                        }
                    } catch (e) {
                        // JSON parse failed, fall through
                    }
                }
                // Fallback on any failure
                if (callback) callback(FALLBACK);
            }
        };

        xhr.onerror = function () {
            if (callback) callback(FALLBACK);
        };
        xhr.ontimeout = function () {
            if (callback) callback(FALLBACK);
        };

        try {
            xhr.send();
        } catch (e) {
            if (callback) callback(FALLBACK);
        }
    }

    /**
     * Public API — get the user's zipcode.
     *
     * Delivers the result asynchronously via callback so the first call
     * may need to wait for the network request. Subsequent calls return
     * the cached value synchronously (still via callback for API consistency).
     */
    function getZipCode(callback) {
        const cached = localStorage.getItem(LS_KEY);
        if (cached) {
            if (callback) callback(cached);
            return;
        }
        fetchZipCode(callback);
    }

    return {
        getZipCode: getZipCode,
        ZIPCODE_FALLBACK: FALLBACK
    };
})();