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


// Solver: Fill-in-the-blank (Matching / Insertion)
async function solveFillBlank(answers, scope) {
    const blankSelector = 'span[class*="MatchingQuestionBuilder__insertionPosition"], span[class*="InsertionQuestionBuilder__insertionPosition"]';
    const optionSelector = '[class*="MatchingQuestionBuilder__baseChoice"], [class*="InsertionQuestionBuilder__insertChoice"]';

    const blanks = scope.querySelectorAll(blankSelector);
    if (!blanks.length) {
        console.warn(`No blanks found in scope.`);
        return false;
    }

    for (let i = 0; i < blanks.length; i++) {
        if (i >= answers.length) break;

        const blank = blanks[i];
        const answer = answers[i];
        console.log(`Processing blank ${i + 1}, answer: ${answer}`);

        simulateClick(blank);

        const possibilities = document.querySelectorAll(optionSelector);
        let found = false;
        for (const p of possibilities) {
            const optText = p.textContent.trim().toLowerCase();
            const ansText = answer.trim().toLowerCase();
            if (optText === ansText || optText.includes(ansText) || ansText.includes(optText)) {
                simulateClick(p);
                found = true;
                console.log(`Clicked option for "${answer}"`);
                break;
            }
        }
        if (!found) console.warn(`Option not found for "${answer}"`);
    }
    return true;
}

// Solver: Multiple Choice
async function solveMultipleChoice(answers, scope) {
    const choiceSelector = '[class*="Choice"]:not([class*="choices"]), [class*="underLinePoint"], [class*="Option"]';

    for (const answer of answers) {
        let choices = Array.from(scope.querySelectorAll(choiceSelector));
        let found = false;

        const normalizedAns = answer.trim().toLowerCase();
        choices.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);

        // Phase 1: Exact Match
        for (const choice of choices) {
            const choiceText = (choice.textContent || "").trim().toLowerCase();
            if (choiceText === normalizedAns) {
                console.log("Found exact match choice:", choiceText);
                simulateClick(choice);
                found = true;
                break;
            }
        }

        // Phase 2: Partial Match
        if (!found) {
            for (const choice of choices) {
                const choiceText = (choice.textContent || "").trim().toLowerCase();
                if (choiceText.includes(normalizedAns)) {
                    console.log("Found partial match choice:", choiceText);
                    simulateClick(choice);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            console.warn(`Multiple Choice option not found in scope for: "${answer}"`);
        }
    }
}

// Solver: Typing / Fill-in
async function solveTyping(answers, scope) {
    let targets = Array.from(scope.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]'));

    if (targets.length === 0) {
        console.log("No inputs found, searching for interactable gaps...");
        const gaps = scope.querySelectorAll('[class*="Position"], [class*="insertion"]');
        for (const gap of gaps) {
            simulateClick(gap);
            const found = scope.querySelectorAll('input, [contenteditable="true"]');
            if (found.length > 0) {
                targets = Array.from(found);
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

    switch (type.toLowerCase()) {
        case 'matching':
        case 'insertion':
            return solveFillBlank(answers, scope);
        case 'multiplechoice':
        case 'truefalse':
        case 'true_false':
            return solveMultipleChoice(answers, scope);
        case 'anaumefilin':
        case 'typing':
        case 'clozetest':
            return solveTyping(answers, scope);
        case 'scanning':
            return solveScanning(answers, scope);
        case 'sorting':
            return solveSorting(answers, scope);
        default:
            console.warn("Unknown question type:", type);
    }
}
