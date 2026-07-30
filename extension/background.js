// Academic Express Auto Answer - Background Service Worker
// Processes captured XHR data from content script

importScripts('parser.js', 'update-checker.js');

const UPDATE_ALARM_NAME = 'check-for-extension-update';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECKER = AcademicExpressUpdateChecker;

async function updateActionBadge(updateState) {
    const currentVersion = chrome.runtime.getManifest().version;
    const hasUpdate = updateState?.latestVersion
        && UPDATE_CHECKER.shouldNotify(
            currentVersion,
            updateState.latestVersion,
            updateState.dismissedVersion
        );

    await chrome.action.setBadgeBackgroundColor({ color: '#16803a' });
    await chrome.action.setBadgeText({ text: hasUpdate ? 'NEW' : '' });
}

async function getStoredUpdateState() {
    const { updateState } = await chrome.storage.local.get('updateState');
    return updateState || {};
}

async function checkForUpdate(force = false) {
    const previousState = await getStoredUpdateState();
    const checkedRecently = Number.isFinite(previousState.checkedAt)
        && Date.now() - previousState.checkedAt < UPDATE_CHECK_INTERVAL_MS;

    if (!force && checkedRecently) {
        await updateActionBadge(previousState);
        return { success: true, updateState: previousState, cached: true };
    }

    try {
        const response = await fetch(UPDATE_CHECKER.RELEASE_API_URL, {
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API returned ${response.status}.`);
        }

        const latestRelease = UPDATE_CHECKER.parseLatestRelease(await response.json());
        if (!latestRelease) {
            throw new Error('The latest GitHub release has an unsupported version.');
        }

        const updateState = {
            ...previousState,
            ...latestRelease,
            checkedAt: Date.now()
        };

        await chrome.storage.local.set({ updateState });
        await updateActionBadge(updateState);
        return { success: true, updateState, cached: false };
    } catch (error) {
        console.warn('Failed to check for an extension update:', error);
        await updateActionBadge(previousState);
        return {
            success: false,
            updateState: previousState,
            error: '最新版を確認できませんでした。時間をおいて再度お試しください。'
        };
    }
}

async function dismissUpdate(version) {
    const updateState = await getStoredUpdateState();

    if (UPDATE_CHECKER.normalizeVersion(version) !== UPDATE_CHECKER.normalizeVersion(updateState.latestVersion)) {
        throw new Error('Only the currently known update can be dismissed.');
    }

    const nextState = {
        ...updateState,
        dismissedVersion: UPDATE_CHECKER.normalizeVersion(version)
    };
    await chrome.storage.local.set({ updateState: nextState });
    await updateActionBadge(nextState);
    return nextState;
}

async function initializeUpdateChecks() {
    await chrome.alarms.create(UPDATE_ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: 24 * 60
    });
    await checkForUpdate();
}

chrome.runtime.onInstalled.addListener(() => {
    initializeUpdateChecks().catch(error => {
        console.warn('Failed to initialize extension update checks:', error);
    });
});

chrome.runtime.onStartup.addListener(() => {
    initializeUpdateChecks().catch(error => {
        console.warn('Failed to initialize extension update checks:', error);
    });
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === UPDATE_ALARM_NAME) {
        checkForUpdate().catch(error => {
            console.warn('Scheduled extension update check failed:', error);
        });
    }
});

async function processXHRData(url, responseText, senderId) {
    const { parsed, dataType } = AcademicExpressParser.parseQuestionData(responseText);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_UPDATE_STATE') {
        checkForUpdate()
            .then(sendResponse);
        return true;
    }

    if (message.type === 'CHECK_FOR_UPDATE') {
        checkForUpdate(true)
            .then(sendResponse);
        return true;
    }

    if (message.type === 'DISMISS_UPDATE') {
        dismissUpdate(message.version)
            .then(updateState => sendResponse({ success: true, updateState }))
            .catch(error => sendResponse({ success: false, error: String(error) }));
        return true;
    }

    if (message.type === 'GET_QUESTION_DATA') {
        chrome.storage.session.get(['questionData', 'dataUrl', 'timestamp'])
            .then(result => {
                sendResponse(result);
            });
        return true;
    }

    if (message.type === 'XHR_CAPTURED') {
        const tabId = sender.tab?.id;
        processXHRData(message.url, message.responseText, tabId)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('Failed to process captured XHR data:', error);
                sendResponse({ success: false, error: String(error) });
            });
        return true;
    }
});
