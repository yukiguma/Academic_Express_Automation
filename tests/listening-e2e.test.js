const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('@playwright/test');

const parser = require('../extension/parser.js');

const rootDir = path.join(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const fixtureDir = path.join(__dirname, 'fixtures', 'ListeningTest');

const expectedWrites = [
    ['1590', '2'],
    ['1591', '4'],
    ['1592', '4'],
    ['14940', '2'],
    ['14942', '1'],
    ['14944', '2'],
    ['1498', '1'],
    ['14866', '4'],
    ['1494', '4']
];

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

function createFixtureServer() {
    const saveRequests = [];
    const successResponse = fs.readFileSync(path.join(fixtureDir, 'flash', 'data_manipulate.cfc'));
    const silentAudio = createSilentWav();
    const routes = new Map([
        ['/as/lplayer/index.cfm', 'Academic Express3.html'],
        ['/as/lplayer/player-standard.js', 'player-standard.js'],
        ['/as/lplayer/player_additional.css', 'player_additional.css'],
        ['/as/lplayer/authoring.xml', 'authoring.xml']
    ]);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8'
    };

    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const chunks = [];

        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            if (url.pathname === '/student/cw/unit/1322') {
                response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
                response.end('finished');
                return;
            }

            if (url.pathname === '/as/flash/data_manipulate.cfc') {
                saveRequests.push({
                    method: request.method,
                    query: url.search,
                    body: Buffer.concat(chunks).toString('utf8')
                });
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(successResponse);
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

            const relativeFile = routes.get(url.pathname);
            if (relativeFile) {
                const filePath = path.join(fixtureDir, relativeFile);
                response.writeHead(200, {
                    'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream'
                });
                fs.createReadStream(filePath).pipe(response);
                return;
            }

            if (/\.(gif|ico|jpe?g|png|ttf|woff2?)$/i.test(url.pathname)) {
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

function parseSavedAnswer(body) {
    const params = new URLSearchParams(body);
    const answerXml = params.get('answer') || '';
    const answerNo = answerXml.match(/<answer>(.*?)<\/answer>/)?.[1] || '';
    const correct = answerXml.match(/<correct>(.*?)<\/correct>/)?.[1] || '';

    return {
        answerNo,
        correct,
        correctFlag: params.get('correct_flag'),
        questionNo: params.get('question_no'),
        saveType: params.get('save_type'),
        totalScore: params.get('totalscore')
    };
}

test('ListeningTest fixture is auto-solved and submitted through grading', { timeout: 60_000 }, async () => {
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.xml'), 'utf8')).parsed;
    assert.equal(questionData.questions.length, expectedWrites.length);

    const { saveRequests, server } = createFixtureServer();
    const port = await listen(server);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.addInitScript(createChromeMockScript(questionData));
        page.on('dialog', dialog => dialog.dismiss().catch(() => { }));

        await page.goto(`http://127.0.0.1:${port}/as/lplayer/index.cfm`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[class*="AppHeader__fixed-top"]', { timeout: 10_000 });
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });

        // The content script normally starts at document_start. In this harness it
        // is injected after the saved player renders, so trigger its observer once.
        await page.evaluate(() => {
            document.body.appendChild(document.createElement('div'));
        });
        await page.waitForSelector('#solve-btn', { timeout: 10_000 });
        await page.click('#solve-btn');
        await page.waitForURL(/\/student\/cw\/unit\/1322/, { timeout: 45_000 });
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);

    assert.deepEqual(
        writes.map(write => [write.questionNo, write.answerNo]),
        expectedWrites
    );
    assert.ok(writes.every(write => write.correct === 'true'));
    assert.ok(writes.every(write => write.correctFlag === '1'));
    assert.equal(writes.at(-1).totalScore, '100');
    assert.equal(writes.at(-1).saveType, '1');
});
