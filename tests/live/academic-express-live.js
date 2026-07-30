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

async function login(page) {
    await page.goto(`${baseUrl}/student/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'ログインID' }).fill(userId);
    await page.getByRole('textbox', { name: 'パスワード' }).fill(password);
    await Promise.all([
        page.waitForURL(url => !url.pathname.includes('/main/login'), { timeout: 30_000 }),
        page.getByRole('button', { name: 'ログイン' }).click()
    ]);
}

async function collectLinks(page, area) {
    return page.locator('a[href]').evaluateAll((anchors, settings) => {
        const currentOrigin = location.origin;
        const ignored = [
            '/student/main/logout',
            '/student/setting/',
            '/student/portfolio/',
            '/student/teamPortfolio/',
            '/student/questionnaires/'
        ];

        return [...new Set(anchors.map(anchor => {
            try {
                return new URL(anchor.href, location.href).href;
            } catch {
                return '';
            }
        }).filter(href => {
            if (!href || href.startsWith('javascript:')) return false;
            const url = new URL(href);
            if (url.origin !== currentOrigin) return false;
            if (ignored.some(prefix => url.pathname.startsWith(prefix))) return false;
            return url.pathname.startsWith('/as/lplayer/') ||
                url.pathname.startsWith(settings.pathPrefix);
        }))];
    }, area);
}

async function findRandomPlayerUrl(page, area, random) {
    const pending = [new URL(area.path, baseUrl).href];
    const visited = new Set();
    const playerUrls = [];

    while (pending.length > 0 && visited.size < 30) {
        const target = pending.shift();
        if (visited.has(target)) continue;
        visited.add(target);
        await page.goto(target, { waitUntil: 'domcontentloaded' });

        const links = await collectLinks(page, area);
        for (const link of shuffle(links, random)) {
            const url = new URL(link);
            if (url.pathname.startsWith('/as/lplayer/')) {
                playerUrls.push(link);
            } else if (!visited.has(link)) {
                pending.push(link);
            }
        }

        if (playerUrls.length >= sampleCount) break;
    }

    if (playerUrls.length === 0) {
        throw new Error(`${area.name}: no playable question link was found after checking ${visited.size} pages`);
    }
    return shuffle([...new Set(playerUrls)], random).slice(0, sampleCount);
}

async function waitForQuestionData(worker) {
    await worker.waitForFunction(async () => {
        const result = await chrome.storage.session.get(['questionData']);
        return Array.isArray(result.questionData?.questions) && result.questionData.questions.length > 0;
    }, undefined, { timeout: 30_000 });

    return worker.evaluate(async () => {
        const result = await chrome.storage.session.get(['questionData', 'dataUrl']);
        return {
            count: result.questionData.questions.length,
            dataPath: result.dataUrl ? new URL(result.dataUrl, 'https://fixture.invalid').pathname : '',
            types: [...new Set(result.questionData.questions.map(question => question.type || 'unknown'))].sort()
        };
    });
}

async function solveCurrentQuestion(page) {
    const startButton = page.getByRole('button', { name: /スタート|開始/ }).first();
    if (await startButton.isVisible().catch(() => false)) {
        await startButton.click();
    }

    const solveButton = page.locator('#solve-btn');
    await solveButton.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('#solve-btn')?.textContent?.includes('自動入力'), {
        timeout: 30_000
    });
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
        results: []
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

    try {
        await login(page);
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

        for (const area of areas) {
            const playerUrls = await findRandomPlayerUrl(page, area, random);
            for (const playerUrl of playerUrls) {
                await worker.evaluate(() => chrome.storage.session.clear());
                await page.goto(playerUrl, { waitUntil: 'domcontentloaded' });
                const questionData = await waitForQuestionData(worker);
                await solveCurrentQuestion(page);
                summary.results.push({
                    area: area.name,
                    page: safePageIdentity(playerUrl),
                    questionCount: questionData.count,
                    questionDataPath: questionData.dataPath,
                    types: questionData.types
                });
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

    const testedAreas = new Set(summary.results.map(result => result.area));
    const missingAreas = areas.filter(area => !testedAreas.has(area.name)).map(area => area.name);
    if (missingAreas.length > 0) {
        throw new Error(`Live E2E did not complete: ${missingAreas.join(', ')}`);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
