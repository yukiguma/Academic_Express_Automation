// Academic Express Auto Answer - Content Script
// Handles UI injection and DOM manipulation for auto-answering

(function () {
    'use strict';
    console.log("Academic Express Auto Answer Content Script Loaded");

    // Global state
    let questionsList = [];
    let currentButtonState = null;
    let isAutoMode = false;
    let isFastMode = localStorage.getItem('fast-mode') === 'true';
    let lastSolvedSignature = "";
    let isSolving = false;
    let debounceTimer = null;

    // Speed configuration (ms)
    const SPEED_CONFIG = {
        slowmode: {
            READING_MIN: 5000,
            READING_MAX: 40000,
            WORD_WAIT: 300,
            TRANSITION_WAIT: 1000,
            CLICK_WAIT: 800,
            OPTION_WAIT: 1000,
            SOLVE_INTERVAL: 2000,
            DEBOUNCE_WAIT: 300
        },
        fastmode: {
            READING_MIN: 0,
            READING_MAX: 0,
            WORD_WAIT: 0,
            TRANSITION_WAIT: 100,
            CLICK_WAIT: 0,
            OPTION_WAIT: 0,
            SOLVE_INTERVAL: 0,
            DEBOUNCE_WAIT: 0
        }
    };

    function getWaitTime(type, context = null) {
        const mode = isFastMode ? 'fastmode' : 'slowmode';
        const config = SPEED_CONFIG[mode];
        let base = config[type] || 0;

        if (mode === 'slowmode') {
            if (type === 'READING_WAIT' && typeof context === 'string') {
                const words = context.trim().split(/\s+/).filter(Boolean).length;
                base = Math.min(Math.max(words * config.WORD_WAIT, config.READING_MIN), config.READING_MAX);
            }
            const jitter = (Math.random() * 0.4) + 0.8;
            return Math.floor(base * jitter);
        }
        return base;
    }


    // Listen for captured XHR data from injected script
    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        if (event.data.type !== 'ACADEMIC_EXPRESS_XHR_CAPTURED') return;

        const { url, responseText } = event.data;

        // Send to background for parsing and storage
        try {
            await chrome.runtime.sendMessage({
                type: 'XHR_CAPTURED',
                url: url,
                responseText: responseText
            });
            // Reload question data after background processes it
            setTimeout(() => loadQuestionData(), 100);
        } catch (e) {
            // Failed to send captured data
        }
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'QUESTION_DATA_READY') {
            loadQuestionData();
        }
    });

    // Load question data from storage via message passing
    async function loadQuestionData() {
        try {
            const result = await chrome.runtime.sendMessage({ type: 'GET_QUESTION_DATA' });
            if (result && result.questionData && result.questionData.questions) {
                questionsList = result.questionData.questions;
                updateUIStates();
            }
        } catch (e) {
            // Failed to load question data
        }
    }

    // Initial load attempt
    loadQuestionData();

    // Time Estimation Logic
    function getEstimatedTime(pairs, isFast, forceNew = null) {
        const mode = isFast ? 'fastmode' : 'slowmode';
        const config = SPEED_CONFIG[mode];
        let total = 0;

        const compositeSig = pairs.map(p => p.data.signature).join('|');
        const isNew = (forceNew !== null) ? forceNew : (compositeSig !== lastSolvedSignature);

        if (!isFast && isNew) {
            const totalText = pairs.map(p => p.data.rawText || "").join(" ");
            const words = totalText.trim().split(/\s+/).filter(Boolean).length;
            total += Math.min(Math.max(words * config.WORD_WAIT, config.READING_MIN), config.READING_MAX);
        }

        pairs.forEach(pair => {
            const { answers, type } = pair.data;
            const lowerType = type ? type.toLowerCase() : "";

            if (lowerType === 'matching' || lowerType === 'insertion' || lowerType.includes('sorting')) {
                total += answers.length * (config.CLICK_WAIT + config.OPTION_WAIT);
            } else if (lowerType === 'multiplechoice' || lowerType === 'truefalse') {
                total += answers.length * (config.SOLVE_INTERVAL + (config.OPTION_WAIT / 4));
            } else if (lowerType === 'anaumefilin' || lowerType === 'typing' || lowerType === 'clozetest' || lowerType.includes('fillin')) {
                total += answers.length * config.SOLVE_INTERVAL;
            } else {
                total += answers.length * config.SOLVE_INTERVAL;
            }
        });

        total += config.TRANSITION_WAIT;
        return Math.ceil(total / 1000);
    }

    // Header Progress Bar Logic
    function setHeaderProgress(percentage) {
        const container = document.querySelector('[class*="AppHeader__fixed-top"] > div');
        const outer = document.querySelector('[class*="AppHeader__fixed-top"]');
        if (!container && !outer) return;

        const target = container || outer;

        if (percentage === 0) {
            target.style.backgroundImage = 'none';
            return;
        }

        const gradient = `linear-gradient(to right, #007991 ${percentage}%, transparent ${percentage}%)`;
        target.style.setProperty('background-image', gradient);
    }

    let progressInterval = null;
    function startHeaderAnimation(seconds) {
        clearInterval(progressInterval);
        const startTime = Date.now();
        const duration = seconds * 1000;

        setHeaderProgress(0);

        progressInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min((elapsed / duration) * 100, 100);
            setHeaderProgress(progress);

            if (progress >= 100) {
                clearInterval(progressInterval);
            }
        }, 100);
    }

    function resetHeaderProgress() {
        clearInterval(progressInterval);
        setHeaderProgress(0);
    }

    // Global Lock Element
    const lockOverlay = document.createElement('div');
    lockOverlay.id = 'global-lock';
    lockOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:99999; display:none; cursor:wait; pointer-events:auto; background:rgba(0,0,0,0);';
    document.documentElement.appendChild(lockOverlay);

    function setGlobalLock(active) {
        lockOverlay.style.display = active ? 'block' : 'none';
        const container = document.getElementById('controls-container');
        if (container) {
            container.style.position = 'relative';
            container.style.zIndex = active ? '100000' : '';
        }
    }

    // Robust Observer Callback with Debounce
    const observerCallback = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            ensureSolveButton();
        }, getWaitTime('DEBOUNCE_WAIT'));
    };

    const observer = new MutationObserver(observerCallback);

    function startObserving() {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            const bodyObserver = new MutationObserver((mutations, obs) => {
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true });
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
    }
    startObserving();

    function findActiveQuestions() {
        const textElements = document.querySelectorAll('[class*="QuestionBuilder__question___"], [class*="QuestionView__question___"]');
        const visibleElements = Array.from(textElements).filter(el => {
            const style = window.getComputedStyle(el);
            return style.visibility !== 'hidden' && style.display !== 'none' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.textContent.trim().length > 0);
        });

        const matchedPairs = [];
        const usedIndices = new Set();
        const usedElements = new Set();

        // Phase 1: Exact Signature Match
        for (const el of visibleElements) {
            const domSig = el.textContent.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
            const idx = questionsList.findIndex((q, i) => !usedIndices.has(i) && q.signature === domSig);

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = el.closest('[class*="QuestionBuilder__questionBox___"], [class*="QuestionView__questionBox___"]') || el;
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        // Phase 2: Partial Match
        for (const el of visibleElements) {
            if (usedElements.has(el)) continue;

            const domSig = el.textContent.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
            const idx = questionsList.findIndex((q, i) => {
                if (usedIndices.has(i)) return false;
                return domSig.includes(q.signature) || q.signature.includes(domSig);
            });

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = el.closest('[class*="QuestionBuilder__questionBox___"], [class*="QuestionView__questionBox___"]') || el;
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        // Phase 3: Fuzzy Match
        for (const el of visibleElements) {
            if (usedElements.has(el)) continue;

            const domSig = el.textContent.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
            const idx = questionsList.findIndex((q, i) => {
                if (usedIndices.has(i)) return false;
                const cleanXml = q.signature.slice(0, 20);
                return domSig.includes(cleanXml);
            });

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = el.closest('[class*="QuestionBuilder__questionBox___"], [class*="QuestionView__questionBox___"]') || el;
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        return matchedPairs;
    }

    function injectStyles() {
        const styleId = 'toggle-style';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .segmented-control {
                display: flex;
                background-color: #f0f0f0;
                padding: 2px;
                border-radius: 4px;
                border: 1px solid #ccc;
                overflow: hidden;
            }
            .segment {
                padding: 4px 12px;
                font-size: 11px;
                font-weight: bold;
                color: #666;
                cursor: pointer;
                border-radius: 2px;
                transition: all 0.2s;
                text-align: center;
                user-select: none;
                font-family: inherit;
            }
            .segment.active {
                background-color: #fff;
                color: #ff0000;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .segment:hover:not(.active) {
                background-color: #e8e8e8;
            }
        `;
        document.head.appendChild(style);
    }

    function createControls(header) {
        if (document.getElementById('solve-btn')) return;

        injectStyles();

        let parentContainer;
        const backButtonDiv = Array.from(header.querySelectorAll('div')).find(el => el.textContent.includes("戻る") || el.className.toLowerCase().includes("back"));

        if (backButtonDiv) {
            parentContainer = backButtonDiv;
            parentContainer.style.display = 'flex';
            parentContainer.style.alignItems = 'center';
            parentContainer.style.gap = '20px';
        } else {
            parentContainer = document.createElement('div');
            parentContainer.id = 'controls-container';
            parentContainer.style.display = 'flex';
            parentContainer.style.alignItems = 'center';
            parentContainer.style.gap = '16px';
            parentContainer.style.marginLeft = '8px';
            parentContainer.style.marginRight = '8px';
            header.appendChild(parentContainer);
        }

        const control = document.createElement('div');
        control.id = 'speed-control';
        control.className = 'segmented-control';

        const slowSeg = document.createElement('div');
        slowSeg.id = 'slow-seg';
        slowSeg.className = 'segment' + (!isFastMode ? ' active' : '');
        slowSeg.textContent = "低速";
        slowSeg.onclick = (e) => {
            e.stopPropagation();
            if (isAutoMode || isSolving) return;
            isFastMode = false;
            localStorage.setItem('fast-mode', isFastMode);
            updateUIStates();
        };

        const fastSeg = document.createElement('div');
        fastSeg.id = 'fast-seg';
        fastSeg.className = 'segment' + (isFastMode ? ' active' : '');
        fastSeg.textContent = "高速";
        fastSeg.onclick = (e) => {
            e.stopPropagation();
            if (isAutoMode || isSolving) return;
            isFastMode = true;
            localStorage.setItem('fast-mode', isFastMode);
            updateUIStates();
        };

        control.appendChild(slowSeg);
        control.appendChild(fastSeg);

        const solveBtn = document.createElement('button');
        solveBtn.id = 'solve-btn';
        solveBtn.style.height = '36px';
        solveBtn.style.padding = '0 16px';
        solveBtn.style.backgroundColor = '#ff0000';
        solveBtn.style.color = 'white';
        solveBtn.style.border = 'none';
        solveBtn.style.borderRadius = '2px';
        solveBtn.style.fontSize = '14px';
        solveBtn.style.fontFamily = 'inherit';
        solveBtn.style.cursor = 'pointer';
        solveBtn.style.boxShadow = '0 1px 6px rgba(0,0,0,0.12)';
        solveBtn.style.transition = 'all 0.2s';

        parentContainer.appendChild(solveBtn);
        parentContainer.appendChild(control);

        return parentContainer;
    }

    function updateUIStates() {
        const btn = document.getElementById('solve-btn');
        const control = document.getElementById('speed-control');
        const slowSeg = document.getElementById('slow-seg');
        const fastSeg = document.getElementById('fast-seg');
        if (!btn || !control) return;

        control.style.display = (isAutoMode || isSolving) ? 'none' : 'flex';

        if (slowSeg) slowSeg.className = 'segment' + (!isFastMode ? ' active' : '');
        if (fastSeg) fastSeg.className = 'segment' + (isFastMode ? ' active' : '');

        if (isSolving) {
            btn.textContent = "処理中...";
            btn.style.backgroundColor = '#666';
            btn.onclick = null;
            btn.style.cursor = 'wait';
            return;
        }

        const activePairs = findActiveQuestions();

        if (!activePairs || activePairs.length === 0) {
            btn.textContent = "検索中...";
            btn.style.backgroundColor = '#999';
            btn.onclick = null;
            btn.style.cursor = 'default';
            return;
        }

        const compositeSig = activePairs.map(p => p.data.signature).join('|');
        const isNewQuestion = compositeSig !== lastSolvedSignature;
        const estimatedSeconds = getEstimatedTime(activePairs, isFastMode, isNewQuestion);

        btn.textContent = isFastMode ? "自動入力" : `自動入力 (~${estimatedSeconds}秒)`;
        btn.style.backgroundColor = '#ff0000';
        btn.style.cursor = 'pointer';

        btn.onclick = () => {
            isAutoMode = true;
            lastSolvedSignature = compositeSig;
            runSolver(activePairs, isNewQuestion);
        };

        if (isAutoMode && isNewQuestion) {
            console.log("Auto-Mode: New questions detected. Triggering solver.");
            lastSolvedSignature = compositeSig;
            runSolver(activePairs, isNewQuestion);
        }
    }

    function ensureSolveButton() {
        const finishLink = document.querySelector('a.btn');
        if (finishLink) {
            const speedCtrl = document.getElementById('speed-control');
            const solveBtn = document.getElementById('solve-btn');
            if (speedCtrl) speedCtrl.style.display = 'none';
            if (solveBtn) solveBtn.style.display = 'none';

            if (isAutoMode) {
                console.log("Generic Finish Page detected. Clicking .btn link.");
                finishLink.click();
                isAutoMode = false;
            }
            return;
        }

        const isGradedPage = document.querySelector('[class*="ScoreView__scoreViewContainer"]');
        if (isGradedPage) {
            const speedCtrl = document.getElementById('speed-control');
            const solveBtn = document.getElementById('solve-btn');
            if (speedCtrl) speedCtrl.style.display = 'none';
            if (solveBtn) solveBtn.style.display = 'none';
            if (isAutoMode && !isSolving) {
                console.log("Graded page detected. Triggering final transition.");
                handleTransition();
            }
            return;
        }

        const header = document.querySelector('[class*="AppHeader__fixed-top"] > div');
        if (!header) return;

        createControls(header);
        updateUIStates();
    }

    async function solve(answers, type, scope = document, isRandom = false) {
        if (!isRandom && (!answers || answers.length === 0)) {
            console.warn(`No answers for type ${type}`);
            return;
        }
        console.log(`Solving ${type} with answers:`, answers, "Scope:", scope);

        const lowerType = type ? type.toLowerCase() : "";

        if (lowerType === 'matching') {
            await solveMatching(answers, scope);
        } else if (lowerType === 'insertion') {
            await solveInsertion(answers, scope);
        } else if (lowerType === 'multiplechoice' || lowerType === 'truefalse' || lowerType === 'true_false') {
            await solveMultipleChoice(answers, scope);
        } else if (lowerType === 'anaumefilin' || lowerType === 'typing' || lowerType === 'clozetest' || lowerType.includes('fillin')) {
            await solveTyping(answers, scope);
        } else if (lowerType.includes('sorting')) {
            await solveSorting(answers, scope);
        } else {
            console.log("Unknown type:", type);
            if (answers.length > 0) {
                console.log("Attempting Multiple Choice fallback...");
                await solveMultipleChoice(answers, scope);
            }
        }
    }

    async function runSolver(matchedPairs, isNew) {
        if (isSolving) return;
        isSolving = true;

        try {
            console.log(`Running solver for ${matchedPairs.length} questions...`);

            const totalEstimatedSeconds = getEstimatedTime(matchedPairs, isFastMode, isNew);
            startHeaderAnimation(totalEstimatedSeconds);

            if (!isFastMode && isNew) {
                const totalText = matchedPairs.map(p => p.data.rawText || "").join(" ");
                const wait = getWaitTime('READING_WAIT', totalText);
                console.log(`Initial reading delay: ${wait}ms`);
                await new Promise(r => setTimeout(r, wait));
            }

            setGlobalLock(true);

            let autoAdvance = false;
            for (const pair of matchedPairs) {
                if (pair.data.isAutoAdvance) autoAdvance = true;
                await solve(pair.data.answers, pair.data.type, pair.element);
            }

            if (isAutoMode) {
                if (autoAdvance) {
                    console.log("Detecting auto-advance question, skipping manual transition click.");
                    isSolving = false;
                    resetHeaderProgress();
                    setGlobalLock(false);
                    return;
                }
                await handleTransition();
            }
        } finally {
            isSolving = false;
            setGlobalLock(false);
            resetHeaderProgress();
            updateUIStates();
        }
    }

    async function handleTransition() {
        const wasSolving = isSolving;
        isSolving = true;

        try {
            console.log("Attempting transition...");
            await new Promise(r => setTimeout(r, getWaitTime('TRANSITION_WAIT')));

            const nextBtn = document.getElementById('nextButton');

            if (nextBtn && !nextBtn.disabled) {
                console.log("Transition: Clicking Next Button.");
                simulateClick(nextBtn);
                return;
            }

            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                const text = b.textContent;
                if (text.includes("採点") || text.includes("続ける") || text.includes("判定")) {
                    console.log(`Transition: Clicking ${text.includes("採点") ? "Score" : text.includes("判定") ? "Judgment" : "Continue"} Button.`);
                    simulateClick(b);
                    return;
                }
            }

            const quitBtn = document.getElementById('quitButton');
            if (quitBtn) {
                console.log("Transition: Clicking Finish/Quit Button.");
                simulateClick(quitBtn);
                isAutoMode = false;
                return;
            }

            const link = document.querySelector('a.btn');
            if (link) {
                console.log("Transition: Clicking .btn Link (Finish).");
                link.click();
                isAutoMode = false;
                return;
            }

            console.log("Transition: No suitable button found.");
        } finally {
            if (!wasSolving) isSolving = false;
        }
    }

    async function solveMatching(answers, scope) {
        const blankSelector = 'span[class*="MatchingQuestionBuilder__insertionPosition"]';
        const optionSelector = '[class*="MatchingQuestionBuilder__baseChoice"]';
        await genericFillBlankStrategy(answers, blankSelector, optionSelector, scope);
    }

    async function solveInsertion(answers, scope) {
        const blankSelector = 'span[class*="InsertionQuestionBuilder__insertionPosition"]';
        const optionSelector = '[class*="InsertionQuestionBuilder__insertChoice"]';
        await genericFillBlankStrategy(answers, blankSelector, optionSelector, scope);
    }

    async function genericFillBlankStrategy(answers, blankSelector, optionSelector, scope) {
        const blanks = scope.querySelectorAll(blankSelector);
        if (!blanks.length) {
            console.warn(`No blanks found in scope.`);
            ensureSolveButton();
            return false;
        }

        for (let i = 0; i < blanks.length; i++) {
            if (i >= answers.length) break;

            const blank = blanks[i];
            const answer = answers[i];
            console.log(`Processing blank ${i + 1}, answer: ${answer}`);

            blank.click();
            await new Promise(r => setTimeout(r, getWaitTime('CLICK_WAIT')));

            const possibilities = document.querySelectorAll(optionSelector);
            let found = false;
            for (const p of possibilities) {
                const optText = p.textContent.trim().toLowerCase();
                const ansText = answer.trim().toLowerCase();
                if (optText === ansText || optText.includes(ansText) || ansText.includes(optText)) {
                    p.click();
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

    function clickAppropriateElement(choice) {
        const btn = choice.querySelector('button, [role="button"], input[type="radio"], [class*="select"]');
        if (btn) {
            simulateClick(btn);
        } else {
            simulateClick(choice);
        }
    }

    async function solveTyping(answers, scope) {
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

    async function solveSorting(answers) {
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
                btn.click();
                await new Promise(r => setTimeout(r, getWaitTime('CLICK_WAIT')));
            } else {
                console.warn(`Sorting button not found for token: "${cleanToken}"`);
            }
        }
    }

})();
