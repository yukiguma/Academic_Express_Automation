// Academic Express Auto Answer - Solvers
// Contains all question-solving strategies

// Shared utility functions
function simulateClick(element) {
    // ボタン要素があればそちらをクリック
    const target = element.querySelector('button') || element;

    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(eventType => {
        const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window
        });
        target.dispatchEvent(event);
    });
}

function simulateType(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    if (!valueSetter) {
        element.value = value;
        return;
    }
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else {
        valueSetter.call(element, value);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function waitUntil(predicate, timeoutMs = 3000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(intervalMs);
    }
    return predicate();
}

function normalizeText(text) {
    return String(text || "")
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function findVisibleByText(selector, text) {
    const normalizedText = normalizeText(text);
    return Array.from(document.querySelectorAll(selector))
        .find(el => isVisible(el) && normalizeText(el.textContent) === normalizedText);
}

function isElementTopmost(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1));
    const y = rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1));
    const top = document.elementFromPoint(x, y);
    return top === element || element.contains(top);
}

function compactText(text) {
    return normalizeText(text).replace(/[^\p{L}\p{N}]/gu, '');
}

function hasApostrophe(text) {
    return /['\u2018\u2019\u02bc]/.test(String(text || ""));
}

function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || normalizeText(element.textContent).length > 0;
}

function associatedLabel(input, scope) {
    if (!input || !input.id) return null;
    try {
        const escapedId = window.CSS?.escape ? CSS.escape(input.id) : input.id.replace(/"/g, '\\"');
        return scope.querySelector(`label[for="${escapedId}"]`);
    } catch (e) {
        return null;
    }
}

function choiceTexts(element, scope) {
    const texts = [];
    const push = (value) => {
        const text = normalizeText(value);
        if (text && !texts.includes(text)) texts.push(text);
    };

    if (element.matches?.('input[type="radio"], input[type="checkbox"]')) {
        push(element.value);
        push(element.getAttribute('aria-label'));
        push(element.closest('label')?.textContent);
        push(associatedLabel(element, scope)?.textContent);
        return texts;
    }

    push(element.textContent);
    push(element.getAttribute?.('aria-label'));
    push(element.getAttribute?.('title'));
    push(element.getAttribute?.('alt'));
    push(element.getAttribute?.('data-value'));
    push(element.getAttribute?.('value'));

    const input = element.querySelector?.('input[type="radio"], input[type="checkbox"]');
    if (input) {
        push(input.value);
        push(input.getAttribute('aria-label'));
    }

    return texts;
}

function textMatches(candidate, answer, exact) {
    const normalizedCandidate = normalizeText(candidate);
    const normalizedAnswer = normalizeText(answer);

    if (!normalizedCandidate || !normalizedAnswer) return false;
    if (normalizedCandidate === normalizedAnswer) return true;
    if (exact) return false;
    if (normalizedCandidate.includes(normalizedAnswer)) return true;
    if (hasApostrophe(candidate) || hasApostrophe(answer)) return false;

    const compactCandidate = compactText(candidate);
    const compactAnswer = compactText(answer);
    return compactCandidate === compactAnswer || compactCandidate.includes(compactAnswer);
}

function collectChoiceCandidates(scope) {
    const selector = [
        'button',
        'label',
        '[role="button"]',
        '[role="radio"]',
        '[role="checkbox"]',
        'input[type="radio"]',
        'input[type="checkbox"]',
        '[class*="Choice"]:not([class*="choices"])',
        '[class*="choice"]:not([class*="choices"])',
        '[class*="Option"]',
        '[class*="option"]',
        '[class*="underLinePoint"]'
    ].join(', ');
    const candidates = new Set(scope.querySelectorAll(selector));

    scope.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
        const label = input.closest('label') || associatedLabel(input, scope);
        candidates.add(label || input);
    });

    return Array.from(candidates)
        .filter(el => isVisible(el) && choiceTexts(el, scope).length > 0)
        .sort((a, b) => a.textContent.length - b.textContent.length);
}

// Solver: Fill-in-the-blank (Matching / Insertion)
async function solveFillBlank(answers, scope) {
    const blankSelector = [
        'span[class*="MatchingQuestionBuilder__insertionPosition"]',
        'span[class*="InsertionQuestionBuilder__insertionPosition"]',
        '[class*="insertionPosition"]',
        '[class*="Blank"]',
        '[class*="blank"]',
        '[role="combobox"]'
    ].join(', ');
    const optionSelector = [
        '[class*="MatchingQuestionBuilder__baseChoice"]',
        '[class*="InsertionQuestionBuilder__insertChoice"]',
        '[class*="baseChoice"]',
        '[class*="insertChoice"]',
        '[role="option"]',
        'option'
    ].join(', ');

    const blanks = scope.querySelectorAll(blankSelector);
    if (!blanks.length) {
        console.warn(`No blanks found in scope.`);
        return false;
    }

    let filledAny = false;
    for (let i = 0; i < blanks.length; i++) {
        if (i >= answers.length) break;

        const blank = blanks[i];
        const answer = answers[i];
        console.log(`Processing blank ${i + 1}, answer: ${answer}`);

        simulateClick(blank);

        const possibilities = document.querySelectorAll(optionSelector);
        let found = false;
        for (const p of possibilities) {
            if (!isVisible(p)) continue;
            if (textMatches(p.textContent, answer, false)) {
                simulateClick(p);
                found = true;
                filledAny = true;
                console.log(`Clicked option for "${answer}"`);
                break;
            }
        }
        if (!found) console.warn(`Option not found for "${answer}"`);
    }
    return filledAny;
}

// Solver: Native select dropdowns
async function solveDropdown(answers, scope) {
    const selects = Array.from(scope.querySelectorAll('select')).filter(isVisible);
    if (!selects.length) return false;

    let selectedAny = false;
    for (let i = 0; i < Math.min(answers.length, selects.length); i++) {
        const select = selects[i];
        const answer = answers[i];
        const option = Array.from(select.options).find(opt => {
            return textMatches(opt.textContent, answer, true) ||
                textMatches(opt.value, answer, true) ||
                textMatches(opt.textContent, answer, false);
        });

        if (!option) {
            console.warn(`Dropdown option not found for: "${answer}"`);
            continue;
        }

        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        selectedAny = true;
    }

    return selectedAny;
}

// Solver: Multiple Choice
async function solveMultipleChoice(answers, scope) {
    if (await solveDropdown(answers, scope)) return true;

    let foundAny = false;
    for (const answer of answers) {
        let choices = collectChoiceCandidates(scope);
        let found = false;

        // Phase 1: Exact Match
        for (const choice of choices) {
            if (choiceTexts(choice, scope).some(text => textMatches(text, answer, true))) {
                console.log("Found exact match choice:", answer);
                simulateClick(choice);
                found = true;
                foundAny = true;
                break;
            }
        }

        // Phase 2: Partial Match
        if (!found) {
            for (const choice of choices) {
                if (choiceTexts(choice, scope).some(text => textMatches(text, answer, false))) {
                    console.log("Found partial match choice:", answer);
                    simulateClick(choice);
                    found = true;
                    foundAny = true;
                    break;
                }
            }
        }

        if (!found) {
            console.warn(`Multiple Choice option not found in scope for: "${answer}"`);
        }
    }

    return foundAny;
}

// Solver: Typing / Fill-in
async function solveTyping(answers, scope, question = {}) {
    let targets = Array.from(scope.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]')).filter(isVisible);

    if (targets.length === 0 && await solveFontBoxTyping(answers, scope, question)) {
        return true;
    }

    if (targets.length === 0) {
        console.log("No inputs found, searching for interactable gaps...");
        const gaps = scope.querySelectorAll('[class*="Position"], [class*="insertion"]');
        for (const gap of gaps) {
            simulateClick(gap);
            const found = scope.querySelectorAll('input, [contenteditable="true"]');
            if (found.length > 0) {
                targets = Array.from(found).filter(isVisible);
                break;
            }
        }
    }

    console.log(`Typing Strategy: Found ${targets.length} targets for ${answers.length} answers.`);

    for (let i = 0; i < Math.min(answers.length, targets.length); i++) {
        const input = targets[i];
        const answer = answers[i];

        console.log(`Typing "${answer}" into:`, input);

        input.focus();

        if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
            try {
                simulateType(input, answer);
            } catch (e) {
                input.value = answer;
            }
        } else {
            input.textContent = answer;
        }

        const eventNames = ['input', 'change', 'keydown', 'keypress', 'keyup'];
        eventNames.forEach(evt => {
            input.dispatchEvent(new Event(evt, { bubbles: true }));
        });

        input.blur();
    }

    return targets.length > 0;
}

function compactAnswerChars(text) {
    return String(text || "").replace(/[^\p{L}\p{N}]/gu, '');
}

function answerLetterSpans(text) {
    const spans = [];
    let offset = 0;

    for (const char of String(text || "")) {
        const start = offset;
        offset += char.length;
        if (/[\p{L}\p{N}]/u.test(char)) {
            spans.push({ char, start, end: offset });
        }
    }

    return spans;
}

function extractBracketText(text) {
    const matches = Array.from(String(text || "").matchAll(/\[([^\]]+)\]/g));
    return matches.map(match => match[1].trim()).filter(Boolean).join(' ');
}

function fontBoxInputText(text) {
    return Array.from(String(text || ""))
        .filter(char => /[\p{L}\p{N}\p{P}\p{S}]|\s/u.test(char))
        .join('')
        .replace(/\s+/g, ' ');
}

function restoreFontBoxInputSpacing(answer, rawText) {
    const compactRaw = compactAnswerChars(rawText);
    const spans = answerLetterSpans(answer);
    const compactAnswer = spans.map(span => span.char).join('');

    if (!compactRaw || !compactAnswer) {
        return fontBoxInputText(rawText);
    }

    const start = compactAnswer.toLowerCase().indexOf(compactRaw.toLowerCase());
    if (start === -1) {
        return fontBoxInputText(rawText);
    }

    const end = start + compactRaw.length - 1;
    const source = String(answer || "");
    const endIndex = end === spans.length - 1 ? source.length : spans[end].end;
    return fontBoxInputText(source.slice(spans[start].start, endIndex));
}

function inferMissingByHiddenBoxCount(answer, hiddenBoxCount) {
    if (!answer || hiddenBoxCount <= 0) return "";
    const tokens = String(answer).match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)?|[^\s]/gu) || [];

    for (let start = 0; start < tokens.length; start++) {
        let segment = "";
        for (let end = start; end < tokens.length; end++) {
            segment += (segment && /^[\p{L}\p{N}]/u.test(tokens[end]) ? " " : "") + tokens[end];
            const compactLength = compactAnswerChars(segment).length;
            if (compactLength === hiddenBoxCount) return segment;
            if (compactLength > hiddenBoxCount) break;
        }
    }

    return "";
}

function inferMissingFontBoxText(answer, boxes) {
    const visible = compactAnswerChars(boxes.map(box => box.textContent || "").join(''));
    const full = compactAnswerChars(answer);
    const visibleLower = visible.toLowerCase();
    const fullLower = full.toLowerCase();

    let prefix = 0;
    while (
        prefix < visibleLower.length &&
        prefix < fullLower.length &&
        visibleLower[prefix] === fullLower[prefix]
    ) {
        prefix++;
    }

    let suffix = 0;
    while (
        suffix < visibleLower.length - prefix &&
        suffix < fullLower.length - prefix &&
        visibleLower[visibleLower.length - 1 - suffix] === fullLower[fullLower.length - 1 - suffix]
    ) {
        suffix++;
    }

    return full.slice(prefix, full.length - suffix);
}

async function solveFontBoxTyping(answers, scope, question = {}) {
    let boxes = Array.from(scope.querySelectorAll('[class*="FontBox__fontBox"]')).filter(isVisible);
    if (!boxes.length && scope !== document) {
        boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]')).filter(isVisible);
    }
    if (!boxes.length) return false;

    const hasHiddenEmptyBoxes = boxes.some(box => {
        const className = String(box.className || "");
        return className.includes('FontBox__hide') && !String(box.textContent || "").trim();
    });
    const hiddenEmptyBoxCount = boxes.filter(box => {
        const className = String(box.className || "");
        return className.includes('FontBox__hide') && !String(box.textContent || "").trim();
    }).length;
    const rawChars = hasHiddenEmptyBoxes
        ? extractBracketText(question.rawText) ||
            inferMissingFontBoxText(answers?.[0], boxes) ||
            inferMissingByHiddenBoxCount(answers?.[0], hiddenEmptyBoxCount)
        : boxes
            .filter(box => !String(box.className || "").includes('fontBox_ok'))
            .map(box => {
                const label = box.querySelector('[class*="FontBox__label_txt"]');
                return String(label?.textContent || box.textContent || "").trim().slice(0, 1);
            })
            .join('');
    const chars = restoreFontBoxInputSpacing(answers?.[0], rawChars);

    if (!chars) return false;

    console.log(`FontBox Typing Strategy: Typing ${chars.length} remaining characters.`);
    for (const char of chars) {
        const before = fontBoxSnapshot();
        dispatchKeyboardChar(char, document);
        if (char === ' ') {
            await waitForFontBoxUpdate(before, 350);
        } else {
            await waitForFontBoxUpdate(before);
        }
    }

    await sleep(250);
    return true;
}

function fontBoxSnapshot() {
    return Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'))
        .filter(isVisible)
        .map(box => `${box.className}:${box.textContent}`)
        .join('|');
}

async function waitForFontBoxUpdate(previousSnapshot, timeoutMs = 250) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await sleep(10);
        if (fontBoxSnapshot() !== previousSnapshot) {
            await sleep(15);
            return;
        }
    }

    await sleep(50);
}

function keyboardInfoForChar(char) {
    const key = String(char);
    const upper = key.toUpperCase();
    const specialKeys = {
        ' ': { code: 'Space', keyCode: 32 },
        '.': { code: 'Period', keyCode: 190 },
        ',': { code: 'Comma', keyCode: 188 },
        '?': { code: 'Slash', keyCode: 191, shiftKey: true },
        '!': { code: 'Digit1', keyCode: 49, shiftKey: true },
        "'": { code: 'Quote', keyCode: 222 },
        '"': { code: 'Quote', keyCode: 222, shiftKey: true },
        '-': { code: 'Minus', keyCode: 189 },
        ';': { code: 'Semicolon', keyCode: 186 },
        ':': { code: 'Semicolon', keyCode: 186, shiftKey: true }
    };

    if (specialKeys[key]) {
        return {
            charCode: key.charCodeAt(0),
            code: specialKeys[key].code,
            keyCode: specialKeys[key].keyCode,
            shiftKey: Boolean(specialKeys[key].shiftKey)
        };
    }

    if (/^[a-z]$/i.test(key)) {
        return {
            charCode: key.charCodeAt(0),
            code: `Key${upper}`,
            keyCode: upper.charCodeAt(0),
            shiftKey: key !== key.toLowerCase()
        };
    }

    if (/^[0-9]$/.test(key)) {
        return {
            charCode: key.charCodeAt(0),
            code: `Digit${key}`,
            keyCode: key.charCodeAt(0),
            shiftKey: false
        };
    }

    return {
        charCode: key.charCodeAt(0),
        code: '',
        keyCode: key.charCodeAt(0),
        shiftKey: false
    };
}

function dispatchKeyboardChar(char, target = document) {
    const info = keyboardInfoForChar(char);
    const physicalKeyEvent = {
        bubbles: true,
        cancelable: true,
        charCode: 0,
        code: info.code,
        key: char,
        keyCode: info.keyCode,
        shiftKey: info.shiftKey,
        which: info.keyCode
    };

    target.dispatchEvent(new KeyboardEvent('keydown', physicalKeyEvent));
    target.dispatchEvent(new KeyboardEvent('keypress', {
        ...physicalKeyEvent,
        charCode: info.charCode,
        keyCode: info.charCode,
        which: info.charCode
    }));
    target.dispatchEvent(new KeyboardEvent('keyup', physicalKeyEvent));
}

// Solver: Dictation player. This layout has no input element; it listens for
// document-level keyboard events and opens character boxes as keys arrive.
async function dismissDictationStartModal() {
    const startButton = findVisibleByText('button, [role="button"], span', 'スタート');
    if (!startButton) return;

    const button = startButton.closest('button') || startButton;
    const lockOverlay = document.getElementById('global-lock');
    const previousDisplay = lockOverlay?.style.display;
    const previousPointerEvents = lockOverlay?.style.pointerEvents;

    if (lockOverlay) {
        lockOverlay.style.display = 'none';
        lockOverlay.style.pointerEvents = 'none';
    }

    simulateClick(button);

    await waitUntil(
        () => !findVisibleByText('button, [role="button"], span', 'スタート'),
        3000,
        50
    );

    if (lockOverlay) {
        lockOverlay.style.display = previousDisplay;
        lockOverlay.style.pointerEvents = previousPointerEvents;
    }

    await sleep(300);
}

async function solveDictation(answers, scope, question = {}) {
    const answer = answers.join(' ').trim();
    if (!answer) return false;

    await dismissDictationStartModal();

    const chars = dictationInputChars(answer);
    if (!await waitForDictationQuestionReady(chars, question)) {
        return false;
    }
    console.log(`Dictation Strategy: Typing ${chars.length} characters.`);
    for (const char of chars) {
        const before = dictationInputSnapshot();
        dispatchKeyboardChar(char, document);
        if (!await waitForDictationInputAccepted(before)) {
            console.warn(`Dictation Strategy: Key "${char}" was not accepted; deferring typing.`);
            return false;
        }
        await sleep(30);
    }

    await sleep(500);
    return true;
}

function dictationInputChars(answer) {
    return Array.from(String(answer || "").replace(/\u2019/g, "'"))
        .filter(char => /\p{L}/u.test(char));
}

async function waitForDictationQuestionReady(expectedChars, question = {}) {
    const expected = expectedChars.join('').toLowerCase();
    const questionTextChars = dictationInputChars(question.rawText || "").join('').toLowerCase();
    if (!expected) return true;

    const ready = await waitUntil(() => {
        const visibleChars = visibleDictationInputChars().toLowerCase();
        if (visibleChars.includes(expected)) return true;
        if (visibleChars && expected.startsWith(visibleChars)) return true;
        if (visibleChars && questionTextChars.startsWith(visibleChars)) return true;
        if (visibleChars.length < expected.length && hasHiddenDictationBoxes()) return true;

        // Some Dictation layouts render blank boxes before typing, so there is
        // no current-answer text to compare against. In that case readiness has
        // to be delegated to the player listener rather than blocked forever.
        const minimumComparableLength = Math.min(6, expected.length);
        return visibleChars.length < minimumComparableLength;
    }, 5000, 50);

    if (!ready) {
        console.warn("Dictation Strategy: Current question text is not ready; deferring typing.");
    }
    return ready;
}

function visibleDictationInputChars() {
    const roots = Array.from(document.querySelectorAll([
        '[class*="dictationArea"]',
        '[class*="dictationBox"]',
        '[class*="DictationBox"]',
        '[class*="FontBox__root"]'
    ].join(','))).filter(isVisible);
    const text = (roots.length ? roots : [document.body])
        .map(root => root?.innerText || root?.textContent || "")
        .join(' ');
    return dictationInputChars(text).join('');
}

function hasHiddenDictationBoxes() {
    return Array.from(document.querySelectorAll('[class*="FontBox__hide"]'))
        .some(isVisible);
}

function dictationInputSnapshot() {
    const hiddenCount = Array.from(document.querySelectorAll('[class*="FontBox__hide"]'))
        .filter(isVisible)
        .length;
    return `${visibleDictationInputChars()}|hidden:${hiddenCount}`;
}

async function waitForDictationInputAccepted(previousSnapshot) {
    return waitUntil(() => dictationInputSnapshot() !== previousSnapshot, 800, 20);
}

// Solver: Sorting
async function solveSorting(answers, scope) {
    console.log("Starting sorting solver...");
    const tokens = answers.flatMap(answer => {
        return String(answer || "").split('/').map(token => token.trim()).filter(Boolean);
    });
    const roots = sortingTokenSearchRoots(scope);

    let clickedAny = false;
    for (const token of tokens) {
        const cleanToken = token.trim();
        let btn = null;

        for (let attempt = 0; attempt < 8 && !btn; attempt++) {
            for (const root of roots) {
                btn = findSortingToken(cleanToken, root);
                if (btn) break;
            }
            if (!btn) await sleep(100);
        }

        if (btn) {
            console.log(`Clicking sorting word: ${cleanToken}`);
            simulateClick(btn);
            clickedAny = true;
            await sleep(100);
        } else {
            console.warn(`Sorting button not found for token: "${cleanToken}"`);
        }
    }

    const expectedAnswer = compactText(tokens.join(''));
    const currentPageText = compactText(document.body?.innerText || document.body?.textContent || "");
    return clickedAny && expectedAnswer && currentPageText.includes(expectedAnswer);
}

function sortingTokenSearchRoots(scope) {
    if (!scope?.querySelectorAll || scope === document) return [document];
    if (scope.querySelector('[class*="sortStringList"]')) return [scope];

    const visibleLists = Array.from(document.querySelectorAll('[class*="sortStringList"]')).filter(isVisible);
    return visibleLists.length === 1 ? [scope, visibleLists[0]] : [scope];
}

function findSortingToken(token, root) {
    if (!root?.querySelectorAll) return null;
    if (root !== document && root.isConnected === false) return null;
    const normalizedToken = normalizeText(token);
    const candidates = Array.from(root.querySelectorAll([
        '[class*="sortStringList"] li',
        '[class*="Sorting"] li',
        '[class*="sortingWord"]',
        '[class*="Sorting"][role="button"]',
        '[class*="Sorting"] button'
    ].join(', '))).filter(isVisible);

    return candidates.find(candidate => normalizeText(candidate.textContent) === normalizedToken) || null;
}

// Solver: Scanning
async function solveScanning(answers, scope) {
    console.log("Starting scanning solver...");
    const sentenceSelector = '[class*="ReadingScanningQuestionSentence__sentence"]';

    // scope内のsentence要素を取得
    const sentences = Array.from(scope.querySelectorAll(sentenceSelector));

    if (sentences.length === 0) {
        console.warn("No sentences found in scope.");
        return;
    }

    const isSelected = (el) => (el.getAttribute('class') || "").includes('isSelected');

    for (const answer of answers) {
        const normalizedAns = answer.trim().toLowerCase();
        let found = false;

        // Phase 1: Exact match
        for (const sentence of sentences) {
            const text = sentence.textContent.trim().toLowerCase();
            if (text === normalizedAns) {
                console.log("Found exact scanning match:", text.substring(0, 50));
                if (!isSelected(sentence)) simulateClick(sentence);
                found = true;
                break;
            }
        }

        // Phase 2: Partial match
        if (!found) {
            for (const sentence of sentences) {
                const text = sentence.textContent.trim().toLowerCase();
                if (text.includes(normalizedAns) || normalizedAns.includes(text)) {
                    console.log("Found partial scanning match:", text.substring(0, 50));
                    if (!isSelected(sentence)) simulateClick(sentence);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            console.warn(`Scanning sentence not found for: "${answer.substring(0, 50)}..."`);
        }
    }
}

// Main solve dispatcher
async function solve(answers, type, scope, question = {}) {
    if (!answers || answers.length === 0) {
        console.warn(`No answers for type ${type}`);
        return;
    }
    console.log(`Solving ${type} with answers:`, answers);

    const normalizedType = String(type || "").toLowerCase();

    if (normalizedType === 'matching' || normalizedType === 'insertion') {
        return solveFillBlank(answers, scope);
    }
    if (normalizedType.includes('dictation') || normalizedType.includes('dectation')) {
        return solveDictation(answers, scope, question);
    }
    if (normalizedType.includes('choice') || normalizedType.includes('true') || normalizedType.includes('select') || normalizedType.includes('quiz')) {
        return solveMultipleChoice(answers, scope);
    }
    if (normalizedType.includes('anaume') || normalizedType.includes('typing') || normalizedType.includes('cloze') || normalizedType.includes('fill')) {
        return solveTyping(answers, scope, question);
    }
    if (normalizedType.includes('scanning')) {
        return solveScanning(answers, scope);
    }
    if (normalizedType.includes('sort')) {
        return solveSorting(answers, scope);
    }

    console.warn("Unknown question type, trying generic strategies:", type);
    if (await solveTyping(answers, scope, question)) return;
    if (await solveDropdown(answers, scope)) return;
    if (await solveFillBlank(answers, scope)) return;
    return solveMultipleChoice(answers, scope);
}
