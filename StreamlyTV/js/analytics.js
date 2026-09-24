/**
 * Google Analytics 4 + Google Tag Manager — shared by every page.
 *
 * Include as the FIRST script in <head>:
 *   <script src="../js/analytics.js"></script>
 */
(function (w, d) {
    var GA_MEASUREMENT_ID = 'G-E50Q5Q9J8D';
    var GTM_CONTAINER_ID = 'GTM-T3Z4VHS';
    var CLIENT_ID_KEY = 'ga_client_id';

    function loadScript(src) {
        var s = d.createElement('script');
        s.async = true;
        s.src = src;
        var first = d.getElementsByTagName('script')[0];
        first.parentNode.insertBefore(s, first);
    }

    // Packaged Tizen apps run from file://, where GA cookies do not persist,
    // so every launch would count as a new user. Keep our own client id in
    // localStorage and hand it to GA instead.
    function getClientId() {
        var id = null;
        try {
            id = w.localStorage.getItem(CLIENT_ID_KEY);
            if (!id) {
                id = Math.floor(Math.random() * 2147483647) + '.' + Math.floor(Date.now() / 1000);
                w.localStorage.setItem(CLIENT_ID_KEY, id);
            }
        } catch (e) { /* storage unavailable — GA falls back to its own id */ }
        return id;
    }

    // ── GA4 (gtag.js) ──
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());

    var config = {};
    var clientId = getClientId();
    if (clientId) {
        config.client_id = clientId;
        config.client_storage = 'none';
    }
    w.gtag('config', GA_MEASUREMENT_ID, config);
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID);

    // ── Google Tag Manager ──
    w.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    loadScript('https://www.googletagmanager.com/gtm.js?id=' + GTM_CONTAINER_ID);
})(window, document);
