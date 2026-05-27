// XHR Interceptor running in MAIN world
// This script runs in the page context, can override XMLHttpRequest directly

(function () {
    'use strict';

    function getRequestUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input || '');
    }

    function isInterestingURL(url) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('save_progress')) return false;
        return lowerUrl.endsWith('.xml') ||
            lowerUrl.endsWith('.json') ||
            lowerUrl.includes('authoring.cfc') ||
            lowerUrl.includes('tango_data_manipulate.cfc') ||
            lowerUrl.includes('bookxml') ||
            lowerUrl.includes('question') ||
            lowerUrl.includes('quiz');
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

    if (typeof window.fetch === 'function') {
        const originalFetch = window.fetch;

        window.fetch = async function (input, init) {
            const url = getRequestUrl(input);
            const response = await originalFetch.apply(this, arguments);

            if (isInterestingURL(url)) {
                response.clone().text()
                    .then(text => {
                        if (text) sendToContentScript(url, text);
                    })
                    .catch(() => { });
            }

            return response;
        };
    }
})();
