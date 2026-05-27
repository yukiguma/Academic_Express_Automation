// Academic Express Auto Answer - Background Service Worker
// Processes captured XHR data from content script

function decodeEntities(text) {
    if (!text) return "";
    const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };

    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
        const key = entity.toLowerCase();
        if (key[0] === '#') {
            const code = key[1] === 'x'
                ? parseInt(key.slice(2), 16)
                : parseInt(key.slice(1), 10);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        }
        return entities[key] || _;
    });
}

function unwrapText(text) {
    return decodeEntities(String(text || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim());
}

function makeSignature(text) {
    return unwrapText(text)
        .replace(/\[.*?\]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')
        .slice(0, 40);
}

function pushUnique(target, value) {
    const cleaned = unwrapText(value);
    if (cleaned && !target.includes(cleaned)) {
        target.push(cleaned);
    }
}

function parseAttributes(rawAttrs) {
    const attrs = {};
    const attrRegex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;

    while ((match = attrRegex.exec(rawAttrs || "")) !== null) {
        attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? "");
    }

    return attrs;
}

function firstTagText(content, tagNames) {
    for (const tagName of tagNames) {
        const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
        const match = content.match(regex);
        if (match) return match[1].trim();
    }
    return "";
}

function collectChoices(questionContent) {
    const choices = {};
    const choiceRegex = /<(choice|option|select|selection)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = choiceRegex.exec(questionContent)) !== null) {
        const attrs = parseAttributes(match[2]);
        const text = unwrapText(match[3]);
        ['no', 'id', 'value', 'key', 'answerid'].forEach(key => {
            if (attrs[key] && text) choices[attrs[key]] = text;
        });
    }

    return choices;
}

function pushMappedAnswer(target, value, choices) {
    const cleaned = unwrapText(value);
    if (!cleaned) return;
    pushUnique(target, choices[cleaned] || cleaned);
}

function collectXMLAnswers(questionContent, questionText) {
    const answers = [];
    const choices = collectChoices(questionContent);

    const bracketRegex = /\[(.*?)\]/g;
    let bracketMatch;
    while ((bracketMatch = bracketRegex.exec(questionText)) !== null) {
        pushMappedAnswer(answers, bracketMatch[1], choices);
    }

    const answersMatch = questionContent.match(/<answers[^>]*>([\s\S]*?)<\/answers>/i);
    if (answersMatch) {
        const answersContent = answersMatch[1];
        const answerRegex = /<answer\b([^>]*)>([\s\S]*?)<\/answer>/gi;
        let answerMatch;

        while ((answerMatch = answerRegex.exec(answersContent)) !== null) {
            const attrs = parseAttributes(answerMatch[1]);
            pushMappedAnswer(answers, attrs.value || attrs.no || attrs.id || answerMatch[2], choices);
        }

        const selfClosingAnswerRegex = /<answer\b([^>]*)\/>/gi;
        while ((answerMatch = selfClosingAnswerRegex.exec(answersContent)) !== null) {
            const attrs = parseAttributes(answerMatch[1]);
            pushMappedAnswer(answers, attrs.value || attrs.no || attrs.id, choices);
        }
    }

    const correctTagRegex = /<(choice|option|answer)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let correctMatch;
    while ((correctMatch = correctTagRegex.exec(questionContent)) !== null) {
        const attrs = parseAttributes(correctMatch[2]);
        const isCorrect = ['true', '1', 'yes', 'correct'].includes(String(attrs.correct || attrs.iscorrect || attrs.answer || '').toLowerCase());
        if (isCorrect) pushMappedAnswer(answers, correctMatch[3], choices);
    }

    [
        'answerText',
        'answer_text',
        'correct',
        'correctNo',
        'correctChoice',
        'correct_choice',
        'correctAnswer',
        'correctAnswers',
        'correct_answer',
        'correct_answers',
        'right',
        'rightAnswer',
        'right_answer',
        'solution'
    ].forEach(tagName => {
        const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
        let match;
        while ((match = regex.exec(questionContent)) !== null) {
            pushMappedAnswer(answers, match[1], choices);
        }
    });

    return answers;
}

function inferType(type, questionContent) {
    const lowerType = String(type || "").toLowerCase();
    if (lowerType.includes('sort')) return 'sorting';
    if (lowerType.includes('true')) return 'trueFalse';
    if (lowerType.includes('choice') || lowerType.includes('select') || lowerType.includes('quiz')) return 'multipleChoice';
    if (lowerType.includes('cloze') || lowerType.includes('fill') || lowerType.includes('typing') || lowerType.includes('anaume')) return 'typing';
    if (lowerType) return type;
    if (/<select\b/i.test(questionContent)) return 'multipleChoice';
    return 'multipleChoice';
}

// Parse XML question data (regex-based for Service Worker compatibility)
function parseXML(xmlText) {
    const questionsList = [];
    const questionRegex = /<question\b([^>]*)>([\s\S]*?)<\/question>/gi;
    let questionMatch;
    let displayOrder = 0;

    function pushQuestion(attrs, questionContent) {
        const type = inferType(attrs.type || attrs.questiontype || attrs.kind, questionContent);
        const questionText = unwrapText(firstTagText(questionContent, [
            'questionText',
            'question_text',
            'qText',
            'q_text',
            'questionSentence',
            'question_sentence',
            'sentence',
            'sentenceText',
            'sentence_text',
            'example',
            'phrase',
            'promptText',
            'prompt_text',
            'prompt',
            'body',
            'text',
            'en',
            'eng'
        ]));
        const answers = collectXMLAnswers(questionContent, questionText);

        if (questionText || answers.length > 0) {
            displayOrder += 1;
            questionsList.push({
                type: type,
                answers: answers,
                rawText: questionText,
                signature: makeSignature(questionText),
                displayOrder: displayOrder,
                questionNo: attrs.no || ""
            });
        }
    }

    while ((questionMatch = questionRegex.exec(xmlText)) !== null) {
        pushQuestion(parseAttributes(questionMatch[1]), questionMatch[2]);
    }

    if (questionsList.length === 0) {
        const genericBlockRegex = /<(item|row|entry|quiz|problem|word)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
        let blockMatch;

        while ((blockMatch = genericBlockRegex.exec(xmlText)) !== null) {
            pushQuestion(parseAttributes(blockMatch[2]), blockMatch[3]);
        }
    }

    return questionsList.length > 0 ? { questions: questionsList } : null;
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        if (current && typeof current === 'object') return current[key];
        return undefined;
    }, obj);
}

function firstStringValue(obj, paths) {
    for (const path of paths) {
        const value = getNestedValue(obj, path);
        if (typeof value === 'string' || typeof value === 'number') {
            const text = unwrapText(value);
            if (text) return text;
        }
    }
    return "";
}

function findQuestionItems(data, output = [], depth = 0) {
    if (!data || depth > 4) return output;

    if (Array.isArray(data)) {
        if (data.some(item => item && typeof item === 'object' && (
            item.question || item.questionText || item.question_text || item.prompt || item.text ||
            item.keyword || item.answers || item.answer || item.correctAnswer || item.correct_answer || item.choices || item.options
        ))) {
            output.push(...data.filter(item => item && typeof item === 'object'));
            return output;
        }
        data.forEach(item => findQuestionItems(item, output, depth + 1));
        return output;
    }

    if (typeof data === 'object') {
        ['questions', 'questionList', 'items', 'results', 'data'].forEach(key => {
            if (data[key]) findQuestionItems(data[key], output, depth + 1);
        });
    }

    return output;
}

function collectJSONAnswers(q) {
    const answers = [];
    const optionMap = {};
    const options = Array.isArray(q.choices) ? q.choices : (Array.isArray(q.options) ? q.options : []);

    options.forEach((option, index) => {
        const text = option && typeof option === 'object'
            ? firstStringValue(option, ['text', 'label', 'value', 'en', 'ja', 'name'])
            : unwrapText(option);
        ['id', 'no', 'value', 'key'].forEach(key => {
            if (option && option[key] !== undefined && text) optionMap[String(option[key])] = text;
        });
        optionMap[String(index)] = text;
        optionMap[String(index + 1)] = text;

        if (option && ['true', '1', 'yes', 'correct'].includes(String(option.correct ?? option.isCorrect ?? option.is_correct ?? option.answer ?? '').toLowerCase())) {
            pushUnique(answers, text);
        }
    });

    const directAnswer = q.correctAnswer ?? q.correctAnswers ?? q.correct_answer ?? q.correct_answers ?? q.rightAnswer ?? q.right_answer ?? q.solution ?? q.answer ?? q.answers;
    const values = Array.isArray(directAnswer) ? directAnswer : [directAnswer];
    values.forEach(value => {
        if (value && typeof value === 'object') {
            pushUnique(answers, firstStringValue(value, ['text', 'label', 'value', 'en', 'ja', 'name']));
        } else if (value !== undefined && value !== null) {
            const key = String(value);
            pushUnique(answers, optionMap[key] || key);
        }
    });

    if (q.keyword?.ja || q.keyword?.en) {
        pushUnique(answers, q.keyword.ja || q.keyword.en);
    }

    return answers;
}

function isTangoQuestion(item) {
    return item && typeof item === 'object' &&
        item.keyword && typeof item.keyword === 'object' &&
        Array.isArray(item.tangolists_eng) &&
        Array.isArray(item.tangolists_jan);
}

function getTangoDirections(data) {
    const wdType = String(data?.wd_type ?? data?.wdType ?? "");
    if (wdType === "1") return [['ja', 'en']];
    if (wdType === "5") return [['en', 'ja']];
    return [['ja', 'en'], ['en', 'ja']];
}

function parseTangoData(data) {
    if (!data || !Array.isArray(data.questions) || !data.questions.some(isTangoQuestion)) {
        return null;
    }

    const questionsList = [];
    const directions = getTangoDirections(data);

    data.questions.forEach((q, index) => {
        if (!isTangoQuestion(q)) return;

        directions.forEach(([promptLang, answerLang]) => {
            const prompt = unwrapText(q.keyword[promptLang]);
            const answer = unwrapText(q.keyword[answerLang]);
            if (!prompt || !answer) return;

            questionsList.push({
                type: 'multipleChoice',
                answers: [answer],
                rawText: prompt,
                signature: makeSignature(prompt),
                displayOrder: index + 1,
                questionNo: String(q.word_no ?? q.level_no ?? ""),
                isAutoAdvance: true
            });
        });
    });

    return questionsList.length > 0 ? { questions: questionsList } : null;
}

// Parse JSON question data (Vocabulary Bank and newer API payloads)
function parseJSON(data) {
    const tangoData = parseTangoData(data);
    if (tangoData) return tangoData;

    const questionItems = findQuestionItems(data);
    if (!questionItems.length) return null;

    const questionsList = [];

    questionItems.forEach((q, index) => {
        const questionText = firstStringValue(q, [
            'keyword.en',
            'keyword.ja',
            'questionText',
            'question_text',
            'question',
            'prompt',
            'sentence',
            'body',
            'text',
            'title'
        ]);
        const answers = collectJSONAnswers(q);

        if (questionText || answers.length > 0) {
            questionsList.push({
                type: inferType(q.type || q.questionType || q.kind || q.format, ""),
                answers: answers,
                rawText: questionText,
                signature: makeSignature(questionText),
                displayOrder: index + 1,
                questionNo: String(q.no ?? q.id ?? ""),
                isAutoAdvance: Boolean(q.keyword)
            });
        }
    });

    return questionsList.length > 0 ? { questions: questionsList } : null;
}

// Process captured XHR data
async function processXHRData(url, responseText, senderId) {
    let parsed = null;
    let dataType = null;

    if (responseText.trim().startsWith('<')) {
        parsed = parseXML(responseText);
        dataType = 'xml';
    } else if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
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
