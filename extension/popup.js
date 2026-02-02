document.addEventListener('DOMContentLoaded', async () => {
    const domainDisplay = document.getElementById('domain-display');
    const enableBtn = document.getElementById('enable-btn');
    const disableBtn = document.getElementById('disable-btn');
    const statusMsg = document.getElementById('status-msg');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.startsWith('http')) {
        domainDisplay.textContent = "このページでは使用できません";
        enableBtn.disabled = true;
        return;
    }

    const url = new URL(tab.url);
    const origin = url.origin;
    domainDisplay.textContent = origin;

    // Check if we already have permission for this origin
    const permissions = {
        origins: [origin + "/*"]
    };

    async function checkState() {
        const hasPermission = await chrome.permissions.contains(permissions);

        if (hasPermission) {
            enableBtn.style.display = 'none';
            disableBtn.style.display = 'block';
            domainDisplay.innerHTML = `${origin} <span class="active-badge">有効</span>`;
        } else {
            enableBtn.style.display = 'block';
            disableBtn.style.display = 'none';
            domainDisplay.textContent = origin;
        }
    }

    await checkState();

    enableBtn.addEventListener('click', async () => {
        try {
            const granted = await chrome.permissions.request(permissions);
            if (granted) {
                statusMsg.textContent = "設定中...";
                await registerScripts(origin);
                statusMsg.textContent = "完了！ページをリロードします...";
                setTimeout(() => {
                    chrome.tabs.reload(tab.id);
                    window.close();
                }, 1000);
            } else {
                statusMsg.textContent = "キャンセルされました";
            }
        } catch (e) {
            console.error(e);
            statusMsg.textContent = "エラーが発生しました";
        }
    });

    disableBtn.addEventListener('click', async () => {
        try {
            // Note: removing permissions doesn't automatically unregister scripts in MV3 straightforwardly 
            // without using scripting.unregisterContentScripts with specific IDs.
            // We'll rely on permission removal for now, but strictly speaking we should also unregister.

            await chrome.permissions.remove(permissions);

            // Also attempt to unregister scripts for this scope if possible, 
            // but since we register with static IDs 'main-script' and 'xhr-intercept' 
            // which likely apply properly due to matches. 
            // Actually, dynamic scripts persists. We might need a more complex ID strategy 
            // if we want to selectively disable per site effectively via API, 
            // but for now permission removal stops future injection permissions effectively.

            statusMsg.textContent = "無効化しました";
            setTimeout(() => {
                chrome.tabs.reload(tab.id);
                window.close();
            }, 1000);
        } catch (e) {
            console.error(e);
            statusMsg.textContent = "エラー";
        }
    });

    async function registerScripts(targetOrigin) {
        // We configure the scripts to run on the specific origin
        // Note: multiple calls to registerContentScripts with SAME IDs usually update them so it works for multiple origins?
        // Wait, 'matches' must be an array. If we want to ADD an origin, we need to know the EXISTING origins.
        // Or we generates unique IDs per origin? "main-script-" + sanitisedOrigin.
        // Let's use unique IDs to allow multiple sites to be active simultaneously.

        const cleanOrigin = targetOrigin.replace(/[^a-zA-Z0-9]/g, '');
        const mainScriptId = `main-${cleanOrigin}`;
        const xhrScriptId = `xhr-${cleanOrigin}`;

        // Ensure we don't register duplicates error
        try {
            await chrome.scripting.unregisterContentScripts({ ids: [mainScriptId, xhrScriptId] });
        } catch (e) { /* ignore */ }

        await chrome.scripting.registerContentScripts([
            {
                id: mainScriptId,
                matches: [targetOrigin + "/*"],
                js: ["solvers.js", "content.js"],
                runAt: "document_start"
            },
            {
                id: xhrScriptId,
                matches: [targetOrigin + "/*"],
                js: ["xhr-intercept.js"],
                world: "MAIN",
                runAt: "document_start"
            }
        ]);
    }

    // --- List Enabled Sites ---
    const listContainer = document.getElementById('enabled-list');

    async function updateEnabledList() {
        const currentPermissions = await chrome.permissions.getAll();
        const origins = currentPermissions.origins || [];

        listContainer.innerHTML = '';

        const meaningfulOrigins = origins.filter(o => o.includes('://') && !o.includes('<all_urls>'));

        // Group by domain
        const domainMap = {}; // domain -> [origin1, origin2...]

        meaningfulOrigins.forEach(originStr => {
            try {
                const parts = originStr.split('://');
                if (parts.length < 2) return;

                let domain = parts[1];
                if (domain.includes('/')) {
                    domain = domain.split('/')[0];
                }

                if (!domainMap[domain]) {
                    domainMap[domain] = [];
                }
                domainMap[domain].push(originStr);
            } catch (e) { /* ignore */ }
        });

        const domains = Object.keys(domainMap);

        if (domains.length === 0) {
            const li = document.createElement('li');
            li.textContent = "(なし)";
            li.style.color = "#999";
            listContainer.appendChild(li);
            return;
        }

        domains.forEach(domain => {
            const li = document.createElement('li');
            li.style.cssText = "padding: 4px 0; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center;";

            const span = document.createElement('span');
            span.textContent = domain;

            const delBtn = document.createElement('button');
            delBtn.textContent = "×";
            delBtn.className = "delete-btn";
            delBtn.title = "削除";
            delBtn.style.width = "auto"; // reset width:100% from implicit styles if any
            delBtn.style.margin = "0 0 0 5px";

            delBtn.onclick = async () => {
                const originsToRemove = domainMap[domain];
                if (confirm(`「${domain}」の設定を削除しますか？`)) {
                    try {
                        // Remove permissions
                        await chrome.permissions.remove({ origins: originsToRemove });

                        // Unregister scripts
                        // Reconstruct IDs from origins. OriginStr is like "https://example.com/*"
                        const idsToRemove = [];
                        originsToRemove.forEach(o => {
                            const cleanOriginStr = o.replace(/\/\*$/, ''); // remove trailing /*
                            const cleanOriginId = cleanOriginStr.replace(/[^a-zA-Z0-9]/g, '');
                            idsToRemove.push(`main-${cleanOriginId}`);
                            idsToRemove.push(`xhr-${cleanOriginId}`);
                        });

                        try {
                            await chrome.scripting.unregisterContentScripts({ ids: idsToRemove });
                        } catch (e) { console.log("Unregister info:", e); }

                        // Refresh UI
                        await checkState();
                        await updateEnabledList();

                        // Reload if current tab matches
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab && tab.url && tab.url.includes(domain)) {
                            chrome.tabs.reload(tab.id);
                        }
                    } catch (e) {
                        console.error(e);
                        statusMsg.textContent = "削除エラー";
                    }
                }
            };

            li.appendChild(span);
            li.appendChild(delBtn);
            listContainer.appendChild(li);
        });
    }

    updateEnabledList();
});
