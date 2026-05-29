// Academic Express Auto Answer - Background Service Worker
// Processes captured XHR data from content script

importScripts('parser.js');

async function processXHRData(url, responseText, senderId) {
    const { parsed, dataType } = AcademicExpressParser.parseQuestionData(responseText);

    if (parsed && parsed.questions && parsed.questions.length > 0) {
        await chrome.storage.session.set({
            questionData: parsed,
            dataUrl: url,
            timestamp: Date.now()
        });

        if (senderId) {
            chrome.tabs.sendMessage(senderId, {
                type: 'QUESTION_DATA_READY',
                questionCount: parsed.questions.length,
                dataType: dataType
            }).catch(() => { });
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_QUESTION_DATA') {
        chrome.storage.session.get(['questionData', 'dataUrl', 'timestamp'])
            .then(result => {
                sendResponse(result);
            });
        return true;
    }

    if (message.type === 'XHR_CAPTURED') {
        const tabId = sender.tab?.id;
        processXHRData(message.url, message.responseText, tabId)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('Failed to process captured XHR data:', error);
                sendResponse({ success: false, error: String(error) });
            });
        return true;
    }
});
