// Academic Express Auto Answer - Background Service Worker
// Processes captured XHR data from content script

// Parse XML question data (regex-based for Service Worker compatibility)
function parseXML(xmlText) {
    const questionsList = [];

    // Extract all <question> elements using regex
    const questionRegex = /<question[^>]*type="([^"]*)"[^>]*>([\s\S]*?)<\/question>/gi;
    let questionMatch;

    while ((questionMatch = questionRegex.exec(xmlText)) !== null) {
        const type = questionMatch[1];
        const questionContent = questionMatch[2];

        // Supported types
        if (type === 'matching' || type === 'Insertion' || type === 'multipleChoice' ||
            type === 'trueFalse' || type === 'anaumeFilIn' || type === 'ClozeTest' ||
            (type && type.includes('sorting'))) {

            // Extract questionText
            const questionTextMatch = questionContent.match(/<questionText[^>]*>([\s\S]*?)<\/questionText>/i);
            const questionText = questionTextMatch ? questionTextMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : "";

            let answers = [];

            // Extract answers from [bracketed] text
            if (questionText.includes('[')) {
                const bracketRegex = /\[(.*?)\]/g;
                let match;
                while ((match = bracketRegex.exec(questionText)) !== null) {
                    answers.push(match[1]);
                }
            }

            // Check for <answers><answer> structure
            const answersMatch = questionContent.match(/<answers[^>]*>([\s\S]*?)<\/answers>/i);
            if (answersMatch) {
                const answersContent = answersMatch[1];
                const answerRegex = /<answer[^>]*>([\s\S]*?)<\/answer>/gi;
                let ansMatch;

                // Extract all choices first
                const choices = {};
                const choiceRegex = /<choice[^>]*no="([^"]*)"[^>]*>([\s\S]*?)<\/choice>/gi;
                let choiceMatch;
                while ((choiceMatch = choiceRegex.exec(questionContent)) !== null) {
                    choices[choiceMatch[1]] = choiceMatch[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
                }

                while ((ansMatch = answerRegex.exec(answersContent)) !== null) {
                    const ansVal = ansMatch[1].trim();
                    if (!ansVal) continue;

                    if (Object.keys(choices).length > 0 && choices[ansVal]) {
                        answers.push(choices[ansVal]);
                    } else {
                        if (!answers.includes(ansVal)) {
                            answers.push(ansVal);
                        }
                    }
                }
            }

            // Fallback: Check for <option correct="true">
            const optionRegex = /<option[^>]*correct="true"[^>]*>([\s\S]*?)<\/option>/gi;
            let optMatch;
            while ((optMatch = optionRegex.exec(questionContent)) !== null) {
                const optText = optMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
                if (optText && !answers.includes(optText)) {
                    answers.push(optText);
                }
            }

            if (questionText || answers.length > 0) {
                const signatureText = questionText.replace(/\[.*?\]/g, '').replace(/<[^>]*>/g, '');
                questionsList.push({
                    type: type,
                    answers: answers,
                    rawText: questionText,
                    signature: signatureText.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
                });
            }
        }
    }

    return questionsList.length > 0 ? { questions: questionsList } : null;
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

// Process captured XHR data
async function processXHRData(url, responseText, senderId) {
    let parsed = null;
    let dataType = null;

    if (responseText.trim().startsWith('<')) {
        parsed = parseXML(responseText);
        dataType = 'xml';
    } else if (responseText.trim().startsWith('{')) {
        try {
            parsed = parseJSON(JSON.parse(responseText));
            dataType = 'json';
        } catch (e) {
            // JSON parse error
        }
    }

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

// Listen for messages from content script
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
        processXHRData(message.url, message.responseText, tabId);
        sendResponse({ success: true });
    }
});
