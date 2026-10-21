/**
 * Geolocation utility — finds the zipcode of where the TV actually is
 * (IP geolocation; TVs have no GPS) and caches it in localStorage.
 *
 * Several free, keyless lookup services are tried in turn: each one limits
 * requests per client IP, and the old single service (ipapi.co) answering
 * 429 "RateLimited" meant every login sent the hard-coded fallback.
 *
 * Usage:
 *   GeoLocation.lookupDeviceZip(function (zip) { ... }, maxWaitMs);
 *     → zip of the device's current location ('' if every service failed).
 *       Uses the cache while it is fresh; maxWaitMs caps how long the
 *       caller waits (the lookup itself carries on and updates the cache).
 *   GeoLocation.getDeviceZip()        → best known device zip, synchronous
 *   GeoLocation.hasFreshDeviceZip()   → cached and younger than MAX_AGE
 *   GeoLocation.getZipCode(callback)  → zip for the guide (streamly_zipcode:
 *       the account zip after login, the device zip before it)
 *   GeoLocation.ZIPCODE_FALLBACK      → '302020'
 */
const GeoLocation = (function () {
    'use strict';

    const LS_KEY = 'streamly_zipcode';          // guide zip (account zip once logged in)
    const DEVICE_KEY = 'device_zipcode';        // where the TV is
    const DEVICE_TIME_KEY = 'device_zipcode_at';
    const FALLBACK = '302020';
    const MAX_AGE = 12 * 60 * 60 * 1000;        // a TV rarely moves: refresh twice a day
    const REQUEST_TIMEOUT = 4000;

    // Free services, no API key, CORS enabled. zip(data) reads the postal code.
    const PROVIDERS = [
        { url: 'https://ipwho.is/', zip: function (d) { return d.success === false ? '' : d.postal; } },
        { url: 'https://ipinfo.io/json', zip: function (d) { return d.postal; } },
        { url: 'https://ipapi.co/json/', zip: function (d) { return d.error ? '' : d.postal; } },
        { url: 'https://free.freeipapi.com/api/v1/json', zip: function (d) { return d.zipCode; } }
    ];

    const RETRY_AFTER_FAILURE = 2 * 60 * 1000;

    let inFlight = null;  // callbacks waiting for the running lookup
    let failedAt = 0;     // every service failed: don't ask again right away

    function validZip(zip) {
        zip = zip === null || zip === undefined ? '' : String(zip).trim();
        return /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(zip) ? zip : '';
    }

    function getJSON(url, done) {
        const xhr = new XMLHttpRequest();
        let finished = false;
        function finish(data) {
            if (finished) return;
            finished = true;
            done(data);
        }
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT;
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status !== 200) return finish(null);
            try {
                finish(JSON.parse(xhr.responseText));
            } catch (e) {
                finish(null);
            }
        };
        xhr.onerror = function () { finish(null); };
        xhr.ontimeout = function () { finish(null); };
        try {
            xhr.send();
        } catch (e) {
            finish(null);
        }
    }

    // Try each provider until one returns a zip; '' if none did.
    function fetchDeviceZip(done) {
        let i = 0;
        function next() {
            if (i >= PROVIDERS.length) return done('');
            const provider = PROVIDERS[i++];
            getJSON(provider.url, function (data) {
                let zip = '';
                try { zip = data ? validZip(provider.zip(data)) : ''; } catch (e) { zip = ''; }
                if (zip) done(zip);
                else next();
            });
        }
        next();
    }

    function getDeviceZip() {
        return localStorage.getItem(DEVICE_KEY) || '';
    }

    function hasFreshDeviceZip() {
        const at = Number(localStorage.getItem(DEVICE_TIME_KEY)) || 0;
        return !!getDeviceZip() && Date.now() - at < MAX_AGE;
    }

    function lookupDeviceZip(callback, maxWaitMs) {
        if (hasFreshDeviceZip()) {
            if (callback) callback(getDeviceZip());
            return;
        }

        if (Date.now() - failedAt < RETRY_AFTER_FAILURE) {
            if (callback) callback(getDeviceZip());
            return;
        }

        let called = false;
        function reply() {
            if (called || !callback) return;
            called = true;
            callback(getDeviceZip());
        }
        if (maxWaitMs) setTimeout(reply, maxWaitMs);

        if (inFlight) {
            inFlight.push(reply);
            return;
        }
        inFlight = [reply];
        fetchDeviceZip(function (zip) {
            failedAt = zip ? 0 : Date.now();
            if (zip) {
                localStorage.setItem(DEVICE_KEY, zip);
                localStorage.setItem(DEVICE_TIME_KEY, String(Date.now()));
                // Before login the guide has no account zip yet: use this one
                if (!localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, zip);
            }
            const waiting = inFlight;
            inFlight = null;
            for (let i = 0; i < waiting.length; i++) waiting[i]();
        });
    }

    // Zip for the guide (unchanged behaviour for existing callers)
    function getZipCode(callback) {
        const cached = localStorage.getItem(LS_KEY);
        if (cached) {
            if (callback) callback(cached);
            return;
        }
        lookupDeviceZip(function (zip) {
            if (callback) callback(zip || FALLBACK);
        });
    }

    return {
        lookupDeviceZip: lookupDeviceZip,
        getDeviceZip: getDeviceZip,
        hasFreshDeviceZip: hasFreshDeviceZip,
        getZipCode: getZipCode,
        ZIPCODE_FALLBACK: FALLBACK
    };
})();
