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
            // Remove permissions
            const removed = await chrome.permissions.remove(permissions);

            if (removed) {
                // Unregister scripts for this origin
                const cleanOrigin = origin.replace(/[^a-zA-Z0-9]/g, '');
                const idsToRemove = [`main-${cleanOrigin}`, `xhr-${cleanOrigin}`];

                try {
                    await chrome.scripting.unregisterContentScripts({ ids: idsToRemove });
                } catch (e) { /* ignore */ }

                statusMsg.textContent = "無効化しました";
                setTimeout(() => {
                    chrome.tabs.reload(tab.id);
                    window.close();
                }, 1000);
            } else {
                statusMsg.textContent = "削除に失敗しました（固定権限の可能性）";
            }
        } catch (e) {
            console.error(e);
            statusMsg.textContent = "エラー";
        }
    });

    async function registerScripts(targetOrigin) {
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

    // 固定権限（manifest.jsonのhost_permissionsから取得）
    const manifest = chrome.runtime.getManifest();
    const FIXED_ORIGINS = manifest.host_permissions || [];

    function isFixedOrigin(originStr) {
        return FIXED_ORIGINS.some(fixed => {
            // ワイルドカードを正規表現に変換して比較
            const pattern = fixed.replace(/\*/g, '.*');
            return new RegExp(`^${pattern}$`).test(originStr) || fixed === originStr;
        });
    }

    async function updateEnabledList() {
        const currentPermissions = await chrome.permissions.getAll();
        const origins = currentPermissions.origins || [];

        listContainer.innerHTML = '';

        const meaningfulOrigins = origins.filter(o => o.includes('://') && !o.includes('<all_urls>'));

        // Group by domain
        const domainMap = {}; // domain -> { origins: [], isFixed: boolean }

        meaningfulOrigins.forEach(originStr => {
            try {
                const parts = originStr.split('://');
                if (parts.length < 2) return;

                let domain = parts[1];
                if (domain.includes('/')) {
                    domain = domain.split('/')[0];
                }

                if (!domainMap[domain]) {
                    domainMap[domain] = { origins: [], isFixed: false };
                }
                domainMap[domain].origins.push(originStr);

                // いずれかのoriginが固定なら、そのドメインは固定扱い
                if (isFixedOrigin(originStr)) {
                    domainMap[domain].isFixed = true;
                }
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

            const domainInfo = domainMap[domain];

            if (domainInfo.isFixed) {
                // 固定権限の場合
                span.innerHTML = `${domain} <span style="color:#888;font-size:11px;">(固定)</span>`;
                li.appendChild(span);
            } else {
                // 動的権限の場合は削除ボタンを表示
                span.textContent = domain;

                const delBtn = document.createElement('button');
                delBtn.textContent = "×";
                delBtn.className = "delete-btn";
                delBtn.title = "削除";
                delBtn.style.width = "auto";
                delBtn.style.margin = "0 0 0 5px";

                delBtn.onclick = async () => {
                    const originsToRemove = domainInfo.origins;
                    if (confirm(`「${domain}」の設定を削除しますか？`)) {
                        try {
                            // Remove permissions
                            await chrome.permissions.remove({ origins: originsToRemove });

                            // Unregister scripts
                            const idsToRemove = [];
                            originsToRemove.forEach(o => {
                                const cleanOriginStr = o.replace(/\/\*$/, '');
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
                            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                            if (currentTab && currentTab.url && currentTab.url.includes(domain)) {
                                chrome.tabs.reload(currentTab.id);
                            }
                        } catch (e) {
                            console.error(e);
                            statusMsg.textContent = "削除エラー";
                        }
                    }
                };

                li.appendChild(span);
                li.appendChild(delBtn);
            }

            listContainer.appendChild(li);
        });
    }

    updateEnabledList();
});
