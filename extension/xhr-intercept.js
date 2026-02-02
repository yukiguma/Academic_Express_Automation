// XHR Interceptor running in MAIN world
// This script runs in the page context, can override XMLHttpRequest directly

(function () {
    'use strict';

    function isInterestingURL(url) {
        if (!url) return false;
        if (url.includes('save_progress_start')) return false;
        return url.endsWith('.xml') ||
            url.includes('authoring.cfc') ||
            url.includes('tango_data_manipulate.cfc') ||
            url.includes('bookXml');
    }

    function sendToContentScript(url, responseText) {
        window.postMessage({
            type: 'ACADEMIC_EXPRESS_XHR_CAPTURED',
            url: url,
            responseText: responseText
        }, '*');
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._interceptedUrl = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        const xhr = this;
        const url = xhr._interceptedUrl;

        if (url && isInterestingURL(url)) {
            xhr.addEventListener('load', function () {
                if (xhr.responseText) {
                    sendToContentScript(url, xhr.responseText);
                }
            });
        }
        return originalSend.apply(this, arguments);
    };
})();
