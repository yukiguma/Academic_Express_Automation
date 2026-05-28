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
    return new Promise(resolve => setTimeout(resolve, ms));
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
async function solveTyping(answers, scope) {
    let targets = Array.from(scope.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]')).filter(isVisible);

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

function keyboardInfoForChar(char) {
    const key = String(char);
    const upper = key.toUpperCase();
    const specialKeys = {
        ' ': { code: 'Space', keyCode: 32 },
        '.': { code: 'Period', keyCode: 190 },
        ',': { code: 'Comma', keyCode: 188 },
        '?': { code: 'Slash', keyCode: 191 },
        '!': { code: 'Digit1', keyCode: 49, shiftKey: true },
        "'": { code: 'Quote', keyCode: 222 },
        '"': { code: 'Quote', keyCode: 222, shiftKey: true },
        '-': { code: 'Minus', keyCode: 189 }
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
    const base = {
        bubbles: true,
        cancelable: true,
        charCode: 0,
        code: info.code,
        key: char,
        keyCode: info.keyCode,
        shiftKey: info.shiftKey,
        which: info.keyCode
    };

    target.dispatchEvent(new KeyboardEvent('keydown', base));
    target.dispatchEvent(new KeyboardEvent('keypress', {
        ...base,
        charCode: info.charCode
    }));
    target.dispatchEvent(new KeyboardEvent('keyup', base));
}

// Solver: Dictation player. This layout has no input element; it listens for
// document-level keyboard events and opens character boxes as keys arrive.
async function solveDictation(answers) {
    const answer = answers.join(' ').trim();
    if (!answer) return false;

    const startButton = findVisibleByText('button, [role="button"], span', 'スタート');
    if (startButton) {
        simulateClick(startButton);
        await sleep(250);
    }

    console.log(`Dictation Strategy: Typing ${answer.length} characters.`);
    for (const char of answer) {
        dispatchKeyboardChar(char, document);
        await sleep(5);
    }

    await sleep(500);
    return true;
}

// Solver: Sorting
async function solveSorting(answers, scope) {
    console.log("Starting sorting solver...");
    for (const token of answers) {
        const cleanToken = token.trim();
        let xpath = `//*[contains(@class, "Sorting") and contains(@class, "Word") and contains(text(), "${cleanToken}")]`;
        let btn = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        if (!btn) {
            xpath = `//*[contains(@class, "Sorting")]//*[contains(text(), "${cleanToken}")]`;
            btn = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        }

        if (btn) {
            console.log(`Clicking sorting word: ${cleanToken}`);
            simulateClick(btn);
        } else {
            console.warn(`Sorting button not found for token: "${cleanToken}"`);
        }
    }
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
async function solve(answers, type, scope) {
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
        return solveDictation(answers, scope);
    }
    if (normalizedType.includes('choice') || normalizedType.includes('true') || normalizedType.includes('select') || normalizedType.includes('quiz')) {
        return solveMultipleChoice(answers, scope);
    }
    if (normalizedType.includes('anaume') || normalizedType.includes('typing') || normalizedType.includes('cloze') || normalizedType.includes('fill')) {
        return solveTyping(answers, scope);
    }
    if (normalizedType.includes('scanning')) {
        return solveScanning(answers, scope);
    }
    if (normalizedType.includes('sort')) {
        return solveSorting(answers, scope);
    }

    console.warn("Unknown question type, trying generic strategies:", type);
    if (await solveTyping(answers, scope)) return;
    if (await solveDropdown(answers, scope)) return;
    if (await solveFillBlank(answers, scope)) return;
    return solveMultipleChoice(answers, scope);
}
