// Academic Express Auto Answer - Background Service Worker
// Intercepts XHR requests to capture question data

console.log("Academic Express Background Service Worker Loaded");

// Helper to check if URL contains question data
function isInterestingURL(url) {
    if (!url) return false;
    if (url.includes('save_progress_start')) return false;
    return url.endsWith('.xml') ||
        url.includes('authoring.cfc') ||
        url.includes('tango_data_manipulate.cfc') ||
        url.includes('bookXml');
}

// Listen for completed requests
chrome.webRequest.onCompleted.addListener(
    async (details) => {
        if (!isInterestingURL(details.url)) return;

        console.log("Intercepted interesting request:", details.url);

        try {
            // Fetch the response body (webRequest doesn't provide body directly in MV3)
            const response = await fetch(details.url);
            const text = await response.text();

            let parsed = null;
            let dataType = null;

            if (text.trim().startsWith('<')) {
                // XML data
                parsed = parseXML(text);
                dataType = 'xml';
            } else if (text.trim().startsWith('{')) {
                // JSON data (Vocabulary Bank)
                try {
                    parsed = parseJSON(JSON.parse(text));
                    dataType = 'json';
                } catch (e) {
                    console.error("JSON parse error:", e);
                }
            }

            if (parsed && parsed.questions && parsed.questions.length > 0) {
                console.log(`Parsed ${parsed.questions.length} questions from ${dataType}`);

                // Store in session storage
                await chrome.storage.session.set({
                    questionData: parsed,
                    dataUrl: details.url,
                    timestamp: Date.now()
                });

                // Notify content script
                chrome.tabs.sendMessage(details.tabId, {
                    type: 'QUESTION_DATA_READY',
                    questionCount: parsed.questions.length,
                    dataType: dataType
                }).catch(err => {
                    // Tab might not have content script ready yet
                    console.log("Could not send message to tab:", err.message);
                });
            }
        } catch (e) {
            console.error("Error processing intercepted request:", e);
        }
    },
    { urls: ["*://supereigo.campus.kit.ac.jp/*"] }
);

// Parse XML question data
function parseXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const questions = xmlDoc.getElementsByTagName('question');

    if (questions.length === 0) return null;

    const questionsList = [];

    for (let i = 0; i < questions.length; i++) {
        const result = questions[i];
        const type = result.getAttribute('type');

        // Supported types
        if (type === 'matching' || type === 'Insertion' || type === 'multipleChoice' ||
            type === 'trueFalse' || type === 'anaumeFilIn' || type === 'ClozeTest' ||
            (type && type.includes('sorting'))) {

            const questionTextNode = result.getElementsByTagName('questionText')[0];
            const questionText = questionTextNode?.textContent || "";

            let answers = [];

            // Extract answers from [bracketed] text
            if (questionText.includes('[')) {
                const regex = /\[(.*?)\]/g;
                let match;
                while ((match = regex.exec(questionText)) !== null) {
                    answers.push(match[1]);
                }
            }

            // Check for <answers><answer> structure
            const answerNode = result.getElementsByTagName('answers')[0];
            if (answerNode) {
                const answerElements = answerNode.getElementsByTagName('answer');
                for (let j = 0; j < answerElements.length; j++) {
                    const ansVal = answerElements[j].textContent.trim();
                    if (!ansVal) continue;

                    const choices = result.getElementsByTagName('choice');
                    if (choices.length > 0) {
                        for (let k = 0; k < choices.length; k++) {
                            if (choices[k].getAttribute('no') === ansVal) {
                                answers.push(choices[k].textContent.trim());
                                break;
                            }
                        }
                    } else {
                        if (!answers.includes(ansVal)) {
                            answers.push(ansVal);
                        }
                    }
                }
            }

            // Fallback: Check for <option correct="true">
            const options = result.getElementsByTagName('option');
            if (options.length > 0) {
                for (let j = 0; j < options.length; j++) {
                    if (options[j].getAttribute('correct') === 'true') {
                        answers.push(options[j].textContent);
                    }
                }
            }

            if (questionText || answers.length > 0) {
                const signatureText = questionText.replace(/\[.*?\]/g, '');
                questionsList.push({
                    type: type,
                    answers: answers,
                    rawText: questionText,
                    signature: signatureText.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
                });
            }
        }
    }

    return { questions: questionsList };
}

// Parse JSON question data (Vocabulary Bank)
function parseJSON(data) {
    if (!data || !data.questions || !Array.isArray(data.questions)) return null;

    const questionsList = [];

    data.questions.forEach(q => {
        const questionText = q.keyword?.en || q.keyword?.ja || "";
        const answerText = q.keyword?.ja || q.keyword?.en || "";

        if (questionText) {
            questionsList.push({
                type: 'multipleChoice',
                answers: [answerText],
                rawText: questionText,
                signature: questionText.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40),
                isAutoAdvance: true
            });
        }
    });

    return { questions: questionsList };
}

// Listen for content script requesting data
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_QUESTION_DATA') {
        chrome.storage.session.get(['questionData', 'dataUrl', 'timestamp'])
            .then(result => {
                sendResponse(result);
            });
        return true; // Keep channel open for async response
    }
});
