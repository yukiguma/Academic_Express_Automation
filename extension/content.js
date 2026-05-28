// Academic Express Auto Answer - Content Script
// Handles UI injection and DOM manipulation for auto-answering

(function () {
    'use strict';
    console.log("Academic Express Auto Answer Content Script Loaded");

    // Global state
    let questionsList = [];
    let currentButtonState = null;
    let isFastMode = localStorage.getItem('fast-mode') === 'true';
    let lastSolvedSignature = "";
    let isSolving = false;
    let isTransitioning = false;
    let debounceTimer = null;
    let isAutoMode = false;

    function isQuizPlayerPage() {
        return window.location.pathname.includes('/as/lplayer/');
    }

    function isStudentPage() {
        return window.location.pathname.includes('/student/');
    }

    function clearAutoModeStorage() {
        localStorage.removeItem('auto-mode');
        localStorage.removeItem('auto-mode-url');
    }

    try {
        const storedAuto = localStorage.getItem('auto-mode');
        const storedAutoUrl = localStorage.getItem('auto-mode-url');
        if (isStudentPage()) {
            clearAutoModeStorage();
        } else if (isQuizPlayerPage() && storedAuto === 'true' && storedAutoUrl === window.location.href) {
            isAutoMode = true;
        } else {
            // URL changed or not set -> Reset AutoMode
            clearAutoModeStorage();
        }
    } catch (e) { console.error("AutoMode Init Error", e); }

    function setAutoMode(value) {
        isAutoMode = value && isQuizPlayerPage();
        if (isAutoMode) {
            localStorage.setItem('auto-mode', 'true');
            localStorage.setItem('auto-mode-url', window.location.href);
        } else {
            clearAutoModeStorage();
        }
    }

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

    function getQuestionRunKey(question) {
        return [
            question.displayOrder || "",
            question.questionNo || "",
            question.signature || ""
        ].join(':');
    }

    function getCompositeRunKey(pairs) {
        return pairs.map(p => getQuestionRunKey(p.data)).join('|');
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

        const compositeSig = getCompositeRunKey(pairs);
        const isNew = (forceNew !== null) ? forceNew : (compositeSig !== lastSolvedSignature);

        // Skip reading time for vocabulary tests (isAutoAdvance) or fast mode
        const isVocabularyTest = pairs.some(p => p.data.isAutoAdvance);
        if (!isFast && isNew && !isVocabularyTest) {
            const totalText = pairs.map(p => p.data.rawText || "").join(" ");
            const words = totalText.trim().split(/\s+/).filter(Boolean).length;
            total += Math.min(Math.max(words * config.WORD_WAIT, config.READING_MIN), config.READING_MAX);
        }

        // Actual execution only waits SOLVE_INTERVAL per QUESTION (not per answer)
        // Solvers run nearly instantly, so answer count doesn't significantly add to duration
        total += pairs.length * config.SOLVE_INTERVAL;

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

        // Unlock Header for "Back" button access
        const header = document.querySelector('[class*="AppHeader__fixed-top"]');
        if (header) {
            header.style.zIndex = active ? '100000' : '';
        }

        const container = document.getElementById('controls-container');
        if (container) {
            container.style.position = 'relative';
            container.style.zIndex = active ? '100001' : '';
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

    function findQuestionContainer(el, type = "") {
        const lowerType = String(type || "").toLowerCase();
        if (lowerType.includes('dictation') || lowerType.includes('dectation')) {
            return document.querySelector([
                '[class*="AppPc__app_root"]',
                '[class*="AppSp__app_root"]',
                '[class*="dictationBox"]',
                '[class*="DictationBox"]'
            ].join(', ')) || document.body;
        }

        // Scanning問題: 質問テキストに対応するpassageBox（combinationMain）を探す
        // 他の問題タイプ（True/False等）が同一画面にある場合でも、これらは自身の領域を使うべきなので
        // typeがScanningの場合のみスコープを変更する
        if (lowerType === 'scanning') {
            const combinationQuestion = el.closest('[class*="CombinationQuestionView__combinationQuestion"]');
            if (combinationQuestion) {
                // 兄弟要素としてcombinationMainを探す
                const parent = combinationQuestion.parentElement;
                const combinationMain = parent?.querySelector('[class*="CombinationQuestionView__combinationMain"]');
                if (combinationMain) return combinationMain;
            }
        }

        // 通常の問題タイプ: questionBoxを検索
        const box = el.closest([
            '[class*="QuestionBuilder__questionBox___"]',
            '[class*="QuestionView__questionBox___"]',
            '[class*="Question"][class*="questionBox"]',
            '[class*="questionBox"]',
            '[class*="Quiz"]',
            '[class*="quiz"]',
            'form',
            'section',
            'article'
        ].join(', '));
        if (box) return box;

        // Fallback: クラスが見つからない場合、親要素（兄弟の選択肢を含む可能性がある）を返す
        // テキスト要素(el)の親、あるいはその親まで遡る
        if (el.parentElement && el.parentElement.parentElement) {
            return el.parentElement.parentElement;
        }
        return el.parentElement || el;
    }

    function normalizeSignature(text, limit = 40) {
        return String(text || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, '')
            .slice(0, limit);
    }

    function isVisibleElement(el) {
        if (!el || !el.isConnected) return false;
        const tagName = el.tagName;
        if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') return false;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;

        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
    }

    function matchesQuestionSignature(text, question) {
        const domSig = normalizeSignature(text, 120);
        const questionSig = question.signature || normalizeSignature(question.rawText);
        if (!domSig || !questionSig) return false;
        return domSig.includes(questionSig) ||
            questionSig.includes(domSig.slice(0, Math.min(20, domSig.length)));
    }

    function getCurrentProgressQuestionRange() {
        const text = [
            document.body?.innerText,
            document.body?.textContent
        ].filter(Boolean).join("\n");
        const rangeMatch = text.match(/(?:^|\s)(\d{1,3})\s*[-－ー]\s*(\d{1,3})\s*\/\s*(\d{1,3})(?:\s|$)/);
        const singleMatch = rangeMatch ? null : text.match(/(?:^|\s)(\d{1,3})\s*\/\s*(\d{1,3})(?:\s|$)/);
        const match = rangeMatch || singleMatch;
        if (!match) return null;

        const start = Number(match[1]);
        const end = rangeMatch ? Number(match[2]) : start;
        const total = Number(match[rangeMatch ? 3 : 2]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(total)) return null;
        if (start < 1 || end < start || total < end || total !== questionsList.length) return null;
        return { start, end, total };
    }

    function getVisibleQuestionNumber(el) {
        let current = el;

        for (let depth = 0; current && depth < 5; depth++) {
            const text = current.innerText || current.textContent || "";
            if (text.length <= 3000) {
                const match = text.match(/(?:^|\s)(\d{1,3})\s*[:：]/);
                if (match) {
                    const number = Number(match[1]);
                    if (Number.isInteger(number) && number >= 1 && number <= questionsList.length) {
                        return number;
                    }
                }
            }
            current = current.parentElement;
        }

        return null;
    }

    function getConfiguredQuestionNo() {
        return String(window.config?.question_no || "");
    }

    function isDictationLayoutVisible() {
        return Boolean(document.querySelector('[class*="dictationBox"], [class*="DictationBox"]'));
    }

    function hasDuplicateSignature(question) {
        if (!question.signature) return false;
        return questionsList.filter(q => q.signature === question.signature).length > 1;
    }

    function questionMatchesActiveOrder(question, activeQuestionRange, forceOrderMatch = false) {
        if (activeQuestionRange === null || (!forceOrderMatch && !hasDuplicateSignature(question))) return true;
        const order = Number(question.displayOrder);
        return order >= activeQuestionRange.start && order <= activeQuestionRange.end;
    }

    function isQuestionNumberInActiveRange(questionNumber, activeQuestionRange) {
        return activeQuestionRange === null ||
            (questionNumber >= activeQuestionRange.start && questionNumber <= activeQuestionRange.end);
    }

    function findQuestionIndexForElement(el, usedIndices, matches, activeQuestionRange = null) {
        const visibleNumber = getVisibleQuestionNumber(el);
        if (activeQuestionRange !== null &&
            visibleNumber !== null &&
            !isQuestionNumberInActiveRange(visibleNumber, activeQuestionRange)) {
            return -1;
        }

        if (visibleNumber !== null) {
            const orderedIndex = questionsList.findIndex((q, i) => {
                return !usedIndices.has(i) &&
                    questionMatchesActiveOrder(q, activeQuestionRange) &&
                    Number(q.displayOrder) === visibleNumber &&
                    matches(q, i);
            });
            if (orderedIndex !== -1) return orderedIndex;
        }

        return questionsList.findIndex((q, i) => {
            return !usedIndices.has(i) &&
                questionMatchesActiveOrder(q, activeQuestionRange) &&
                matches(q, i);
        });
    }

    function findQuestionElementByText(question, usedElements) {
        const candidates = Array.from(document.body?.querySelectorAll([
            '[class*="Question"]',
            '[class*="question"]',
            '[class*="Quiz"]',
            '[class*="quiz"]',
            '[class*="Sentence"]',
            '[class*="sentence"]',
            'h1',
            'h2',
            'h3',
            'p',
            'li',
            'span',
            'div'
        ].join(', ')) || []);

        let best = null;
        let bestScore = -Infinity;

        for (const el of candidates) {
            if (usedElements.has(el) || !isVisibleElement(el)) continue;

            const text = el.textContent.trim();
            if (text.length < 3 || text.length > 2000 || !matchesQuestionSignature(text, question)) continue;

            const className = String(el.className || "");
            let score = 2000 - text.length;
            if (className.includes('Question') || className.includes('question')) score += 500;
            if (className.includes('Quiz') || className.includes('quiz')) score += 250;

            if (score > bestScore) {
                best = el;
                bestScore = score;
            }
        }

        return best;
    }

    function findQuestionElementByNumber(questionNumber, usedElements) {
        const candidates = Array.from(document.body?.querySelectorAll([
            '[class*="Question"]',
            '[class*="question"]',
            '[class*="Quiz"]',
            '[class*="quiz"]',
            'section',
            'article',
            'div',
            'li'
        ].join(', ')) || []);

        let best = null;
        let bestScore = -Infinity;

        for (const el of candidates) {
            if (usedElements.has(el) || !isVisibleElement(el)) continue;
            if (getVisibleQuestionNumber(el) !== questionNumber) continue;

            const text = el.innerText || el.textContent || "";
            if (text.length > 4000) continue;

            const className = String(el.className || "");
            let score = 4000 - text.length;
            if (className.includes('Question') || className.includes('question')) score += 500;
            if (className.includes('Quiz') || className.includes('quiz')) score += 250;

            if (score > bestScore) {
                best = el;
                bestScore = score;
            }
        }

        return best;
    }

    function findActiveQuestions() {
        const activeQuestionRange = getCurrentProgressQuestionRange();
        const textElements = document.querySelectorAll('[class*="QuestionBuilder__question___"], [class*="QuestionView__question___"]');
        const visibleElements = Array.from(textElements).filter(el => {
            return isVisibleElement(el);
        });

        const matchedPairs = [];
        const usedIndices = new Set();
        const usedElements = new Set();

        // Phase 1: Exact Signature Match
        for (const el of visibleElements) {
            const domSig = normalizeSignature(el.textContent);
            const idx = findQuestionIndexForElement(el, usedIndices, q => q.signature === domSig, activeQuestionRange);

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = findQuestionContainer(el, questionsList[idx].type);
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        // Phase 2: Partial Match
        for (const el of visibleElements) {
            if (usedElements.has(el)) continue;

            const domSig = normalizeSignature(el.textContent);
            const idx = findQuestionIndexForElement(el, usedIndices, q => {
                return domSig.includes(q.signature) || q.signature.includes(domSig);
            }, activeQuestionRange);

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = findQuestionContainer(el, questionsList[idx].type);
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        // Phase 3: Fuzzy Match
        for (const el of visibleElements) {
            if (usedElements.has(el)) continue;

            const domSig = normalizeSignature(el.textContent);
            const idx = findQuestionIndexForElement(el, usedIndices, q => {
                const cleanXml = q.signature.slice(0, 20);
                return domSig.includes(cleanXml);
            }, activeQuestionRange);

            if (idx !== -1) {
                usedIndices.add(idx);
                usedElements.add(el);
                const container = findQuestionContainer(el, questionsList[idx].type);
                matchedPairs.push({ element: container, data: questionsList[idx] });
            }
        }

        // Phase 4: Generic class-name fallback for newer player layouts
        for (let i = 0; i < questionsList.length; i++) {
            if (usedIndices.has(i)) continue;

            const question = questionsList[i];
            if (!questionMatchesActiveOrder(question, activeQuestionRange)) continue;
            const el = findQuestionElementByText(question, usedElements);
            if (!el) continue;

            usedIndices.add(i);
            usedElements.add(el);
            const container = findQuestionContainer(el, question.type);
            matchedPairs.push({ element: container, data: question });
        }

        // Phase 5: Progress/order fallback for pages whose visible prompt text
        // differs from the captured answer data. Auto-advance vocabulary pages
        // reload data between screens, so solving them by order alone can reuse
        // stale answers just after clicking "続ける".
        if (activeQuestionRange !== null && matchedPairs.length === 0) {
            for (let i = 0; i < questionsList.length; i++) {
                if (usedIndices.has(i)) continue;

                const question = questionsList[i];
                if (question.isAutoAdvance) continue;
                if (!questionMatchesActiveOrder(question, activeQuestionRange, true)) continue;

                const questionNumber = Number(question.displayOrder);
                const el = findQuestionElementByNumber(questionNumber, usedElements);
                const container = el ? findQuestionContainer(el, question.type) : document.body;

                usedIndices.add(i);
                if (el) usedElements.add(el);
                matchedPairs.push({ element: container, data: question });
            }
        }

        // Dictation player has no visible question text; use the page config
        // question number, or the single dictation question fallback.
        if (matchedPairs.length === 0) {
            const configuredQuestionNo = getConfiguredQuestionNo();
            const idx = questionsList.findIndex((question, i) => {
                const lowerType = String(question.type || "").toLowerCase();
                return !usedIndices.has(i) && (
                    (configuredQuestionNo && String(question.questionNo) === configuredQuestionNo) ||
                    (questionsList.length === 1 && isDictationLayoutVisible() && (lowerType.includes('dictation') || lowerType.includes('dectation')))
                );
            });

            if (idx !== -1) {
                const question = questionsList[idx];
                const container = findQuestionContainer(document.body, question.type);
                usedIndices.add(idx);
                matchedPairs.push({ element: container, data: question });
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

    function findControlsHeader() {
        const standardHeader = document.querySelector('[class*="AppHeader__fixed-top"] > div');
        if (standardHeader) return standardHeader;

        return document.querySelector([
            '[class*="AppPc__common_inner"]',
            '[class*="AppSp__common_inner"]',
            '[class*="common_header_inner"]',
            '[class*="ControlBox__root"]'
        ].join(', '));
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

        const compositeSig = getCompositeRunKey(activePairs);
        const isNewQuestion = compositeSig !== lastSolvedSignature;
        const estimatedSeconds = getEstimatedTime(activePairs, isFastMode, isNewQuestion);

        btn.textContent = isFastMode ? "自動入力" : `自動入力 (~${estimatedSeconds}秒)`;
        btn.style.backgroundColor = '#ff0000';
        btn.style.cursor = 'pointer';

        btn.onclick = () => {
            setAutoMode(true);
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

        const continueButton = findTransitionButton(["続ける"]);
        if (continueButton && isAutoMode && !isSolving && !isTransitioning) {
            console.log('Auto-Mode: Continue page detected. Clicking "続ける".');
            isTransitioning = true;
            simulateClick(continueButton);
            setTimeout(() => {
                isTransitioning = false;
            }, 3000);
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

        const header = findControlsHeader();
        if (!header) return;

        createControls(header);
        updateUIStates();
    }


    async function runSolver(matchedPairs, isNew) {
        if (isSolving) return;
        isSolving = true;

        try {
            console.log(`Running solver for ${matchedPairs.length} questions...`);

            const isVocabularyTest = matchedPairs.some(p => p.data.isAutoAdvance);
            const totalEstimatedSeconds = getEstimatedTime(matchedPairs, isFastMode, isNew);
            startHeaderAnimation(totalEstimatedSeconds);
            setGlobalLock(true);

            // Skip reading delay for vocabulary tests
            if (!isFastMode && isNew && !isVocabularyTest) {
                const totalText = matchedPairs.map(p => p.data.rawText || "").join(" ");
                const wait = getWaitTime('READING_WAIT', totalText);
                console.log(`Initial reading delay: ${wait}ms`);
                await new Promise(r => setTimeout(r, wait));
            }

            let autoAdvance = false;
            for (let i = 0; i < matchedPairs.length; i++) {
                const pair = matchedPairs[i];
                if (pair.data.isAutoAdvance) autoAdvance = true;
                await solve(pair.data.answers, pair.data.type, pair.element, pair.data);
                const postSolveWait = pair.data.isAutoAdvance
                    ? Math.min(getWaitTime('SOLVE_INTERVAL'), 300)
                    : getWaitTime('SOLVE_INTERVAL');
                if (postSolveWait > 0) {
                    await new Promise(r => setTimeout(r, postSolveWait));
                }
            }

            if (isAutoMode) {
                if (autoAdvance) {
                    console.log("Detecting auto-advance question, skipping manual transition click.");
                    isSolving = false;
                    resetHeaderProgress();
                    setGlobalLock(false);
                    setTimeout(ensureSolveButton, Math.max(getWaitTime('TRANSITION_WAIT'), 500));
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
        isTransitioning = true;

        try {
            console.log("Attempting transition...");
            await new Promise(r => setTimeout(r, getWaitTime('TRANSITION_WAIT')));

            const nextBtn = document.getElementById('nextButton');

            if (nextBtn && !nextBtn.disabled) {
                console.log("Transition: Clicking Next Button.");
                simulateClick(nextBtn);
                return;
            }

            const button = findTransitionButton(["採点", "判定", "続ける", "終了"]);
            if (button) {
                console.log(`Transition: Clicking "${button.textContent.trim()}" Button.`);
                simulateClick(button);
                return;
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
            isTransitioning = false;
        }
    }

    function findTransitionButton(keywords) {
        const buttons = Array.from(document.querySelectorAll([
            'button',
            'input[type="button"]',
            'input[type="submit"]',
            'a',
            '[role="button"]'
        ].join(', '))).filter(isVisibleElement);
        return buttons.find(button => {
            const text = [
                button.textContent,
                button.value,
                button.getAttribute('aria-label'),
                button.getAttribute('title')
            ].filter(Boolean).join(' ');
            return keywords.some(keyword => text.includes(keyword));
        });
    }
})();
