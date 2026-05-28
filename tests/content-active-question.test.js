const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('@playwright/test');

const extensionDir = path.join(__dirname, '..', 'extension');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return server.address().port;
}

test('content script solves only the visible auto-advance question in the active progress slot', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['Pompadour, our new influence, has made great inroads in the hair care market.'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '1',
                rawText: 'Pompadour, our new [influence], has made great inroads in the hair care market.',
                signature: 'pompadourournewinfluencehasmadegreatinroadsinthehaircaremarket',
                type: 'sentenceTyping'
            },
            {
                answers: ['Tom found the cause of the computer problem.'],
                displayOrder: 2,
                isAutoAdvance: true,
                questionNo: '2',
                rawText: 'Tom found the [cause] of the computer problem.',
                signature: 'tomfoundthecauseofthecomputerproblem',
                type: 'sentenceTyping'
            },
            {
                answers: ["Don't repeat that anymore."],
                displayOrder: 3,
                isAutoAdvance: true,
                questionNo: '3',
                rawText: "Don't [repeat] that anymore.",
                signature: 'dontrepeatthatanymore',
                type: 'sentenceTyping'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 5</div>
                <div class="QuestionBuilder__question___visible">
                    Pompadour, our new influence, has made great inroads in the hair care market.
                </div>
                <div class="QuestionBuilder__question___stale">
                    Tom found the cause of the computer problem.
                </div>
                <div class="QuestionBuilder__question___stale">
                    Don't repeat that anymore.
                </div>
            </main>
        </body>
        </html>
    `;

    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
    });
    const port = await listen(server);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.addInitScript(data => {
            window.__solvedQuestions = [];
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solvedQuestions.push(question.rawText);
            };
            window.chrome = {
                runtime: {
                    onMessage: { addListener() { } },
                    sendMessage(message) {
                        if (message?.type === 'GET_QUESTION_DATA') {
                            return Promise.resolve({ questionData: data });
                        }
                        return Promise.resolve({});
                    }
                }
            };
            localStorage.setItem('fast-mode', 'true');
        }, questionData);

        await page.goto(`http://127.0.0.1:${port}/as/lplayer/index.cfm`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });
        await page.evaluate(() => {
            document.body.appendChild(document.createElement('div'));
        });
        await page.waitForSelector('#solve-btn', { timeout: 10_000 });
        await page.click('#solve-btn');

        await page.waitForFunction(() => window.__solvedQuestions.length > 0, { timeout: 10_000 });
        const solvedQuestions = await page.evaluate(() => window.__solvedQuestions);
        assert.deepEqual(solvedQuestions, [
            'Pompadour, our new [influence], has made great inroads in the hair care market.'
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
