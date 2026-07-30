const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const rootDir = path.join(__dirname, '..', '..');
const extensionDir = path.join(rootDir, 'extension');
const resultDir = path.join(rootDir, 'test-results');
const baseUrl = process.env.ACADEMIC_EXPRESS_BASE_URL || 'https://supereigo.campus.kit.ac.jp';
const userId = process.env.ACADEMIC_EXPRESS_USER_ID;
const password = process.env.ACADEMIC_EXPRESS_PASSWORD;
const sampleCount = Math.max(1, Number.parseInt(process.env.ACADEMIC_EXPRESS_SAMPLE_COUNT || '1', 10));
const seedText = process.env.ACADEMIC_EXPRESS_RANDOM_SEED || `${Date.now()}`;

const areas = [
    { name: 'Vocabulary Bank', path: '/student/dictan-r/index', pathPrefix: '/student/dictan-r/' },
    { name: 'Grammar Bank', path: '/student/sorting/index/grammar', pathPrefix: '/student/sorting/' },
    { name: 'Reading Bank', path: '/student/reading/index', pathPrefix: '/student/reading/' },
    { name: 'Listening Bank', path: '/student/listening/index', pathPrefix: '/student/listening/' },
    { name: 'ディクタン', path: '/student/dictation/index', pathPrefix: '/student/dictation/' },
    { name: 'リスタン', path: '/student/listan/index', pathPrefix: '/student/listan/' }
];

function requireCredentials() {
    if (!userId || !password) {
        throw new Error(
            'ACADEMIC_EXPRESS_USER_ID and ACADEMIC_EXPRESS_PASSWORD must be supplied through GitHub Environment Secrets.'
        );
    }
}

function createRandom(seed) {
    let state = [...seed].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 0x9e3779b9);
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function shuffle(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const target = Math.floor(random() * (index + 1));
        [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
}

function safePageIdentity(rawUrl) {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
}

function sanitizeErrorMessage(error) {
    let message = String(error?.message || error)
        .replace(/([?&](?:token|session|sid)=[^&\s"']+)/gi, '?redacted');
    for (const secret of [userId, password].filter(Boolean)) {
        message = message.replaceAll(secret, '[redacted]');
    }
    return message;
}

async function gotoLivePage(page, target, timeout = 30_000) {
    const expected = new URL(target);
    try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
        const current = new URL(page.url());
        if (error.name !== 'TimeoutError' ||
            current.origin !== expected.origin ||
            current.pathname !== expected.pathname) {
            throw new Error(`Live page navigation failed: ${expected.pathname}`);
        }
    }
    await page.locator('body').waitFor({ state: 'attached', timeout: 10_000 });
    await page.waitForFunction(() => (document.body?.innerText || '').trim().length > 0, undefined, {
        timeout: 10_000
    });
}

async function login(page) {
    await gotoLivePage(page, `${baseUrl}/student/`);
    await page.getByRole('textbox', { name: 'ログインID' }).fill(userId);
    await page.getByRole('textbox', { name: 'パスワード' }).fill(password);
    await page.getByRole('button', { name: 'ログイン' }).click();

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (!new URL(page.url()).pathname.includes('/main/login')) {
            await gotoLivePage(page, `${baseUrl}/student/`);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Academic Express login did not complete within 30 seconds');
}

async function collectLinks(page, area) {
    return page.locator('[href], [onclick], [data-href], [data-url]').evaluateAll((elements, settings) => {
        const currentOrigin = location.origin;
        const ignored = [
            '/student/main/logout',
            '/student/setting/',
            '/student/portfolio/',
            '/student/teamPortfolio/',
            '/student/questionnaires/'
        ];

        const rawCandidates = elements.flatMap(element => {
            const values = [
                element.getAttribute('href'),
                element.getAttribute('data-href'),
                element.getAttribute('data-url'),
                element.getAttribute('onclick')
            ].filter(Boolean);
            return values.flatMap(value =>
                value.match(/https?:\/\/[^'")\s]+|\/(?:as\/lplayer|student)\/[^'")\s]+/g) || []
            );
        }).map(value => value.replaceAll('&amp;', '&'));

        return [...new Set(rawCandidates.map(candidate => {
            try {
                return new URL(candidate, location.href).href;
            } catch {
                return '';
            }
        }).filter(href => {
            if (!href || href.startsWith('javascript:')) return false;
            const url = new URL(href);
            if (url.origin !== currentOrigin) return false;
            if (ignored.some(prefix => url.pathname.startsWith(prefix))) return false;
            if (settings.pathPrefix === '/student/dictan-r/' &&
                /\/(?:wordcardlist|wordlist)(?:\/|$)/.test(url.pathname)) {
                return false;
            }
            if (url.pathname.startsWith('/as/lplayer/')) {
                return ['uno', 'mno', 'tic', 'cno', 'cwn'].some(key => url.searchParams.has(key));
            }
            if (['ディクタン', 'リスタン'].includes(settings.name) &&
                url.pathname.startsWith('/student/cw/')) {
                return true;
            }
            return url.pathname.startsWith(settings.pathPrefix);
        }))];
    }, area);
}

async function openRandomPlayer(page, area, random) {
    const pending = [{ loaded: false, url: new URL(area.path, baseUrl).href }];
    const visited = new Set();

    while (pending.length > 0 && visited.size < 30) {
        const item = pending.shift();
        const target = item.url;
        if (visited.has(target)) continue;
        visited.add(target);
        if (!item.loaded) {
            try {
                await gotoLivePage(page, target, 15_000);
            } catch {
                continue;
            }
        }

        const currentPath = new URL(page.url()).pathname;
        const isBankStage = (
            area.name === 'Vocabulary Bank' &&
            currentPath.startsWith('/student/dictan-r/start/')
        ) || (
            area.name === 'Grammar Bank' &&
            currentPath.startsWith('/student/sorting/start/')
        );
        if (isBankStage) {
            const remainingByMode = await page.evaluate(() => {
                const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
                const readCount = label => {
                    const match = text.match(new RegExp(`${label}\\s*(\\d+)`));
                    return match ? Number(match[1]) : 0;
                };
                return [
                    { countLabel: '未仕分け', mode: 'sorting', remaining: readCount('未仕分け') },
                    { countLabel: '知らない', mode: 'drill', remaining: readCount('知らない') },
                    { countLabel: '知ってる', mode: 'retention', remaining: readCount('知ってる') }
                ];
            });
            const availableButtons = [];
            for (const availability of remainingByMode) {
                const labelBox = await page.evaluate(label => {
                    const candidates = Array.from(document.querySelectorAll('body *'))
                        .filter(element => {
                            const rect = element.getBoundingClientRect();
                            return rect.width > 0 &&
                                rect.height > 0 &&
                                (element.innerText || '').replace(/\s+/g, ' ').includes(label);
                        })
                        .map(element => {
                            const rect = element.getBoundingClientRect();
                            return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
                        })
                        .sort((left, right) => (left.width * left.height) - (right.width * right.height));
                    return candidates[0] || null;
                }, availability.countLabel);
                if (!labelBox) continue;
                if (availability?.remaining > 0) {
                    const point = availability.mode === 'sorting'
                        ? { x: labelBox.x - 90, y: labelBox.y + 140 }
                        : { x: labelBox.x + 20, y: labelBox.y + 220 };
                    availableButtons.push({ point, ...availability });
                }
            }

            if (availableButtons.length > 0) {
                const selected = shuffle(availableButtons, random)[0];
                console.log(`${area.name} mode selected: ${selected.mode} (remaining=${selected.remaining})`);
                await page.mouse.click(selected.point.x, selected.point.y);
                await new Promise(resolve => setTimeout(resolve, 3_000));
                return page.url();
            }
        }

        if (['ディクタン', 'リスタン'].includes(area.name)) {
            await page.waitForFunction(
                () => !(document.body?.innerText || '').includes('Loading...'),
                undefined,
                { timeout: 20_000 }
            ).catch(() => {});
        }

        const launchers = page.locator([
            'form[action*="/as/lplayer/"] button',
            'form[action*="/as/lplayer/"] input[type="button"]',
            'form[action*="/as/lplayer/"] input[type="submit"]',
            '[formaction*="/as/lplayer/"]',
            '[onclick*="/as/lplayer/"]'
        ].join(', '));
        const launcherIndexes = shuffle(
            Array.from({ length: await launchers.count() }, (_, index) => index),
            random
        );
        for (const index of launcherIndexes) {
            const launcher = launchers.nth(index);
            if (!await launcher.isVisible().catch(() => false)) continue;
            await launcher.evaluate(element => {
                element.removeAttribute('target');
                element.closest('form')?.removeAttribute('target');
            });
            await page.evaluate(() => {
                window.open = url => {
                    window.location.href = String(url);
                    return window;
                };
            });
            await launcher.click({ noWaitAfter: true, timeout: 10_000 });
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                if (new URL(page.url()).pathname.startsWith('/as/lplayer/')) {
                    return page.url();
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        const progressControls = page.locator(
            [
                'a:not([href])',
                'a[href^="javascript:"]',
                'button',
                '[onclick]',
                '[role="button"]:not(a[href])'
            ].join(', ')
        ).filter({
            hasText: /学習する|Stage\s*\d+/i
        });
        const progressIndexes = shuffle(
            Array.from({ length: await progressControls.count() }, (_, index) => index),
            random
        );
        let followedControl = false;
        for (const index of progressIndexes) {
            const control = progressControls.nth(index);
            if (!await control.isVisible().catch(() => false)) continue;
            const previousUrl = page.url();
            await control.evaluate(element => element.removeAttribute('target'));
            await page.evaluate(() => {
                window.open = url => {
                    window.location.href = String(url);
                    return window;
                };
            });
            await control.click({ noWaitAfter: true, timeout: 10_000 });
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                const currentUrl = page.url();
                if (new URL(currentUrl).pathname.startsWith('/as/lplayer/')) {
                    return currentUrl;
                }
                if (currentUrl !== previousUrl) {
                    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
                    await page.waitForFunction(
                        () => (document.body?.innerText || '').trim().length > 0,
                        undefined,
                        { timeout: 10_000 }
                    ).catch(() => {});
                    pending.unshift({ loaded: true, url: currentUrl });
                    followedControl = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            if (followedControl) break;
        }
        if (followedControl) continue;

        if (['ディクタン', 'リスタン'].includes(area.name)) {
            await page.evaluate(() => {
                let candidateIndex = 0;
                for (const element of document.querySelectorAll('body *')) {
                    const box = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    const isCandidate = (
                        style.cursor === 'pointer' ||
                        element.hasAttribute('onclick') ||
                        ['A', 'BUTTON'].includes(element.tagName)
                    ) &&
                        box.x > 200 &&
                        box.y > 120 &&
                        box.width >= 60 &&
                        box.width <= 350 &&
                        box.height >= 60 &&
                        box.height <= 350;
                    if (isCandidate) {
                        element.setAttribute('data-live-dojo-card', String(candidateIndex));
                        candidateIndex += 1;
                    }
                }
            });
            const dojoCards = page.locator('[data-live-dojo-card]');
            const cardIndexes = shuffle((await Promise.all(
                Array.from({ length: await dojoCards.count() }, async (_, index) => {
                    const box = await dojoCards.nth(index).boundingBox();
                    return box &&
                        box.x > 200 &&
                        box.y > 120 &&
                        box.width >= 60 &&
                        box.width <= 300 &&
                        box.height >= 60 &&
                        box.height <= 300
                        ? index
                        : null;
                })
            )).filter(index => index !== null), random);
            for (const index of cardIndexes) {
                const card = dojoCards.nth(index);
                if (!await card.isVisible().catch(() => false)) continue;
                const previousUrl = page.url();
                await card.evaluate(element => {
                    const link = element.closest('a') || element.querySelector('a');
                    link?.removeAttribute('target');
                });
                await card.click({ noWaitAfter: true, timeout: 10_000 }).catch(() => {});
                const deadline = Date.now() + 10_000;
                while (Date.now() < deadline) {
                    if (page.url() !== previousUrl) {
                        const currentUrl = page.url();
                        if (new URL(currentUrl).pathname.startsWith('/as/lplayer/')) return currentUrl;
                        pending.unshift({ loaded: true, url: currentUrl });
                        followedControl = true;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                if (followedControl) break;
            }
        }
        if (followedControl) continue;

        const links = await collectLinks(page, area);
        const playerUrls = [];
        const childLinks = [];
        for (const link of shuffle(links, random)) {
            const url = new URL(link);
            if (url.pathname.startsWith('/as/lplayer/')) {
                playerUrls.push(link);
            } else if (!visited.has(link)) {
                childLinks.push(link);
            }
        }
        childLinks.sort((left, right) => {
            const leftPriority = new URL(left).pathname.includes('/start/') ? 0 : 1;
            const rightPriority = new URL(right).pathname.includes('/start/') ? 0 : 1;
            return leftPriority - rightPriority;
        });
        pending.unshift(...childLinks.map(url => ({ loaded: false, url })));

        if (playerUrls.length > 0) {
            const selected = shuffle([...new Set(playerUrls)], random)[0];
            await gotoLivePage(page, selected);
            return selected;
        }
    }

    const visitedPaths = [...visited].map(value => new URL(value).pathname).join(', ');
    throw new Error(
        `${area.name}: no playable question was found after checking ${visited.size} pages (${visitedPaths})`
    );
}

async function waitForQuestionData(worker, diagnostics) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const isReady = await worker.evaluate(async () => {
            const result = await chrome.storage.session.get(['questionData']);
            return Array.isArray(result.questionData?.questions) && result.questionData.questions.length > 0;
        });
        if (isReady) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    const questionData = await worker.evaluate(async () => {
        const result = await chrome.storage.session.get(['questionData', 'dataUrl']);
        if (!Array.isArray(result.questionData?.questions) || result.questionData.questions.length === 0) {
            return null;
        }
        return {
            count: result.questionData.questions.length,
            dataPath: result.dataUrl ? new URL(result.dataUrl, 'https://fixture.invalid').pathname : '',
            types: [...new Set(result.questionData.questions.map(question => question.type || 'unknown'))].sort()
        };
    });
    if (!questionData) {
        const responsePaths = [...diagnostics.questionDataPaths].sort().join(', ') || 'none';
        const requestPaths = [...diagnostics.requestPaths].sort().slice(0, 20).join(', ') || 'none';
        throw new Error(
            `The extension did not capture question data within 30 seconds ` +
            `(contentScriptLoaded=${diagnostics.contentScriptLoaded}, responses=${responsePaths}, ` +
            `xhr=${requestPaths}, state=${JSON.stringify(diagnostics.pageState)})`
        );
    }
    return questionData;
}

async function startCurrentQuestion(page) {
    const startButton = page.locator([
        'button',
        'a',
        '[role="button"]',
        'input[type="button"]',
        'input[type="submit"]'
    ].join(', ')).filter({ hasText: /スタート|開始|学習する/ }).or(
        page.locator([
            'input[type="button"][value*="スタート"]',
            'input[type="button"][value*="開始"]',
            'input[type="submit"][value*="スタート"]',
            'input[type="submit"][value*="開始"]'
        ].join(', '))
    ).first();
    const hasStartButton = await startButton
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    if (hasStartButton) {
        await startButton.click();
    }
}

async function solveCurrentQuestion(page) {
    const solveButton = page.locator('#solve-btn');
    await solveButton.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
        () => document.querySelector('#solve-btn')?.textContent?.includes('自動入力'),
        undefined,
        { timeout: 30_000 }
    );
    await solveButton.click();

    await page.waitForFunction(() => {
        const button = document.querySelector('#solve-btn');
        const bodyText = document.body?.innerText || '';
        return !button ||
            button.hidden ||
            getComputedStyle(button).display === 'none' ||
            /終了|正解数|点/.test(bodyText);
    }, undefined, { timeout: 180_000 });
}

async function main() {
    requireCredentials();
    const random = createRandom(seedText);
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academic-express-live-'));
    const summary = {
        generatedAt: new Date().toISOString(),
        sampleCount,
        seed: seedText,
        results: [],
        failures: []
    };

    const context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chromium',
        headless: true,
        args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`
        ]
    });
    const page = context.pages()[0] || await context.newPage();
    const diagnostics = {
        contentScriptLoaded: false,
        pageState: {},
        questionDataPaths: new Set(),
        requestPaths: new Set()
    };
    page.on('console', message => {
        if (message.text() === 'Academic Express Auto Answer Content Script Loaded') {
            diagnostics.contentScriptLoaded = true;
        }
    });
    page.on('response', response => {
        const url = new URL(response.url());
        if (/authoring|tango_data_manipulate|bookxml|question|quiz/i.test(url.pathname)) {
            diagnostics.questionDataPaths.add(url.pathname);
        }
    });
    page.on('request', request => {
        if (!['fetch', 'xhr'].includes(request.resourceType())) return;
        const url = new URL(request.url());
        if (url.origin === new URL(baseUrl).origin) diagnostics.requestPaths.add(url.pathname);
    });

    try {
        await login(page);
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

        for (const area of areas) {
            for (let sample = 0; sample < sampleCount; sample += 1) {
                try {
                    diagnostics.contentScriptLoaded = false;
                    diagnostics.questionDataPaths.clear();
                    diagnostics.requestPaths.clear();
                    await worker.evaluate(() => chrome.storage.session.clear());
                    const playerUrl = await openRandomPlayer(page, area, random);
                    console.log(`Testing ${area.name}: ${new URL(playerUrl).pathname}`);
                    await startCurrentQuestion(page);
                    diagnostics.pageState = await page.evaluate(() => {
                        const text = document.body?.innerText || '';
                        return {
                            hasBrowserWarning: text.includes('現在のブラウザではご利用になれません'),
                            hasFinish: /終了|正解数|点/.test(text),
                            hasLogin: text.includes('ログインID') && text.includes('パスワード'),
                            hasStart: /スタート|開始|学習する/.test(text)
                        };
                    });
                    const questionData = await waitForQuestionData(worker, diagnostics);
                    await solveCurrentQuestion(page);
                    summary.results.push({
                        area: area.name,
                        page: safePageIdentity(playerUrl),
                        questionCount: questionData.count,
                        questionDataPath: questionData.dataPath,
                        types: questionData.types
                    });
                } catch (error) {
                    const message = sanitizeErrorMessage(error);
                    summary.failures.push({
                        area: area.name,
                        message
                    });
                    console.error(`${area.name}: ${message}`);
                }
            }
        }
    } finally {
        fs.mkdirSync(resultDir, { recursive: true });
        fs.writeFileSync(
            path.join(resultDir, 'academic-express-live-summary.json'),
            `${JSON.stringify(summary, null, 2)}\n`
        );
        await context.close();
        fs.rmSync(profileDir, { force: true, recursive: true });
    }

    if (summary.failures.length > 0) {
        throw new Error(`Live E2E failed in ${summary.failures.map(failure => failure.area).join(', ')}`);
    }
}

main().catch(error => {
    console.error(sanitizeErrorMessage(error));
    process.exitCode = 1;
});
