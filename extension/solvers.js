// Academic Express Auto Answer - Solvers
// Contains all question-solving strategies

// Shared utility functions
function simulateClick(element) {
    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(eventType => {
        const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window
        });
        element.dispatchEvent(event);
    });
}

function setNativeValue(element, value) {
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

function clickAppropriateElement(choice) {
    const btn = choice.querySelector('button, [role="button"], input[type="radio"], [class*="select"]');
    if (btn) {
        simulateClick(btn);
    } else {
        simulateClick(choice);
    }
}

// Solver: Matching
async function solveMatching(answers, scope, getWaitTime) {
    const blankSelector = 'span[class*="MatchingQuestionBuilder__insertionPosition"]';
    const optionSelector = '[class*="MatchingQuestionBuilder__baseChoice"]';
    await genericFillBlankStrategy(answers, blankSelector, optionSelector, scope, getWaitTime);
}

// Solver: Insertion
async function solveInsertion(answers, scope, getWaitTime) {
    const blankSelector = 'span[class*="InsertionQuestionBuilder__insertionPosition"]';
    const optionSelector = '[class*="InsertionQuestionBuilder__insertChoice"]';
    await genericFillBlankStrategy(answers, blankSelector, optionSelector, scope, getWaitTime);
}

// Generic fill-in-the-blank strategy
async function genericFillBlankStrategy(answers, blankSelector, optionSelector, scope, getWaitTime) {
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
        await new Promise(r => setTimeout(r, getWaitTime('CLICK_WAIT')));

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
        await new Promise(r => setTimeout(r, getWaitTime('OPTION_WAIT')));
    }
    return true;
}

// Solver: Multiple Choice
async function solveMultipleChoice(answers, scope, getWaitTime) {
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
                clickAppropriateElement(choice);
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
                    clickAppropriateElement(choice);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            console.warn(`Multiple Choice option not found in scope for: "${answer}"`);
        }

        await new Promise(r => setTimeout(r, getWaitTime('OPTION_WAIT') / 4));
        await new Promise(r => setTimeout(r, getWaitTime('SOLVE_INTERVAL')));
    }
}

// Solver: Typing / Fill-in
async function solveTyping(answers, scope, getWaitTime) {
    let targets = Array.from(scope.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]'));

    if (targets.length === 0) {
        console.log("No inputs found, searching for interactable gaps...");
        const gaps = scope.querySelectorAll('[class*="Position"], [class*="insertion"]');
        for (const gap of gaps) {
            simulateClick(gap);
            await new Promise(r => setTimeout(r, 300));
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
                setNativeValue(input, answer);
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

        await new Promise(r => setTimeout(r, getWaitTime('SOLVE_INTERVAL')));
    }
}

// Solver: Sorting
async function solveSorting(answers, scope, getWaitTime) {
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
            await new Promise(r => setTimeout(r, getWaitTime('CLICK_WAIT')));
        } else {
            console.warn(`Sorting button not found for token: "${cleanToken}"`);
        }
    }
}

// Solver: Scanning
async function solveScanning(answers, scope, getWaitTime, index = 0) {
    console.log(`Starting scanning solver for index ${index}...`);
    const sentenceSelector = '[class*="ReadingScanningQuestionSentence__sentence"]';



    // Search within scope first
    let sentences = Array.from(scope.querySelectorAll(sentenceSelector));

    // Try to find the corresponding passage box (sibling of question wrapper)
    if (sentences.length === 0) {
        // scope is typically inside .ReadingScanningQuestionBuilder__questionBox___...
        // which is inside .ReadingScanningCombinationQuestionView__combinationQuestion___...
        const questionWrapper = scope.closest('[class*="combinationQuestion"]');
        if (questionWrapper) {
            const passageWrapper = questionWrapper.nextElementSibling;
            if (passageWrapper && passageWrapper.className.includes('combinationMain')) {
                console.log("Found corresponding passage box.");
                sentences = Array.from(passageWrapper.querySelectorAll(sentenceSelector));
            }
        }
    }

    // Fallback to global search if still not found
    if (sentences.length === 0) {
        console.log("No sentences found in scope/passage, searching globally for visible sentences...");
        sentences = Array.from(document.querySelectorAll(sentenceSelector)).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0);
        });
    }

    for (const answer of answers) {
        const normalizedAns = answer.trim().toLowerCase();
        let found = false;

        for (const sentence of sentences) {
            const text = sentence.textContent.trim().toLowerCase();
            // Exact match first
            if (text === normalizedAns) {
                console.log("Found exact scanning match:", text.substring(0, 50));

                // Click Logic with Verification
                const isSelected = (el) => {
                    const cls = el.getAttribute('class') || "";
                    return cls.includes('isSelected');
                };

                // Initial check
                if (isSelected(sentence)) {
                    console.log("Verified: Sentence is ALREADY selected. Skipping click.");
                    found = true;
                    break;
                }

                let success = false;
                for (let attempt = 0; attempt < 2; attempt++) {
                    console.log(`Scanning Click attempt ${attempt + 1}...`);

                    simulateClick(sentence);

                    // Wait for UI update (extended for reliability)
                    await new Promise(r => setTimeout(r, 1200));

                    if (isSelected(sentence)) {
                        console.log("Verified: Sentence is selected.");
                        success = true;
                        break;
                    }
                }

                if (!success) console.warn("Failed to select sentence (or transition happened).");

                found = true;
                break;
            }
        }

        // Partial match fallback
        if (!found) {
            for (const sentence of sentences) {
                const text = sentence.textContent.trim().toLowerCase();
                if (text.includes(normalizedAns) || normalizedAns.includes(text)) {
                    console.log("Found partial scanning match:", text.substring(0, 50));

                    // Click Logic with Verification (Duplicated for partial match)
                    // Click Verification Logic (Duplicated)
                    const isSelected = (el) => {
                        const cls = el.getAttribute('class') || "";
                        // Only rely on class name as background color caused false positives
                        return cls.includes('isSelected');
                    };

                    if (isSelected(sentence)) {
                        console.log("Verified: Sentence is ALREADY selected. Skipping click.");
                        found = true;
                        break;
                    }

                    let success = false;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        console.log(`Scanning Click attempt ${attempt + 1}...`);
                        simulateClick(sentence);

                        await new Promise(r => setTimeout(r, 1200));

                        if (isSelected(sentence)) {
                            console.log("Verified: Sentence is selected.");
                            success = true;
                            break;
                        }
                    }

                    if (!success) console.warn("Failed to select sentence (or transition happened).");

                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            console.warn(`Scanning sentence not found for: "${answer.substring(0, 50)}..."`);
        }

        await new Promise(r => setTimeout(r, getWaitTime('OPTION_WAIT')));
    }
}

// Main solve dispatcher
const SOLVER_STRATEGIES = {
    'matching': solveMatching,
    'insertion': solveInsertion,
    'multiplechoice': solveMultipleChoice,
    'truefalse': solveMultipleChoice,
    'true_false': solveMultipleChoice,
    'anaumefilin': solveTyping,
    'typing': solveTyping,
    'clozetest': solveTyping,
    'scanning': solveScanning,
    'sorting': solveSorting
};

async function solve(answers, type, scope, getWaitTime, isRandom = false, index = 0) {
    if (!isRandom && (!answers || answers.length === 0)) {
        console.warn(`No answers for type ${type}`);
        return;
    }
    console.log(`Solving ${type} with answers:`, answers, `Index:`, index);

    const lowerType = type.toLowerCase();

    const strategy = SOLVER_STRATEGIES[lowerType];
    if (strategy) {
        await strategy(answers, scope, getWaitTime, index);
    } else {
        console.warn("Unknown question type:", type);
    }
}
