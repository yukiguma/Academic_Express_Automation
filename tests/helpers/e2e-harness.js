const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const rootDir = path.join(__dirname, '..', '..');
const extensionDir = path.join(rootDir, 'extension');

function createSilentWav() {
    const sampleRate = 8000;
    const sampleCount = 400;
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
}

function createChromeMockScript(questionData) {
    return `
        window.__QUESTION_DATA__ = ${JSON.stringify(questionData)};
        window.alert = () => {};
        window.chrome = {
            runtime: {
                onMessage: {
                    addListener(listener) {
                        window.__chromeMessageListener = listener;
                    }
                },
                sendMessage(message) {
                    if (message && message.type === 'GET_QUESTION_DATA') {
                        return Promise.resolve({ questionData: window.__QUESTION_DATA__ });
                    }
                    if (message && message.type === 'XHR_CAPTURED') {
                        return Promise.resolve({ success: true });
                    }
                    return Promise.resolve({});
                }
            }
        };
        localStorage.setItem('fast-mode', 'true');
    `;
}

function contentTypeFor(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return {
        '.cfc': 'application/json; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8'
    }[extension] || 'application/octet-stream';
}

function createFixtureServer({ apiResponses = new Map(), fixtureDir, routes, returnPaths = [] }) {
    const saveRequests = [];
    const silentAudio = createSilentWav();
    const routeMap = routes instanceof Map ? routes : new Map(routes);
    const apiResponseMap = apiResponses instanceof Map ? apiResponses : new Map(apiResponses);
    const returnPathSet = new Set(returnPaths);

    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const chunks = [];

        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            if (returnPathSet.has(url.pathname)) {
                response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
                response.end('finished');
                return;
            }

            if (apiResponseMap.has(url.pathname)) {
                saveRequests.push({
                    body: Buffer.concat(chunks).toString('utf8'),
                    method: request.method,
                    path: url.pathname,
                    query: url.search
                });
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(apiResponseMap.get(url.pathname));
                return;
            }

            if (url.pathname === '/as/flash/materialSound.cfm') {
                response.writeHead(200, {
                    'content-length': silentAudio.length,
                    'content-type': 'audio/wav'
                });
                response.end(silentAudio);
                return;
            }

            if (/\.mp3$/i.test(url.pathname)) {
                response.writeHead(200, {
                    'content-length': silentAudio.length,
                    'content-type': 'audio/wav'
                });
                response.end(silentAudio);
                return;
            }

            const relativeFile = routeMap.get(url.pathname) || routeMap.get(decodeURIComponent(url.pathname));
            if (relativeFile) {
                const filePath = path.join(fixtureDir, relativeFile);
                response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
                fs.createReadStream(filePath).pipe(response);
                return;
            }

            if (/\.(gif|ico|jpe?g|mp3|png|ttf|woff2?)$/i.test(url.pathname)) {
                response.writeHead(204);
                response.end();
                return;
            }

            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end(`not found: ${url.pathname}`);
        });
    });

    return { saveRequests, server };
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    return server.address().port;
}

async function runAutoSolve({
    clickSolve = true,
    fixtureUrlPath = '/as/lplayer/index.cfm',
    pageReadySelector = '[class*="AppHeader__fixed-top"]',
    preparePage,
    questionData,
    server,
    waitFor
}) {
    const port = await listen(server);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.addInitScript(createChromeMockScript(questionData));
        page.on('dialog', dialog => dialog.dismiss().catch(() => { }));
        page.on('pageerror', error => {
            if (!/Unable to decode audio/i.test(error.message)) {
                throw error;
            }
        });

        await page.goto(`http://127.0.0.1:${port}${fixtureUrlPath}`, { waitUntil: 'domcontentloaded' });
        if (preparePage) {
            await preparePage(page);
        }
        await page.waitForSelector(pageReadySelector, { timeout: 10_000 });
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });

        await page.evaluate(() => {
            document.body.appendChild(document.createElement('div'));
        });
        await page.waitForSelector('#solve-btn', { timeout: 10_000 });
        if (!clickSolve) {
            if (waitFor) await waitFor(page);
            return;
        }
        await page.waitForFunction(() => document.getElementById('solve-btn')?.textContent?.includes('自動入力'), { timeout: 10_000 });
        await page.click('#solve-btn');
        await waitFor(page);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

module.exports = {
    createFixtureServer,
    runAutoSolve
};
