// Academic Express Auto Answer - Content Script
// Handles UI injection and DOM manipulation for auto-answering

(function () {
  "use strict";
  console.log("Academic Express Auto Answer Content Script Loaded");

  // Global state
  let questionsList = [];
  let currentButtonState = null;
  let isFastMode = localStorage.getItem("fast-mode") === "true";
  let lastSolvedSignature = "";
  let isSolving = false;
  let isTransitioning = false;
  let debounceTimer = null;
  let autoSolveResumeTimer = null;
  let nextAutoSolveAllowedAt = 0;
  let isAutoMode = false;
  let lastAutoAdvanceSolvedAt = 0;
  const QUESTION_HUB_SELECTION_MODE_KEY = "question-hub-selection-mode";
  const QUESTION_HUB_SELECTED_KEY = "question-hub-selected-links";
  const QUESTION_HUB_RUN_STATE_KEY = "question-hub-run-state";
  const QUESTION_HUB_PENDING_AUTO_URL_KEY = "question-hub-pending-auto-url";
  let isQuestionHubSelectionMode =
    localStorage.getItem(QUESTION_HUB_SELECTION_MODE_KEY) === "true";
  let isQuestionHubLaunching = false;
  let questionHubLaunchTimer = null;

  function isQuizPlayerPage() {
    return window.location.pathname.includes("/as/lplayer/");
  }

  function isStudentPage() {
    return window.location.pathname.includes("/student/");
  }

  function isQuestionHubPage() {
    return isStudentPage() && getQuestionHubLinks().length > 0;
  }

  function normalizeUrlForStorage(url) {
    try {
      const parsed = new URL(url, window.location.href);
      parsed.hash = "";
      return parsed.href;
    } catch (e) {
      return url || "";
    }
  }

  function clearAutoModeStorage() {
    localStorage.removeItem("auto-mode");
    localStorage.removeItem("auto-mode-url");
  }

  try {
    const storedAuto = localStorage.getItem("auto-mode");
    const storedAutoUrl = localStorage.getItem("auto-mode-url");
    const pendingQuestionHubAutoUrl = localStorage.getItem(
      QUESTION_HUB_PENDING_AUTO_URL_KEY,
    );
    const currentUrl = normalizeUrlForStorage(window.location.href);
    if (isStudentPage()) {
      clearAutoModeStorage();
    } else if (
      isQuizPlayerPage() &&
      pendingQuestionHubAutoUrl &&
      normalizeUrlForStorage(pendingQuestionHubAutoUrl) === currentUrl
    ) {
      isAutoMode = true;
      localStorage.removeItem(QUESTION_HUB_PENDING_AUTO_URL_KEY);
      localStorage.setItem("auto-mode", "true");
      localStorage.setItem("auto-mode-url", window.location.href);
    } else if (
      isQuizPlayerPage() &&
      storedAuto === "true" &&
      storedAutoUrl === window.location.href
    ) {
      isAutoMode = true;
    } else {
      // URL changed or not set -> Reset AutoMode
      clearAutoModeStorage();
    }
  } catch (e) {
    console.error("AutoMode Init Error", e);
  }

  function setAutoMode(value) {
    isAutoMode = value && isQuizPlayerPage();
    if (isAutoMode) {
      localStorage.setItem("auto-mode", "true");
      localStorage.setItem("auto-mode-url", window.location.href);
    } else {
      clearAutoModeStorage();
    }
  }

  function setFastMode(value) {
    isFastMode = value === true;
    localStorage.setItem("fast-mode", isFastMode);
    updateQuestionHubPanel();
    updateUIStates();
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
      DEBOUNCE_WAIT: 300,
      AUTO_ADVANCE_WAIT: 1000,
      AUTO_SOLVE_RESUME_WAIT: 1000,
    },
    fastmode: {
      READING_MIN: 0,
      READING_MAX: 0,
      WORD_WAIT: 0,
      TRANSITION_WAIT: 50,
      CLICK_WAIT: 50,
      OPTION_WAIT: 0,
      SOLVE_INTERVAL: 50,
      DEBOUNCE_WAIT: 50,
      AUTO_ADVANCE_WAIT: 100,
      AUTO_SOLVE_RESUME_WAIT: 50,
    },
  };

  function getWaitTime(type, context = null) {
    const mode = isFastMode ? "fastmode" : "slowmode";
    const config = SPEED_CONFIG[mode];
    let base = config[type] || 0;

    if (mode === "slowmode") {
      if (type === "READING_WAIT" && typeof context === "string") {
        const words = context.trim().split(/\s+/).filter(Boolean).length;
        base = Math.min(
          Math.max(words * config.WORD_WAIT, config.READING_MIN),
          config.READING_MAX,
        );
      }
      const jitter = Math.random() * 0.4 + 0.8;
      return Math.floor(base * jitter);
    }
    return base;
  }

  function getQuestionRunKey(question) {
    return [
      question.displayOrder || "",
      question.questionNo || "",
      question.signature || "",
    ].join(":");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getNow() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  function requestProgressFrame(callback) {
    return typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(callback)
      : setTimeout(callback, 16);
  }

  function cancelProgressFrame(frameId) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameId);
    } else {
      clearTimeout(frameId);
    }
  }

  async function waitForAutoAdvancePace() {
    const wait = getWaitTime("AUTO_ADVANCE_WAIT");
    if (wait <= 0) return;

    const elapsed = Date.now() - lastAutoAdvanceSolvedAt;
    if (elapsed > 0 && elapsed < wait) {
      await sleep(wait - elapsed);
    }
  }

  function scheduleAutoSolveResume(wait) {
    if (autoSolveResumeTimer) clearTimeout(autoSolveResumeTimer);
    autoSolveResumeTimer = setTimeout(
      () => {
        autoSolveResumeTimer = null;
        ensureSolveButton();
      },
      Math.max(0, wait),
    );
  }

  function getCompositeRunKey(pairs) {
    return pairs.map((p) => getQuestionRunKey(p.data)).join("|");
  }

  // Listen for captured XHR data from injected script
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data.type !== "ACADEMIC_EXPRESS_XHR_CAPTURED") return;

    const { url, responseText } = event.data;

    // Send to background for parsing and storage
    try {
      await chrome.runtime.sendMessage({
        type: "XHR_CAPTURED",
        url: url,
        responseText: responseText,
      });
      // Reload question data after background processes it
      setTimeout(() => loadQuestionData(), 100);
    } catch (e) {
      // Failed to send captured data
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "QUESTION_DATA_READY") {
      loadQuestionData();
    }
  });

  // Load question data from storage via message passing
  async function loadQuestionData() {
    try {
      const result = await chrome.runtime.sendMessage({
        type: "GET_QUESTION_DATA",
      });
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
  function getEstimatedDurationMs(
    pairs,
    isFast,
    forceNew = null,
    options = {},
  ) {
    const mode = isFast ? "fastmode" : "slowmode";
    const config = SPEED_CONFIG[mode];
    let total = 0;

    const compositeSig = getCompositeRunKey(pairs);
    const isNew =
      forceNew !== null ? forceNew : compositeSig !== lastSolvedSignature;

    // Skip reading time for pages that advance as soon as the answer completes.
    const hasAutoAdvancePair = pairs.some(isAutoAdvancePair);
    if (!isFast && isNew && !hasAutoAdvancePair) {
      if (Number.isFinite(options.readingWaitMs)) {
        total += options.readingWaitMs;
      } else {
        const totalText = pairs.map((p) => p.data.rawText || "").join(" ");
        const words = totalText.trim().split(/\s+/).filter(Boolean).length;
        total += Math.min(
          Math.max(words * config.WORD_WAIT, config.READING_MIN),
          config.READING_MAX,
        );
      }
    }

    // Include only the time until the current screen action completes.
    // Auto-advance pages navigate as soon as the answer is clicked, so the
    // post-click pace belongs to the next solve cycle, not this progress bar.
    const answerWait = config.CLICK_WAIT || 0;
    if (hasAutoAdvancePair) {
      total += pairs.length * answerWait;
      if (Number.isFinite(options.autoAdvancePaceWaitMs)) {
        total += options.autoAdvancePaceWaitMs;
      }
      return total;
    } else {
      total += pairs.length * (answerWait + config.SOLVE_INTERVAL);
    }

    total += config.TRANSITION_WAIT;
    return total;
  }

  function getEstimatedTime(pairs, isFast, forceNew = null) {
    return Math.ceil(getEstimatedDurationMs(pairs, isFast, forceNew) / 1000);
  }

  // Header Progress Bar Logic
  function setHeaderProgress(percentage) {
    const container = document.querySelector(
      '[class*="AppHeader__fixed-top"] > div',
    );
    const outer = document.querySelector('[class*="AppHeader__fixed-top"]');
    if (!container && !outer) return;

    const target = container || outer;

    if (percentage === 0) {
      target.style.backgroundImage = "none";
      return;
    }

    const gradient = `linear-gradient(to right, #007991 ${percentage}%, transparent ${percentage}%)`;
    target.style.setProperty("background-image", gradient);
  }

  const HEADER_PROGRESS_MIN_DURATION = {
    slowmode: 900,
    fastmode: 700,
  };

  let progressAnimationFrame = null;
  let progressAnimation = null;

  function stopHeaderAnimation() {
    if (progressAnimationFrame) {
      cancelProgressFrame(progressAnimationFrame);
      progressAnimationFrame = null;
    }
    progressAnimation = null;
  }

  function startHeaderAnimation(durationMs, options = {}) {
    stopHeaderAnimation();
    const mode = isFastMode ? "fastmode" : "slowmode";
    const minimumDuration = Number.isFinite(options.minimumDurationMs)
      ? options.minimumDurationMs
      : HEADER_PROGRESS_MIN_DURATION[mode];
    const duration = Math.max(Number(durationMs) || 0, minimumDuration);
    const startTime = getNow();

    progressAnimation = {
      startTime,
      duration,
      minimumDuration,
    };

    setHeaderProgress(0);

    const step = () => {
      if (!progressAnimation) return;

      const elapsed = getNow() - progressAnimation.startTime;
      const progress =
        progressAnimation.duration > 0
          ? Math.min((elapsed / progressAnimation.duration) * 100, 100)
          : 100;
      setHeaderProgress(progress);

      if (progress >= 100) {
        stopHeaderAnimation();
        return;
      }

      progressAnimationFrame = requestProgressFrame(step);
    };

    progressAnimationFrame = requestProgressFrame(step);
  }

  async function finishHeaderAnimation() {
    if (!progressAnimation) return;

    const remainingMinimum =
      progressAnimation.minimumDuration -
      (getNow() - progressAnimation.startTime);
    if (remainingMinimum > 0) {
      await sleep(remainingMinimum);
    }

    setHeaderProgress(100);
  }

  function completeHeaderProgress() {
    stopHeaderAnimation();
    setHeaderProgress(100);
  }

  function resetHeaderProgress() {
    stopHeaderAnimation();
    setHeaderProgress(0);
  }

  // Global Lock Element
  const lockOverlay = document.createElement("div");
  lockOverlay.id = "global-lock";
  lockOverlay.style.cssText =
    "position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:99999; display:none; cursor:wait; pointer-events:auto; background:rgba(0,0,0,0);";
  document.documentElement.appendChild(lockOverlay);

  function setGlobalLock(active) {
    lockOverlay.style.display = active ? "block" : "none";

    // Unlock Header for "Back" button access
    const header = document.querySelector('[class*="AppHeader__fixed-top"]');
    if (header) {
      header.style.zIndex = active ? "100000" : "";
    }

    const container = document.getElementById("controls-container");
    if (container) {
      container.style.position = "relative";
      container.style.zIndex = active ? "100001" : "";
    }
  }

  function parseJsonStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getQuestionHubLinks() {
    return Array.from(
      document.querySelectorAll('a[href*="/as/lplayer/index.cfm"]'),
    ).filter((link) => {
      const href = link.href || "";
      return href && !href.startsWith("javascript:");
    });
  }

  function findNearestQuestionHubLink(start) {
    const directLink = start?.closest?.('a[href*="/as/lplayer/index.cfm"]');
    if (directLink) return directLink;

    const unitBox = start?.closest?.(".unit-box");
    const scopedLink = unitBox?.querySelector?.(
      'a[href*="/as/lplayer/index.cfm"]',
    );
    if (scopedLink) return scopedLink;

    const clickable = start?.closest?.(
      [
        ".btn",
        ".level_img",
        ".study_text",
        ".unit-box-body",
        ".lesson-list",
        '[role="button"]',
      ].join(", "),
    );
    return (
      clickable?.querySelector?.('a[href*="/as/lplayer/index.cfm"]') || null
    );
  }

  function getQuestionHubSelectedHrefs() {
    const selected = parseJsonStorage(QUESTION_HUB_SELECTED_KEY, []);
    return Array.isArray(selected)
      ? selected.filter(Boolean).map(normalizeUrlForStorage)
      : [];
  }

  function setQuestionHubSelectedHrefs(hrefs) {
    const uniqueHrefs = Array.from(
      new Set(hrefs.filter(Boolean).map(normalizeUrlForStorage)),
    );
    localStorage.setItem(
      QUESTION_HUB_SELECTED_KEY,
      JSON.stringify(uniqueHrefs),
    );
    return uniqueHrefs;
  }

  function getQuestionHubRunState() {
    const state = parseJsonStorage(QUESTION_HUB_RUN_STATE_KEY, null);
    if (!state || !Array.isArray(state.queue)) return null;
    const total = Math.max(
      Number(state.total) || state.queue.length,
      state.queue.length,
    );
    const completed = Math.min(Math.max(Number(state.completed) || 0, 0), total);
    return {
      active: state.active === true,
      queue: state.queue.filter(Boolean),
      completed,
      total,
      hubUrl: state.hubUrl || "",
    };
  }

  function setQuestionHubRunState(state) {
    if (!state || !state.active) {
      localStorage.removeItem(QUESTION_HUB_RUN_STATE_KEY);
      return;
    }
    localStorage.setItem(QUESTION_HUB_RUN_STATE_KEY, JSON.stringify(state));
  }

  function getQuestionHubLinkLabel(link) {
    const text = (link.textContent || "").replace(/\s+/g, " ").trim();
    const unitTitle = link
      .closest(".unit-box")
      ?.querySelector(".unit-title-char")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    return [unitTitle, text].filter(Boolean).join(" / ") || link.href;
  }

  function navigateToQuestionHubUrl(href) {
    const targetUrl = normalizeUrlForStorage(href);
    localStorage.setItem(QUESTION_HUB_PENDING_AUTO_URL_KEY, targetUrl);
    window.location.assign(targetUrl);
  }

  function updateQuestionHubLinkStates() {
    const selected = new Set(getQuestionHubSelectedHrefs());
    getQuestionHubLinks().forEach((link) => {
      const isSelected = selected.has(normalizeUrlForStorage(link.href));
      link.classList.toggle("ae-question-hub-selected", isSelected);
      link.setAttribute("data-ae-question-hub-bound", "true");
      if (isSelected) {
        link.setAttribute("aria-pressed", "true");
        link.title = "選択済み: " + getQuestionHubLinkLabel(link);
      } else {
        link.removeAttribute("aria-pressed");
        link.removeAttribute("title");
      }
    });
  }

  function launchNextQuestionHubItem() {
    if (isQuestionHubLaunching) return true;

    const state = getQuestionHubRunState();
    if (!state?.active) return false;

    if (state.queue.length === 0) {
      setQuestionHubRunState(null);
      updateQuestionHubPanel();
      updateQuestionHubLinkStates();
      return false;
    }

    const [href, ...remainingQueue] = state.queue.map(normalizeUrlForStorage);
    const nextState = {
      ...state,
      queue: remainingQueue,
      completed: state.completed + 1,
    };

    setQuestionHubRunState(nextState);
    setQuestionHubSelectedHrefs(remainingQueue);
    updateQuestionHubPanel();
    updateQuestionHubLinkStates();
    isQuestionHubLaunching = true;
    questionHubLaunchTimer = setTimeout(() => {
      questionHubLaunchTimer = null;
      if (!getQuestionHubRunState()?.active) {
        isQuestionHubLaunching = false;
        return;
      }
      console.log("QuestionHub: launching selected question set.", href);
      navigateToQuestionHubUrl(href);
    }, getWaitTime("TRANSITION_WAIT"));
    return true;
  }

  function toggleQuestionHubSelection(link) {
    const selected = getQuestionHubSelectedHrefs();
    const href = normalizeUrlForStorage(link.href);
    const index = selected.indexOf(href);
    if (index === -1) {
      selected.push(href);
    } else {
      selected.splice(index, 1);
    }
    setQuestionHubSelectedHrefs(selected);
    updateQuestionHubPanel();
    updateQuestionHubLinkStates();
  }

  function bindQuestionHubLinks() {
    if (document.body.dataset.aeQuestionHubDelegatedClickBound === "true")
      return;
    document.body.dataset.aeQuestionHubDelegatedClickBound = "true";

    document.addEventListener(
      "click",
      (event) => {
        if (!isQuestionHubSelectionMode) return;

        const link = findNearestQuestionHubLink(event.target);
        if (!link) return;

        event.preventDefault();
        event.stopPropagation();
        toggleQuestionHubSelection(link);
      },
      true,
    );
  }

  function updateQuestionHubPanel() {
    const panel = document.getElementById("question-hub-control");
    if (!panel) return;

    const selected = getQuestionHubSelectedHrefs();
    const runState = getQuestionHubRunState();
    const modeBtn = panel.querySelector("#question-hub-mode-btn");
    const runBtn = panel.querySelector("#question-hub-run-btn");
    const clearBtn = panel.querySelector("#question-hub-clear-btn");
    const stopBtn = panel.querySelector("#question-hub-stop-btn");
    const speedSlowBtn = panel.querySelector("#question-hub-speed-slow");
    const speedFastBtn = panel.querySelector("#question-hub-speed-fast");
    const status = panel.querySelector("#question-hub-status");
    const isRunning = runState?.active === true;

    if (modeBtn) {
      modeBtn.textContent = isQuestionHubSelectionMode
        ? "選択モード中"
        : "問題選択モード";
      modeBtn.disabled = isRunning;
      modeBtn.classList.toggle(
        "ae-question-hub-primary",
        isQuestionHubSelectionMode && !isRunning,
      );
    }
    if (runBtn) {
      runBtn.disabled = selected.length === 0 || isRunning;
    }
    if (clearBtn) {
      clearBtn.disabled = selected.length === 0 || isRunning;
    }
    if (stopBtn) {
      stopBtn.style.display = isRunning ? "" : "none";
    }
    if (speedSlowBtn) {
      speedSlowBtn.disabled = isRunning;
      speedSlowBtn.classList.toggle("active", !isFastMode);
    }
    if (speedFastBtn) {
      speedFastBtn.disabled = isRunning;
      speedFastBtn.classList.toggle("active", isFastMode);
    }
    if (status) {
      status.textContent = isRunning
        ? `実行中 ${runState.completed} / ${runState.total}`
        : `選択 ${selected.length}件`;
    }
  }

  function createQuestionHubPanel() {
    if (document.getElementById("question-hub-control")) return;
    injectStyles();

    const panel = document.createElement("div");
    panel.id = "question-hub-control";
    panel.innerHTML = `
      <div id="question-hub-speed-control" aria-label="速度設定">
        <button type="button" id="question-hub-speed-slow">低速</button>
        <button type="button" id="question-hub-speed-fast">高速</button>
      </div>
      <button type="button" id="question-hub-mode-btn"></button>
      <button type="button" id="question-hub-run-btn">実行</button>
      <button type="button" id="question-hub-stop-btn">停止</button>
      <button type="button" id="question-hub-clear-btn">クリア</button>
      <span id="question-hub-status"></span>
    `;
    document.body.appendChild(panel);

    panel
      .querySelector("#question-hub-mode-btn")
      .addEventListener("click", () => {
        isQuestionHubSelectionMode = !isQuestionHubSelectionMode;
        localStorage.setItem(
          QUESTION_HUB_SELECTION_MODE_KEY,
          String(isQuestionHubSelectionMode),
        );
        updateQuestionHubPanel();
      });

    panel
      .querySelector("#question-hub-speed-slow")
      .addEventListener("click", () => {
        if (getQuestionHubRunState()?.active) return;
        setFastMode(false);
      });

    panel
      .querySelector("#question-hub-speed-fast")
      .addEventListener("click", () => {
        if (getQuestionHubRunState()?.active) return;
        setFastMode(true);
      });

    panel
      .querySelector("#question-hub-run-btn")
      .addEventListener("click", () => {
        const queue = getQuestionHubSelectedHrefs();
        if (queue.length === 0) return;
        isQuestionHubSelectionMode = false;
        localStorage.setItem(QUESTION_HUB_SELECTION_MODE_KEY, "false");
        setQuestionHubRunState({
          active: true,
          queue,
          completed: 0,
          total: queue.length,
          hubUrl: window.location.href,
        });
        updateQuestionHubPanel();
        launchNextQuestionHubItem();
      });

    panel
      .querySelector("#question-hub-stop-btn")
      .addEventListener("click", () => {
        if (questionHubLaunchTimer) {
          clearTimeout(questionHubLaunchTimer);
          questionHubLaunchTimer = null;
        }
        setQuestionHubRunState(null);
        localStorage.removeItem(QUESTION_HUB_PENDING_AUTO_URL_KEY);
        setAutoMode(false);
        isQuestionHubLaunching = false;
        updateQuestionHubPanel();
        updateQuestionHubLinkStates();
      });

    panel
      .querySelector("#question-hub-clear-btn")
      .addEventListener("click", () => {
        setQuestionHubSelectedHrefs([]);
        updateQuestionHubPanel();
        updateQuestionHubLinkStates();
      });
  }

  function ensureQuestionHubControls() {
    const runState = getQuestionHubRunState();
    if (isQuizPlayerPage() && runState?.active) {
      createQuestionHubPanel();
      updateQuestionHubPanel();
      return false;
    }

    if (isStudentPage() && runState?.active && !isQuestionHubSelectionMode) {
      createQuestionHubPanel();
      updateQuestionHubPanel();
      launchNextQuestionHubItem();
      return true;
    }

    if (!isQuestionHubPage()) return false;
    clearAutoModeStorage();
    bindQuestionHubLinks();
    createQuestionHubPanel();
    updateQuestionHubPanel();
    updateQuestionHubLinkStates();

    if (runState?.active && !isQuestionHubSelectionMode) {
      launchNextQuestionHubItem();
    }
    return true;
  }

  // Robust Observer Callback with Debounce
  const observerCallback = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      ensureSolveButton();
    }, getWaitTime("DEBOUNCE_WAIT"));
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
    if (lowerType.includes("dictation") || lowerType.includes("dectation")) {
      return (
        document.querySelector(
          [
            '[class*="AppPc__app_root"]',
            '[class*="AppSp__app_root"]',
            '[class*="dictationBox"]',
            '[class*="DictationBox"]',
          ].join(", "),
        ) || document.body
      );
    }

    // Scanning問題: 質問テキストに対応するpassageBox（combinationMain）を探す
    // 他の問題タイプ（True/False等）が同一画面にある場合でも、これらは自身の領域を使うべきなので
    // typeがScanningの場合のみスコープを変更する
    if (lowerType === "scanning") {
      const combinationQuestion = el.closest(
        '[class*="CombinationQuestionView__combinationQuestion"]',
      );
      if (combinationQuestion) {
        // 兄弟要素としてcombinationMainを探す
        const parent = combinationQuestion.parentElement;
        const combinationMain = parent?.querySelector(
          '[class*="CombinationQuestionView__combinationMain"]',
        );
        if (combinationMain) return combinationMain;
      }
    }

    // 通常の問題タイプ: questionBoxを検索
    const box = el.closest(
      [
        '[class*="QuestionBuilder__questionBox___"]',
        '[class*="QuestionView__questionBox___"]',
        '[class*="Question"][class*="questionBox"]',
        '[class*="questionBox"]',
        '[class*="Quiz"]',
        '[class*="quiz"]',
        "form",
        "section",
        "article",
      ].join(", "),
    );
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
      .replace(/[^\p{L}\p{N}]/gu, "")
      .slice(0, limit);
  }

  function getQuestionSignatures(question) {
    const signatures = [
      question?.signature || normalizeSignature(question?.rawText),
      ...(Array.isArray(question?.matchSignatures)
        ? question.matchSignatures
        : []),
    ];
    return signatures
      .map((signature) => String(signature || "").trim())
      .filter(Boolean)
      .filter((signature, idx, values) => values.indexOf(signature) === idx);
  }

  function normalizeMediaSignature(value) {
    const text = String(value || "");
    const idMatch =
      text.match(/[?&]id=([^&#\s]+)/i) ||
      text.match(/([a-f0-9]{24,})(?:\.[a-z0-9]+)?(?:[?#]|$)/i);
    const signature = idMatch ? idMatch[1] : text;
    return signature.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function getQuestionMediaSignatures(question) {
    return (
      Array.isArray(question?.mediaSignatures) ? question.mediaSignatures : []
    )
      .map(normalizeMediaSignature)
      .filter(Boolean)
      .filter((signature, idx, values) => values.indexOf(signature) === idx);
  }

  function pushMediaSignature(target, value) {
    const signature = normalizeMediaSignature(value);
    if (signature && signature.length <= 80 && !target.includes(signature)) {
      target.push(signature);
    }
  }

  function getCurrentMediaSignatures(searchRoot = document.body) {
    const signatures = [];
    const mediaRoot = searchRoot?.querySelectorAll ? searchRoot : document;

    Array.from(
      mediaRoot.querySelectorAll?.("audio, source, img, object, embed") || [],
    ).forEach((el) => {
      pushMediaSignature(
        signatures,
        el.currentSrc ||
          el.src ||
          el.data ||
          el.getAttribute?.("src") ||
          el.getAttribute?.("data") ||
          "",
      );
    });

    const entries =
      typeof performance?.getEntriesByType === "function"
        ? performance.getEntriesByType("resource")
        : [];
    entries
      .filter((entry) => {
        const name = String(entry?.name || "");
        return (
          /material(?:Sound|Image)\.cfm/i.test(name) || /[?&]id=/i.test(name)
        );
      })
      .sort((a, b) => {
        const bTime = b.responseEnd || b.startTime || 0;
        const aTime = a.responseEnd || a.startTime || 0;
        return bTime - aTime;
      })
      .slice(0, 8)
      .forEach((entry) => pushMediaSignature(signatures, entry.name));

    return signatures;
  }

  function findQuestionIndexByMediaSignatures(
    mediaSignatures,
    usedIndices,
    activeQuestionRange,
  ) {
    for (const mediaSignature of mediaSignatures) {
      const idx = questionsList.findIndex((question, i) => {
        if (usedIndices.has(i)) return false;
        if (!getQuestionMediaSignatures(question).includes(mediaSignature))
          return false;
        return (
          question.shuffleQuestions === true ||
          questionMatchesActiveOrder(question, activeQuestionRange)
        );
      });
      if (idx !== -1) return idx;
    }

    return -1;
  }

  function isVisibleElement(el) {
    if (!el || !el.isConnected) return false;
    const tagName = el.tagName;
    if (tagName === "SCRIPT" || tagName === "STYLE" || tagName === "NOSCRIPT")
      return false;

    const style = window.getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      Number(style.opacity) === 0
    )
      return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function isInViewport(el) {
    if (!isVisibleElement(el)) return false;
    const rect = el.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < height &&
      rect.left < width
    );
  }

  function matchesQuestionSignature(text, question) {
    const domSig = normalizeSignature(text, 120);
    const questionSigs = getQuestionSignatures(question);
    if (!domSig || questionSigs.length === 0) return false;
    if (
      questionSigs.some((questionSig) => {
        return (
          domSig.includes(questionSig) ||
          questionSig.includes(domSig.slice(0, Math.min(20, domSig.length)))
        );
      })
    ) {
      return true;
    }

    const skeleton = String(question.rawText || "").replace(/\[[^\]]+\]/g, "");
    const skeletonSig = normalizeSignature(skeleton, 120);
    return (
      skeletonSig.length >= 8 &&
      (domSig.includes(skeletonSig) || skeletonSig.includes(domSig))
    );
  }

  function getCurrentProgressQuestionRange() {
    const text = [document.body?.innerText, document.body?.textContent]
      .filter(Boolean)
      .join("\n");
    const rangeMatch = text.match(
      /(?:^|\s)(\d{1,3})\s*[-－ー]\s*(\d{1,3})\s*\/\s*(\d{1,3})(?:\s|$)/,
    );
    const singleMatch = rangeMatch
      ? null
      : text.match(/(?:^|\s)(\d{1,3})\s*\/\s*(\d{1,3})(?:\s|$)/);
    const match = rangeMatch || singleMatch;
    if (!match) return null;

    const start = Number(match[1]);
    const end = rangeMatch ? Number(match[2]) : start;
    const total = Number(match[rangeMatch ? 3 : 2]);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(total)
    )
      return null;
    if (start < 1 || end < start || total < end) return null;
    return {
      start,
      end,
      total,
      totalMatchesQuestionList: total === questionsList.length,
    };
  }

  function getVisibleQuestionNumber(el) {
    let current = el;

    for (let depth = 0; current && depth < 5; depth++) {
      const text = current.innerText || current.textContent || "";
      if (text.length <= 3000) {
        const match = text.match(/(?:^|\s)(\d{1,3})\s*[:：]/);
        if (match) {
          const number = Number(match[1]);
          if (
            Number.isInteger(number) &&
            number >= 1 &&
            number <= questionsList.length
          ) {
            return number;
          }
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  function findAutoAdvanceQuestionScope(activeQuestionRange) {
    if (
      !activeQuestionRange ||
      activeQuestionRange.start !== activeQuestionRange.end ||
      !questionsList.some((question) => question.isAutoAdvance)
    ) {
      return document.body;
    }

    const questionBoxes = Array.from(
      document.body?.querySelectorAll(
        [
          '[class*="TangoTypingQuestionBuilder__questionBox"]',
          '[class*="TangoSentenceTypingQuestionBuilder__questionBox"]',
          '[class*="TypingQuestionBuilder__questionBox"]',
          '[class*="SentenceTypingQuestionBuilder__questionBox"]',
          '[class*="QuestionBuilder__questionBox"]',
          '[class*="QuestionView__questionBox"]',
        ].join(", "),
      ) || [],
    ).filter(isInViewport);

    const activeQuestionBoxes = questionBoxes.filter((box) => {
      return (
        box.textContent.includes("知らない") ||
        Boolean(box.querySelector('[class*="FontBox__fontBox"]'))
      );
    });
    const scopedBoxes =
      activeQuestionBoxes.length > 0 ? activeQuestionBoxes : questionBoxes;

    const currentNumberBoxes = scopedBoxes.filter((box) => {
      return getVisibleQuestionNumber(box) === activeQuestionRange.start;
    });
    if (currentNumberBoxes.length > 0) return currentNumberBoxes[0];
    if (scopedBoxes.length === 1) return scopedBoxes[0];

    return document.body;
  }

  function getQuestionTextSelector() {
    return [
      '[class*="QuestionBuilder__question___"]',
      '[class*="QuestionView__question___"]',
      '[class*="TypingQuestionBuilder__question___"]',
      '[class*="SentenceTypingQuestionBuilder__question___"]',
      '[class*="TangoTypingQuestionBuilder__question___"]',
      '[class*="TangoSentenceTypingQuestionBuilder__question___"]',
      '[class*="TangoSentenceTypingQuestionBuilder__sentenceJa"]',
    ].join(", ");
  }

  function getConfiguredQuestionNo() {
    return String(window.config?.question_no || "");
  }

  function isDictationLayoutVisible() {
    return Boolean(
      document.querySelector(
        '[class*="dictationBox"], [class*="DictationBox"], [class*="dictationArea"]',
      ),
    );
  }

  function hasDuplicateSignature(question) {
    if (!question.signature) return false;
    return (
      questionsList.filter((q) => q.signature === question.signature).length > 1
    );
  }

  function questionMatchesActiveOrder(
    question,
    activeQuestionRange,
    forceOrderMatch = false,
  ) {
    if (question.isAutoAdvance && questionsList.length === 1) return true;

    const shouldUseActiveOrder =
      activeQuestionRange !== null &&
      (forceOrderMatch ||
        hasDuplicateSignature(question) ||
        (question.isAutoAdvance &&
          activeQuestionRange.totalMatchesQuestionList === false));
    if (!shouldUseActiveOrder) return true;
    const order = Number(question.displayOrder);
    return (
      order >= activeQuestionRange.start && order <= activeQuestionRange.end
    );
  }

  function isQuestionNumberInActiveRange(questionNumber, activeQuestionRange) {
    return (
      activeQuestionRange === null ||
      (questionNumber >= activeQuestionRange.start &&
        questionNumber <= activeQuestionRange.end)
    );
  }

  function isSingleQuestionProgress(activeQuestionRange) {
    return (
      activeQuestionRange !== null &&
      activeQuestionRange.start === activeQuestionRange.end
    );
  }

  function isAutoAdvancePair(pair) {
    if (pair?.data?.isAutoAdvance) return true;

    const type = String(pair?.data?.type || "").toLowerCase();
    if (type.includes("dictation") && questionsList.length > 1) return true;
    return false;
  }

  function isDictationPair(pair) {
    return String(pair?.data?.type || "")
      .toLowerCase()
      .includes("dictation");
  }

  function getPreSolveWait(pair) {
    if (isDictationPair(pair)) return 0;
    return getWaitTime("CLICK_WAIT");
  }

  function hasProgressAdvancedFrom(initialRange) {
    if (!isSingleQuestionProgress(initialRange)) return false;
    const currentRange = getCurrentProgressQuestionRange();
    if (!currentRange) {
      return !findTransitionButton(["採点", "判定", "続ける", "終了", "完了"]);
    }
    return (
      currentRange.start !== initialRange.start ||
      currentRange.end !== initialRange.end ||
      currentRange.total !== initialRange.total
    );
  }

  async function waitForPostSolveSettle(waitMs, initialRange) {
    const deadline = Date.now() + Math.max(0, waitMs);
    while (Date.now() < deadline) {
      if (hasProgressAdvancedFrom(initialRange)) {
        completeHeaderProgress();
        return true;
      }
      await sleep(Math.min(50, deadline - Date.now()));
    }

    if (hasProgressAdvancedFrom(initialRange)) {
      completeHeaderProgress();
      return true;
    }
    return false;
  }

  function findQuestionIndexForElement(
    el,
    usedIndices,
    matches,
    activeQuestionRange = null,
  ) {
    const visibleNumber = getVisibleQuestionNumber(el);
    if (
      activeQuestionRange !== null &&
      visibleNumber !== null &&
      !isQuestionNumberInActiveRange(visibleNumber, activeQuestionRange)
    ) {
      return -1;
    }

    if (visibleNumber !== null) {
      const orderedIndex = questionsList.findIndex((q, i) => {
        return (
          !usedIndices.has(i) &&
          questionMatchesActiveOrder(q, activeQuestionRange) &&
          Number(q.displayOrder) === visibleNumber &&
          matches(q, i)
        );
      });
      if (orderedIndex !== -1) return orderedIndex;
    }

    return questionsList.findIndex((q, i) => {
      return (
        !usedIndices.has(i) &&
        questionMatchesActiveOrder(q, activeQuestionRange) &&
        matches(q, i)
      );
    });
  }

  function findQuestionElementByText(
    question,
    usedElements,
    root = document.body,
  ) {
    const candidates = Array.from(
      root?.querySelectorAll(
        [
          '[class*="Question"]',
          '[class*="question"]',
          '[class*="Quiz"]',
          '[class*="quiz"]',
          '[class*="Sentence"]',
          '[class*="sentence"]',
          "h1",
          "h2",
          "h3",
          "p",
          "li",
          "span",
          "div",
        ].join(", "),
      ) || [],
    );

    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      if (usedElements.has(el) || !isVisibleElement(el)) continue;

      const text = el.textContent.trim();
      if (
        text.length < 3 ||
        text.length > 2000 ||
        !matchesQuestionSignature(text, question)
      )
        continue;

      const className = String(el.className || "");
      let score = 2000 - text.length;
      if (className.includes("Question") || className.includes("question"))
        score += 500;
      if (className.includes("Quiz") || className.includes("quiz"))
        score += 250;

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  function findQuestionElementByNumber(
    questionNumber,
    usedElements,
    root = document.body,
  ) {
    const candidates = Array.from(
      root?.querySelectorAll(
        [
          '[class*="Question"]',
          '[class*="question"]',
          '[class*="Quiz"]',
          '[class*="quiz"]',
          "section",
          "article",
          "div",
          "li",
        ].join(", "),
      ) || [],
    );

    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      if (usedElements.has(el) || !isVisibleElement(el)) continue;
      if (getVisibleQuestionNumber(el) !== questionNumber) continue;

      const text = el.innerText || el.textContent || "";
      if (text.length > 4000) continue;

      const className = String(el.className || "");
      let score = 4000 - text.length;
      if (className.includes("Question") || className.includes("question"))
        score += 500;
      if (className.includes("Quiz") || className.includes("quiz"))
        score += 250;

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  function normalizeSortingToken(text) {
    return String(text || "")
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function sameSortingTokens(left, right) {
    if (left.length !== right.length) return false;
    const sortedLeft = left.map(normalizeSortingToken).sort();
    const sortedRight = right.map(normalizeSortingToken).sort();
    return sortedLeft.every(
      (value, index) => value && value === sortedRight[index],
    );
  }

  function getSortingAnswerTokens(question) {
    return (Array.isArray(question?.answers) ? question.answers : []).flatMap(
      (answer) =>
        String(answer || "")
          .split("/")
          .map((token) => token.trim())
          .filter(Boolean),
    );
  }

  function hasClickableSortingAnswerTokens(question, visibleTokens) {
    const availableCounts = new Map();
    visibleTokens.map(normalizeSortingToken).forEach((token) => {
      if (!token) return;
      availableCounts.set(token, (availableCounts.get(token) || 0) + 1);
    });

    return getSortingAnswerTokens(question).every((answerToken) => {
      const token = normalizeSortingToken(answerToken);
      const count = availableCounts.get(token) || 0;
      if (count <= 0) return false;
      availableCounts.set(token, count - 1);
      return true;
    });
  }

  function questionMatchesVisibleSortingPrompt(question, searchRoot) {
    const candidates = Array.from(
      searchRoot?.querySelectorAll(
        [
          '[class*="SortingAQuestionBuilder__questionBox"]',
          '[class*="QuestionBuilder__questionBox"]',
          '[class*="QuestionView__questionBox"]',
          '[class*="questionBox"]',
        ].join(", "),
      ) || [],
    ).filter(isVisibleElement);

    return candidates.some((candidate) =>
      matchesQuestionSignature(candidate.textContent, question),
    );
  }

  function getVisibleSortingLists(searchRoot, activeQuestionRange = null) {
    const lists = Array.from(
      searchRoot.querySelectorAll('[class*="sortStringList"]'),
    )
      .filter(isVisibleElement)
      .filter((list) => list.querySelectorAll("li").length > 0);
    if (!isSingleQuestionProgress(activeQuestionRange)) return lists;
    return lists.filter(isInViewport);
  }

  function hasVisibleSortingPrompt(searchRoot, activeQuestionRange = null) {
    const candidates = Array.from(
      searchRoot.querySelectorAll(
        '[class*="SortingAQuestionBuilder__questionBox"]',
      ),
    ).filter(isVisibleElement);

    if (isSingleQuestionProgress(activeQuestionRange)) {
      return (
        candidates.some(isInViewport) ||
        getVisibleSortingLists(searchRoot, activeQuestionRange).length > 0
      );
    }

    const text = searchRoot?.innerText || searchRoot?.textContent || "";
    return text.includes("並べ替え") || candidates.length > 0;
  }

  function findActiveSortingPair(searchRoot, activeQuestionRange = null) {
    const lists = getVisibleSortingLists(searchRoot, activeQuestionRange);
    if (lists.length !== 1) return null;

    const list = lists[0];
    const visibleTokens = Array.from(list.querySelectorAll("li"))
      .filter(isVisibleElement)
      .map((li) => li.textContent);
    if (visibleTokens.length === 0) return null;

    const questionIndex = questionsList.findIndex((question) => {
      return (
        String(question.type || "")
          .toLowerCase()
          .includes("sort") &&
        questionMatchesActiveOrder(question, activeQuestionRange) &&
        Array.isArray(question.answers) &&
        sameSortingTokens(question.answers, visibleTokens)
      );
    });
    const fallbackIndex =
      questionIndex !== -1
        ? questionIndex
        : questionsList.findIndex((question) => {
            return (
              String(question.type || "")
                .toLowerCase()
                .includes("sort") &&
              questionMatchesActiveOrder(question, activeQuestionRange, true) &&
              questionMatchesVisibleSortingPrompt(question, searchRoot) &&
              hasClickableSortingAnswerTokens(question, visibleTokens)
            );
          });
    if (fallbackIndex === -1) return null;

    return {
      data: questionsList[fallbackIndex],
      element: findQuestionContainer(list, questionsList[fallbackIndex].type),
    };
  }

  function narrowPairsToCurrentProgress(pairs, activeQuestionRange) {
    if (
      !activeQuestionRange ||
      activeQuestionRange.start !== activeQuestionRange.end ||
      pairs.length <= 1
    ) {
      return pairs;
    }

    const currentPromptSignatures = Array.from(
      document.querySelectorAll(getQuestionTextSelector()),
    )
      .filter(isInViewport)
      .map((el) => normalizeSignature(el.textContent, 120))
      .filter(Boolean);
    const promptMatchedPairs = pairs.filter((pair) => {
      const signatures = getQuestionSignatures(pair.data);
      return signatures.some((signature) => {
        return currentPromptSignatures.some((promptSig) => {
          return (
            promptSig === signature ||
            promptSig.includes(signature) ||
            signature.includes(promptSig)
          );
        });
      });
    });
    if (promptMatchedPairs.length === 1) return promptMatchedPairs;

    const viewportPairs = pairs.filter((pair) => isInViewport(pair.element));
    if (viewportPairs.length === 1) return viewportPairs;

    const currentNumberViewportPairs = viewportPairs.filter((pair) => {
      return (
        getVisibleQuestionNumber(pair.element) === activeQuestionRange.start
      );
    });
    if (currentNumberViewportPairs.length === 1)
      return currentNumberViewportPairs;

    if (pairs.every((pair) => pair.data?.isAutoAdvance)) {
      const hasShuffledQuestions = pairs.some(
        (pair) => pair.data?.shuffleQuestions === true,
      );
      if (
        hasShuffledQuestions &&
        activeQuestionRange.totalMatchesQuestionList
      ) {
        return [];
      }

      const currentPair = pairs.find(
        (pair) => Number(pair.data.displayOrder) === activeQuestionRange.start,
      );
      return currentPair ? [currentPair] : pairs;
    }

    return [];
  }

  function findActiveQuestions() {
    const activeQuestionRange = getCurrentProgressQuestionRange();
    const searchRoot = findAutoAdvanceQuestionScope(activeQuestionRange);
    const activeSortingPair = findActiveSortingPair(
      searchRoot,
      activeQuestionRange,
    );
    if (activeSortingPair) return [activeSortingPair];
    if (
      getVisibleSortingLists(searchRoot, activeQuestionRange).length > 0 ||
      hasVisibleSortingPrompt(searchRoot, activeQuestionRange)
    )
      return [];

    const textElements = searchRoot.querySelectorAll(getQuestionTextSelector());
    const visibleElements = Array.from(textElements).filter((el) => {
      return isVisibleElement(el);
    });

    const matchedPairs = [];
    const usedIndices = new Set();
    const usedElements = new Set();

    const currentMediaSignatures = getCurrentMediaSignatures(searchRoot);
    const mediaMatchedIndex = findQuestionIndexByMediaSignatures(
      currentMediaSignatures,
      usedIndices,
      activeQuestionRange,
    );
    if (mediaMatchedIndex !== -1) {
      const question = questionsList[mediaMatchedIndex];
      const numberedElement = isSingleQuestionProgress(activeQuestionRange)
        ? findQuestionElementByNumber(
            activeQuestionRange.start,
            usedElements,
            searchRoot,
          )
        : null;
      const textElement =
        numberedElement ||
        findQuestionElementByText(question, usedElements, searchRoot);
      const container = textElement
        ? findQuestionContainer(textElement, question.type)
        : document.body;
      return narrowPairsToCurrentProgress(
        [{ element: container, data: question }],
        activeQuestionRange,
      );
    }

    // Phase 1: Exact Signature Match
    for (const el of visibleElements) {
      const domSig = normalizeSignature(el.textContent);
      const idx = findQuestionIndexForElement(
        el,
        usedIndices,
        (q) => {
          return getQuestionSignatures(q).some(
            (signature) => signature === domSig,
          );
        },
        activeQuestionRange,
      );

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
      const idx = findQuestionIndexForElement(
        el,
        usedIndices,
        (q) => {
          return getQuestionSignatures(q).some((signature) => {
            return domSig.includes(signature) || signature.includes(domSig);
          });
        },
        activeQuestionRange,
      );

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
      const idx = findQuestionIndexForElement(
        el,
        usedIndices,
        (q) => {
          return getQuestionSignatures(q).some((signature) => {
            const cleanXml = signature.slice(0, 20);
            return cleanXml && domSig.includes(cleanXml);
          });
        },
        activeQuestionRange,
      );

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
      const el = findQuestionElementByText(question, usedElements, searchRoot);
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
        if (!questionMatchesActiveOrder(question, activeQuestionRange, true))
          continue;

        const questionNumber = Number(question.displayOrder);
        const el = findQuestionElementByNumber(
          questionNumber,
          usedElements,
          searchRoot,
        );
        const container = el
          ? findQuestionContainer(el, question.type)
          : document.body;

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
        return (
          !usedIndices.has(i) &&
          ((configuredQuestionNo &&
            String(question.questionNo) === configuredQuestionNo) ||
            (questionsList.length === 1 &&
              isDictationLayoutVisible() &&
              (lowerType.includes("dictation") ||
                lowerType.includes("dectation"))))
        );
      });

      if (idx !== -1) {
        const question = questionsList[idx];
        const container = findQuestionContainer(document.body, question.type);
        usedIndices.add(idx);
        matchedPairs.push({ element: container, data: question });
      }
    }

    return narrowPairsToCurrentProgress(matchedPairs, activeQuestionRange);
  }

  function injectStyles() {
    const styleId = "toggle-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
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
            #question-hub-control {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 100003;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #fff;
                border: 1px solid #d8d8d8;
                border-radius: 6px;
                box-shadow: 0 4px 18px rgba(0,0,0,0.18);
                font-family: inherit;
                max-width: min(560px, calc(100vw - 32px));
            }
            #question-hub-control button {
                height: 32px;
                padding: 0 12px;
                border: 1px solid #d4d4d4;
                border-radius: 4px;
                background: #fff;
                color: #4b5563;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
            }
            #question-hub-speed-control {
                display: flex;
                align-items: center;
                gap: 0;
                padding: 2px;
                border: 1px solid #c9c9c9;
                border-radius: 5px;
                background: #f5f5f5;
            }
            #question-hub-speed-control button {
                height: 28px;
                min-width: 44px;
                padding: 0 10px;
                border: 0;
                border-radius: 3px;
                background: transparent;
                color: #555;
                box-shadow: none;
            }
            #question-hub-speed-control button.active {
                background: #2b2b2b;
                color: #fff;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
            }
            #question-hub-control button:hover:not(:disabled) {
                background: #f3f4f6;
                border-color: #9ca3af;
                color: #111827;
                box-shadow: 0 1px 4px rgba(0,0,0,0.12);
            }
            #question-hub-speed-control button.active:hover:not(:disabled) {
                background: #111827;
                color: #fff;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22);
            }
            #question-hub-control button:disabled {
                cursor: default;
                opacity: 0.55;
            }
            #question-hub-control .ae-question-hub-primary,
            #question-hub-run-btn:not(:disabled) {
                background: #ff0000;
                border-color: #ff0000;
                color: #fff;
                box-shadow: 0 1px 5px rgba(255,0,0,0.22);
            }
            #question-hub-control .ae-question-hub-primary:hover:not(:disabled),
            #question-hub-run-btn:hover:not(:disabled) {
                background: #d90000;
                border-color: #d90000;
                color: #fff;
                box-shadow: 0 2px 8px rgba(255,0,0,0.28);
            }
            #question-hub-control #question-hub-run-btn:hover:not(:disabled) {
                background: #d90000 !important;
                border-color: #d90000 !important;
                color: #fff !important;
                box-shadow: 0 2px 8px rgba(255,0,0,0.28) !important;
            }
            #question-hub-status {
                min-width: 64px;
                color: #555;
                font-size: 12px;
                font-weight: bold;
                white-space: nowrap;
            }
            a.ae-question-hub-selected {
                position: relative;
                outline: 3px solid #ff0000 !important;
                outline-offset: 2px;
                background-color: #fff2f2 !important;
                box-shadow: 0 0 0 4px rgba(255,0,0,0.12) !important;
            }
            a.ae-question-hub-selected::after {
                content: "選択済み";
                position: absolute;
                right: 4px;
                top: -18px;
                padding: 2px 6px;
                border-radius: 3px;
                background: #ff0000;
                color: #fff;
                font-size: 10px;
                line-height: 1.2;
                white-space: nowrap;
                pointer-events: none;
            }
        `;
    document.head.appendChild(style);
  }

  function createControls(header) {
    if (document.getElementById("solve-btn")) return;

    injectStyles();

    let parentContainer;
    const isQuestionHeader = String(header.className || "").includes(
      "QuestionHeader__innerContainer",
    );
    const backButtonDiv = isQuestionHeader
      ? null
      : Array.from(header.querySelectorAll("div")).find(
          (el) =>
            el.textContent.includes("戻る") ||
            el.className.toLowerCase().includes("back"),
        );

    if (backButtonDiv) {
      parentContainer = backButtonDiv;
      parentContainer.style.display = "flex";
      parentContainer.style.alignItems = "center";
      parentContainer.style.gap = "20px";
    } else {
      parentContainer = document.createElement("div");
      parentContainer.id = "controls-container";
      parentContainer.style.display = "flex";
      parentContainer.style.alignItems = "center";
      parentContainer.style.gap = "16px";
      parentContainer.style.marginLeft = "8px";
      parentContainer.style.marginRight = "8px";
      parentContainer.style.position = "relative";
      parentContainer.style.zIndex = "100002";

      if (isQuestionHeader) {
        parentContainer.style.flex = "0 0 auto";
        const right = header.querySelector('[class*="QuestionHeader__right"]');
        header.insertBefore(parentContainer, right);
      } else {
        header.appendChild(parentContainer);
      }
    }

    const control = document.createElement("div");
    control.id = "speed-control";
    control.className = "segmented-control";

    const slowSeg = document.createElement("div");
    slowSeg.id = "slow-seg";
    slowSeg.className = "segment" + (!isFastMode ? " active" : "");
    slowSeg.textContent = "低速";
    slowSeg.onclick = (e) => {
      e.stopPropagation();
      if (isAutoMode || isSolving) return;
      setFastMode(false);
    };

    const fastSeg = document.createElement("div");
    fastSeg.id = "fast-seg";
    fastSeg.className = "segment" + (isFastMode ? " active" : "");
    fastSeg.textContent = "高速";
    fastSeg.onclick = (e) => {
      e.stopPropagation();
      if (isAutoMode || isSolving) return;
      setFastMode(true);
    };

    control.appendChild(slowSeg);
    control.appendChild(fastSeg);

    const solveBtn = document.createElement("button");
    solveBtn.id = "solve-btn";
    solveBtn.style.height = "36px";
    solveBtn.style.padding = "0 16px";
    solveBtn.style.backgroundColor = "#ff0000";
    solveBtn.style.color = "white";
    solveBtn.style.border = "none";
    solveBtn.style.borderRadius = "2px";
    solveBtn.style.fontSize = "14px";
    solveBtn.style.fontFamily = "inherit";
    solveBtn.style.cursor = "pointer";
    solveBtn.style.boxShadow = "0 1px 6px rgba(0,0,0,0.12)";
    solveBtn.style.transition = "all 0.2s";

    parentContainer.appendChild(solveBtn);
    parentContainer.appendChild(control);

    return parentContainer;
  }

  function findControlsHeader() {
    const standardHeader = document.querySelector(
      '[class*="AppHeader__fixed-top"] > div',
    );
    if (standardHeader) return standardHeader;

    return document.querySelector(
      [
        '[class*="AppPc__common_inner"]',
        '[class*="AppSp__common_inner"]',
        '[class*="common_header_inner"]',
        '[class*="ControlBox__root"]',
        '[class*="QuestionHeader__innerContainer"]',
      ].join(", "),
    );
  }

  function updateUIStates() {
    const btn = document.getElementById("solve-btn");
    const control = document.getElementById("speed-control");
    const slowSeg = document.getElementById("slow-seg");
    const fastSeg = document.getElementById("fast-seg");
    if (!btn || !control) return;

    control.style.display = isAutoMode || isSolving ? "none" : "flex";

    if (slowSeg) slowSeg.className = "segment" + (!isFastMode ? " active" : "");
    if (fastSeg) fastSeg.className = "segment" + (isFastMode ? " active" : "");

    if (isSolving || isAutoMode) {
      btn.textContent = "処理中...";
      btn.style.backgroundColor = "#666";
      btn.onclick = null;
      btn.style.cursor = "wait";
      if (isSolving) return;
    }

    const activePairs = findActiveQuestions();

    if (!activePairs || activePairs.length === 0) {
      if (isAutoMode) return;
      btn.textContent = "検索中...";
      btn.style.backgroundColor = "#999";
      btn.onclick = null;
      btn.style.cursor = "default";
      return;
    }

    const compositeSig = getCompositeRunKey(activePairs);
    const isNewQuestion = compositeSig !== lastSolvedSignature;
    const estimatedSeconds = getEstimatedTime(
      activePairs,
      isFastMode,
      isNewQuestion,
    );

    if (isAutoMode) {
      const resumeWait = nextAutoSolveAllowedAt - Date.now();
      if (resumeWait > 0) {
        scheduleAutoSolveResume(resumeWait);
        return;
      }

      if (isNewQuestion) {
        console.log("Auto-Mode: New questions detected. Triggering solver.");
        lastSolvedSignature = compositeSig;
        runSolver(activePairs, isNewQuestion);
      }
      return;
    }

    btn.textContent = isFastMode
      ? "自動入力"
      : `自動入力 (~${estimatedSeconds}秒)`;
    btn.style.backgroundColor = "#ff0000";
    btn.style.cursor = "pointer";

    btn.onclick = () => {
      setAutoMode(true);
      lastSolvedSignature = compositeSig;
      runSolver(activePairs, isNewQuestion);
    };
  }

  function ensureSolveButton() {
    if (ensureQuestionHubControls()) return;

    const finishLink = document.querySelector("a.btn");
    if (finishLink) {
      const speedCtrl = document.getElementById("speed-control");
      const solveBtn = document.getElementById("solve-btn");
      if (speedCtrl) speedCtrl.style.display = "none";
      if (solveBtn) solveBtn.style.display = "none";

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

    const resultText = document.body?.innerText || "";
    const isGradedPage =
      document.querySelector('[class*="ScoreView__scoreViewContainer"]') ||
      ((resultText.includes("点") || resultText.includes("正解数")) &&
        findTransitionButton(["終了"]));
    if (isGradedPage) {
      const speedCtrl = document.getElementById("speed-control");
      const solveBtn = document.getElementById("solve-btn");
      if (speedCtrl) speedCtrl.style.display = "none";
      if (solveBtn) solveBtn.style.display = "none";
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
    const initialProgressRange = getCurrentProgressQuestionRange();

    try {
      console.log(`Running solver for ${matchedPairs.length} questions...`);
      window.__ACADEMIC_EXPRESS_FAST_MODE__ = isFastMode;

      const hasAutoAdvancePair = matchedPairs.some(isAutoAdvancePair);
      let readingWait = 0;
      if (!isFastMode && isNew && !hasAutoAdvancePair) {
        const totalText = matchedPairs
          .map((p) => p.data.rawText || "")
          .join(" ");
        readingWait = getWaitTime("READING_WAIT", totalText);
      }
      let autoAdvancePaceWait = 0;
      if (hasAutoAdvancePair) {
        const paceWait = getWaitTime("AUTO_ADVANCE_WAIT");
        const elapsed = Date.now() - lastAutoAdvanceSolvedAt;
        if (elapsed > 0 && elapsed < paceWait) {
          autoAdvancePaceWait = paceWait - elapsed;
        }
      }
      const totalEstimatedMs = getEstimatedDurationMs(
        matchedPairs,
        isFastMode,
        isNew,
        {
          autoAdvancePaceWaitMs: autoAdvancePaceWait,
          readingWaitMs: readingWait,
        },
      );
      startHeaderAnimation(totalEstimatedMs, {
        minimumDurationMs: hasAutoAdvancePair ? 0 : undefined,
      });
      setGlobalLock(true);

      // Skip reading delay for vocabulary tests
      if (readingWait > 0) {
        console.log(`Initial reading delay: ${readingWait}ms`);
        await sleep(readingWait);
      }

      let autoAdvance = false;
      let progressedDuringSolve = false;
      for (let i = 0; i < matchedPairs.length; i++) {
        const pair = matchedPairs[i];
        const pairAutoAdvances = isAutoAdvancePair(pair);
        if (pairAutoAdvances) autoAdvance = true;
        if (pairAutoAdvances) {
          await waitForAutoAdvancePace();
        }
        const preSolveWait = getPreSolveWait(pair);
        if (preSolveWait > 0) {
          await sleep(preSolveWait);
        }
        const solved = await solve(
          pair.data.answers,
          pair.data.type,
          pair.element,
          pair.data,
        );
        if (solved === false && isDictationPair(pair)) {
          console.warn(
            "Solver deferred because the current question is not ready.",
          );
          lastSolvedSignature = "";
          isSolving = false;
          scheduleAutoSolveResume(getWaitTime("DEBOUNCE_WAIT"));
          return;
        }
        if (pairAutoAdvances) {
          lastAutoAdvanceSolvedAt = Date.now();
        }
        const postSolveWait = pairAutoAdvances
          ? getWaitTime("AUTO_ADVANCE_WAIT")
          : getWaitTime("SOLVE_INTERVAL");
        if (hasProgressAdvancedFrom(initialProgressRange)) {
          completeHeaderProgress();
          progressedDuringSolve = true;
          break;
        }
        if (postSolveWait > 0) {
          progressedDuringSolve = await waitForPostSolveSettle(
            postSolveWait,
            initialProgressRange,
          );
        }
        if (progressedDuringSolve) {
          progressedDuringSolve = true;
          break;
        }
      }

      if (isAutoMode) {
        if (autoAdvance || progressedDuringSolve) {
          console.log(
            "Detecting auto-advance question, skipping manual transition click.",
          );
          const resumeWait = getWaitTime("AUTO_SOLVE_RESUME_WAIT");
          nextAutoSolveAllowedAt = Date.now() + resumeWait;
          isSolving = false;
          scheduleAutoSolveResume(resumeWait);
          return;
        }
        await handleTransition();
      }
    } finally {
      isSolving = false;
      setGlobalLock(false);
      await finishHeaderAnimation();
      resetHeaderProgress();
      updateUIStates();
    }
  }

  async function handleTransition() {
    const wasSolving = isSolving;
    isSolving = true;
    isTransitioning = true;

    async function waitForTransitionSettle() {
      const settleWait = getWaitTime("TRANSITION_WAIT");
      await sleep(settleWait);
    }

    try {
      console.log("Attempting transition...");
      await sleep(getWaitTime("TRANSITION_WAIT"));

      const nextBtn = document.getElementById("nextButton");

      if (nextBtn && !nextBtn.disabled) {
        console.log("Transition: Clicking Next Button.");
        completeHeaderProgress();
        simulateClick(nextBtn);
        await waitForTransitionSettle();
        return;
      }

      const button = findTransitionButton([
        "採点",
        "判定",
        "続ける",
        "終了",
        "完了",
      ]);
      if (button) {
        const buttonText = button.textContent.trim();
        console.log(`Transition: Clicking "${buttonText}" Button.`);
        completeHeaderProgress();
        simulateClick(button);
        await waitForTransitionSettle();
        const resultText = document.body?.innerText || "";
        const finishButton =
          !buttonText.includes("終了") &&
          (resultText.includes("点") || resultText.includes("正解数"))
            ? findTransitionButton(["終了"])
            : null;
        if (finishButton) {
          console.log(
            `Transition: Clicking "${finishButton.textContent.trim()}" Button.`,
          );
          completeHeaderProgress();
          simulateClick(finishButton);
          await waitForTransitionSettle();
          isAutoMode = false;
        }
        return;
      }

      const quitBtn = document.getElementById("quitButton");
      if (quitBtn) {
        console.log("Transition: Clicking Finish/Quit Button.");
        completeHeaderProgress();
        simulateClick(quitBtn);
        await waitForTransitionSettle();
        isAutoMode = false;
        return;
      }

      const link = document.querySelector("a.btn");
      if (link) {
        console.log("Transition: Clicking .btn Link (Finish).");
        completeHeaderProgress();
        link.click();
        await waitForTransitionSettle();
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
    const buttons = Array.from(
      document.querySelectorAll(
        [
          "button",
          'input[type="button"]',
          'input[type="submit"]',
          "a",
          '[role="button"]',
        ].join(", "),
      ),
    ).filter(isVisibleElement);
    return buttons.find((button) => {
      const text = [
        button.textContent,
        button.value,
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ");
      return keywords.some((keyword) => text.includes(keyword));
    });
  }

  setTimeout(() => ensureSolveButton(), 0);
})();
