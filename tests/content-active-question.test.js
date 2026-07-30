const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('@playwright/test');
const parser = require('../extension/parser.js');

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
            },
            {
                answers: ['Unused four.'],
                displayOrder: 4,
                isAutoAdvance: true,
                questionNo: '4',
                rawText: 'Unused [four].',
                signature: 'unusedfour',
                type: 'sentenceTyping'
            },
            {
                answers: ['Unused five.'],
                displayOrder: 5,
                isAutoAdvance: true,
                questionNo: '5',
                rawText: 'Unused [five].',
                signature: 'unusedfive',
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

test('content script uses current media signatures for shuffled duplicate prompts', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['a'],
                displayOrder: 1,
                mediaSignatures: ['11111111111111111111111111111111'],
                questionNo: 'first',
                rawText: 'Click your answer on the screen.',
                shuffleQuestions: true,
                signature: 'clickyouransweronthescreen',
                type: 'multipleChoice'
            },
            {
                answers: ['b'],
                displayOrder: 2,
                mediaSignatures: ['22222222222222222222222222222222'],
                questionNo: 'second',
                rawText: 'Click your answer on the screen.',
                shuffleQuestions: true,
                signature: 'clickyouransweronthescreen',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 2</div>
                <div class="QuestionBuilder__questionBox___visible">
                    <div class="QuestionBuilder__question___visible">
                        Click your answer on the screen.
                    </div>
                    <button>a</button>
                    <button>b</button>
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
            Object.defineProperty(performance, 'getEntriesByType', {
                value(type) {
                    if (type !== 'resource') return [];
                    return [
                        {
                            name: 'http://example.test/as/flash/materialSound.cfm?id=11111111111111111111111111111111',
                            responseEnd: 10,
                            startTime: 5
                        },
                        {
                            name: 'http://example.test/as/flash/materialSound.cfm?id=22222222222222222222222222222222',
                            responseEnd: 20,
                            startTime: 15
                        }
                    ];
                }
            });
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solvedQuestions.push(question.questionNo);
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
        assert.deepEqual(solvedQuestions, ['second']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script applies fast-mode click wait before solving', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['correct'],
                displayOrder: 1,
                questionNo: '1',
                rawText: 'Choose the correct answer.',
                signature: 'choosethecorrectanswer',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 1</div>
                <div class="QuestionBuilder__question___visible">
                    Choose the correct answer.
                </div>
                <button>correct</button>
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
            window.__solveDelays = [];
            window.solve = async (_answers, _type, _scope, _question) => {
                window.__solveDelays.push(performance.now() - window.__solveClickStartedAt);
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
        await page.evaluate(() => {
            window.__solveClickStartedAt = performance.now();
        });
        await page.click('#solve-btn');

        await page.waitForFunction(() => window.__solveDelays.length > 0, { timeout: 10_000 });
        const [delay] = await page.evaluate(() => window.__solveDelays);
        assert.ok(delay >= 40, `Expected fast click wait before solve, got ${delay}ms`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script clicks manual transition when progress disappears after solving', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['correct'],
                displayOrder: 1,
                questionNo: '1',
                rawText: 'Choose the correct answer.',
                signature: 'choosethecorrectanswer',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div id="progress">1 / 1</div>
                <div class="QuestionBuilder__question___visible">
                    Choose the correct answer.
                </div>
                <button>correct</button>
                <div id="transition-host"></div>
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
            window.__transitionClicks = [];
            window.simulateClick = element => {
                const target = element.querySelector('button') || element;
                for (const eventType of ['mousedown', 'mouseup', 'click']) {
                    target.dispatchEvent(new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                }
            };
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solvedQuestions.push(question.rawText);
                document.getElementById('progress')?.remove();
                const button = document.createElement('button');
                button.textContent = '採点';
                button.onclick = () => window.__transitionClicks.push('採点');
                document.getElementById('transition-host').appendChild(button);
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

        await page.waitForFunction(() => window.__transitionClicks.length > 0, { timeout: 10_000 });
        assert.deepEqual(await page.evaluate(() => window.__solvedQuestions), [
            'Choose the correct answer.'
        ]);
        assert.deepEqual(await page.evaluate(() => window.__transitionClicks), ['採点']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script ignores offscreen stale normal question candidates', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['old'],
                displayOrder: 2,
                questionNo: 'old',
                rawText: 'Old prompt.',
                signature: 'oldprompt',
                type: 'multipleChoice'
            },
            {
                answers: ['current'],
                displayOrder: 1,
                questionNo: 'current',
                rawText: 'Current prompt.',
                signature: 'currentprompt',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 2</div>
                <section style="position:absolute; top:2000px; width:200px; height:40px;">
                    <div class="QuestionBuilder__question___stale">Old prompt.</div>
                    <button>old</button>
                </section>
                <section>
                    <div class="QuestionBuilder__question___visible">Current prompt.</div>
                    <button>current</button>
                </section>
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
                window.__solvedQuestions.push(question.questionNo);
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
        assert.deepEqual(solvedQuestions, ['current']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script ignores offscreen stale sorting candidates', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['old', 'sort'],
                displayOrder: 2,
                questionNo: 'old-sort',
                rawText: 'Old sorting prompt. [old/sort]',
                signature: 'oldsortingpromptoldsort',
                type: 'sorting'
            },
            {
                answers: ['current'],
                displayOrder: 1,
                questionNo: 'current-choice',
                rawText: 'Current prompt.',
                signature: 'currentprompt',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 2</div>
                <section class="SortingAQuestionBuilder__questionBox___stale" style="position:absolute; top:2000px; width:200px; height:80px;">
                    <div class="QuestionBuilder__question___stale">Old sorting prompt. old sort</div>
                    <ul class="SortingAQuestionBuilder__sortStringList___stale">
                        <li>old</li>
                        <li>sort</li>
                    </ul>
                </section>
                <section>
                    <div class="QuestionBuilder__question___visible">Current prompt.</div>
                    <button>current</button>
                </section>
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
                window.__solvedQuestions.push(question.questionNo);
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
        assert.deepEqual(solvedQuestions, ['current-choice']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script resumes auto-mode after automatic progress changes', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['first'],
                displayOrder: 1,
                questionNo: '1',
                rawText: 'First prompt.',
                signature: 'firstprompt',
                type: 'multipleChoice'
            },
            {
                answers: ['second'],
                displayOrder: 2,
                questionNo: '2',
                rawText: 'Second prompt.',
                signature: 'secondprompt',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div id="progress">1 / 2</div>
                <div id="prompt" class="QuestionBuilder__question___visible">First prompt.</div>
                <button id="answer">first</button>
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
            window.__solveEvents = [];
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solveEvents.push(question.questionNo);
                if (question.questionNo === '1') {
                    document.getElementById('progress').textContent = '2 / 2';
                    document.getElementById('prompt').textContent = 'Second prompt.';
                    document.getElementById('answer').textContent = 'second';
                    document.body.appendChild(document.createElement('div'));
                }
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

        await page.waitForFunction(() => window.__solveEvents.length === 2, { timeout: 10_000 });
        const events = await page.evaluate(() => window.__solveEvents);
        assert.deepEqual(events, ['1', '2']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script keeps the solve button busy while auto-mode waits for the next question', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['first'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '1',
                rawText: 'First prompt.',
                signature: 'firstprompt',
                type: 'multipleChoice'
            },
            {
                answers: ['second'],
                displayOrder: 2,
                isAutoAdvance: true,
                questionNo: '2',
                rawText: 'Second prompt.',
                signature: 'secondprompt',
                type: 'multipleChoice'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div id="progress">1 / 2</div>
                <div id="prompt" class="QuestionBuilder__question___visible">First prompt.</div>
                <button id="answer">first</button>
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
            window.__solveEvents = [];
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solveEvents.push(question.questionNo);
                if (question.questionNo === '1') {
                    document.getElementById('progress').textContent = '2 / 2';
                    document.getElementById('prompt').textContent = 'Second prompt.';
                    document.getElementById('answer').textContent = 'second';
                    document.body.appendChild(document.createElement('div'));
                }
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
            localStorage.setItem('fast-mode', 'false');
        }, questionData);

        await page.goto(`http://127.0.0.1:${port}/as/lplayer/index.cfm`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });
        await page.evaluate(() => {
            document.body.appendChild(document.createElement('div'));
        });
        await page.waitForSelector('#solve-btn', { timeout: 10_000 });
        await page.click('#solve-btn');

        await page.waitForFunction(() => {
            const button = document.getElementById('solve-btn');
            return window.__solveEvents.length === 1 && button?.textContent?.includes('処理中');
        }, { timeout: 10_000 });
        await page.waitForTimeout(200);

        const midWaitState = await page.evaluate(() => ({
            events: window.__solveEvents,
            text: document.getElementById('solve-btn')?.textContent
        }));
        assert.deepEqual(midWaitState.events, ['1']);
        assert.match(midWaitState.text, /処理中/);

        await page.waitForFunction(() => window.__solveEvents.length === 2, { timeout: 10_000 });
        const events = await page.evaluate(() => window.__solveEvents);
        assert.deepEqual(events, ['1', '2']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script waits for clickable sorting tokens before using the visible prompt fallback', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['That', 'is', 'old'],
                displayOrder: 1,
                questionNo: 'sort-1',
                rawText: 'This is not visible. [That/is/old]',
                signature: 'thisisnotvisiblethatisold',
                type: 'sorting'
            },
            {
                answers: ['In', 'order', 'to apply', 'to', 'the', 'college'],
                displayOrder: 2,
                questionNo: 'sort-2',
                rawText: 'その大学に志願するには3通の推薦状が必要である。 [In/order/to apply/to/the/college], you will need three letters of recommendation.',
                signature: 'その大学に志願するには3通の推薦状が必要であるinordertoapplytothecollegeyouwillneedthreelettersofrecommendation',
                type: 'sorting'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>2 / 2</div>
                <div class="SortingAQuestionBuilder__questionBox___visible">
                    <div class="QuestionBuilder__question___visible">
                        その大学に志願するには3通の推薦状が必要である。 In order to apply to the college, you will need three letters of recommendation.
                    </div>
                    <ul class="SortingAQuestionBuilder__sortStringList___visible">
                        <li>not-yet-ready</li>
                    </ul>
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
                window.__solvedQuestions.push(question.questionNo);
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
        await page.waitForTimeout(200);
        assert.deepEqual(await page.evaluate(() => window.__solvedQuestions), []);

        await page.evaluate(() => {
            document.querySelector('[class*="sortStringList"]').innerHTML = [
                '<li>extra-token</li>',
                '<li>college</li>',
                '<li>to apply</li>',
                '<li>order</li>',
                '<li>the</li>',
                '<li>In</li>',
                '<li>to</li>'
            ].join('');
        });
        await page.waitForFunction(() => {
            const button = document.getElementById('solve-btn');
            return button && button.textContent.includes('自動入力');
        }, { timeout: 10_000 });
        await page.click('#solve-btn');
        await page.waitForFunction(() => window.__solvedQuestions.length > 0, { timeout: 10_000 });
        const solvedQuestions = await page.evaluate(() => window.__solvedQuestions);
        assert.deepEqual(solvedQuestions, ['sort-2']);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script matches the visible auto-advance prompt when payload count differs from progress total', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['The tax burden has increased since last year.'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '101',
                rawText: 'The tax [burden] has increased since last year.',
                signature: 'thetaxburdenhasincreasedsincelastyear',
                shuffleQuestions: false,
                type: 'sentenceTyping'
            },
            {
                answers: ['To know more about this, you can ask at the sales division.'],
                displayOrder: 2,
                isAutoAdvance: true,
                questionNo: '102',
                rawText: 'To know more about this, you can ask at the sales [division].',
                signature: 'toknowmoreaboutthisyoucanaskatthesalesdivision',
                shuffleQuestions: false,
                type: 'sentenceTyping'
            },
            {
                answers: ['unused third'],
                displayOrder: 3,
                isAutoAdvance: true,
                questionNo: '103',
                rawText: 'unused third',
                signature: 'unusedthird',
                shuffleQuestions: false,
                type: 'typing'
            },
            {
                answers: ['unused fourth'],
                displayOrder: 4,
                isAutoAdvance: true,
                questionNo: '104',
                rawText: 'unused fourth',
                signature: 'unusedfourth',
                shuffleQuestions: false,
                type: 'typing'
            },
            {
                answers: ['confident'],
                displayOrder: 5,
                isAutoAdvance: true,
                questionNo: '105',
                rawText: '自信がある、確信して、自信に満ちた',
                signature: '自信がある確信して自信に満ちた',
                shuffleQuestions: false,
                type: 'typing'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div><span>3 / 10</span></div></div>
            <main>
                <div class="TangoSentenceTypingQuestionBuilder__questionBox___old" style="position:absolute; left:-10000px; top:0; width:600px; height:160px;">
                    <div class="QuestionTitleText__root___dJe1E"><span>1</span></div>:
                    <div class="TangoSentenceTypingQuestionBuilder__question___old">
                        The tax burden has increased since last year.
                    </div>
                </div>
                <div class="TangoSentenceTypingQuestionBuilder__questionBox___old" style="position:absolute; left:-10000px; top:180px; width:600px; height:160px;">
                    <div class="QuestionTitleText__root___dJe1E"><span>2</span></div>:
                    <div class="TangoSentenceTypingQuestionBuilder__question___old">
                        To know more about this, you can ask at the sales division.
                    </div>
                </div>
                <div class="TangoTypingQuestionBuilder__questionBox___current">
                    <div class="QuestionTitleText__root___dJe1E"><span>3</span></div>:
                    <div class="TypingQuestionBuilder__question___1szKn">
                        <span>自信がある、確信して、自信に満ちた</span>
                    </div>
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
            '自信がある、確信して、自信に満ちた'
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script solves single current auto-advance payload regardless of progress number', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['David was badly injured in the accident.'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '202',
                rawText: 'David was badly [injured] in the accident.',
                signature: 'davidwasbadlyinjuredintheaccident',
                shuffleQuestions: true,
                type: 'sentenceTyping'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div><span>2 / 5</span></div></div>
            <main>
                <div class="TangoSentenceTypingQuestionBuilder__questionBox___current">
                    <div class="QuestionTitleText__root___dJe1E"><span>2</span></div>:
                    <div class="TangoSentenceTypingQuestionBuilder__question___current">
                        David was badly injured in the accident.
                    </div>
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
            'David was badly [injured] in the accident.'
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script treats dictation type as auto-advance without layout detection', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['I have to go to the bank before lunch.'],
                displayOrder: 1,
                questionNo: '20280414',
                rawText: 'I have to go to the bank before lunch.',
                signature: 'ihavetogotothebankbeforelunch',
                type: 'dictation'
            },
            {
                answers: ["Don't be lazy. You have to study English harder."],
                displayOrder: 2,
                questionNo: '203016143',
                rawText: "Don't be lazy. You have to study English harder.",
                signature: 'dontbelazyyouhavetostudyenglishharder',
                type: 'dictation'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="QuestionHeader__innerContainer___2J16p">
                <div class="QuestionHeader__left___24vuK"><button>前のページに戻る</button></div>
                <div class="QuestionHeader__center___2GqF7">1/2</div>
                <div class="QuestionHeader__right___2S11U"><button id="nextButton">次へ</button></div>
            </div>
            <main>
                <div class="QuestionArea__typingArea___1EZet">
                    <div class="FontBox__root___23-B9"></div>
                </div>
                <div id="transition-host"><button id="grade-button">採点</button></div>
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
            window.__transitionClicks = [];
            window.solve = async (_answers, _type, _scope, question) => {
                window.__solvedQuestions.push(question.questionNo);
            };
            window.simulateClick = element => {
                window.__transitionClicks.push(element.textContent.trim());
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
        await page.waitForFunction(() => document.getElementById('solve-btn')?.textContent?.includes('自動入力'), { timeout: 10_000 });
        await page.click('#solve-btn');

        await page.waitForFunction(() => window.__solvedQuestions.length > 0, { timeout: 10_000 });
        await page.waitForTimeout(500);
        assert.deepEqual(await page.evaluate(() => window.__solvedQuestions), ['20280414']);
        assert.deepEqual(await page.evaluate(() => window.__transitionClicks), []);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script retries dictation when solver defers until the question is ready', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['This tea is too hot for me to drink.'],
                displayOrder: 1,
                questionNo: '203',
                rawText: 'This tea is too hot for me to drink.',
                signature: 'thisteaistoohotformetodrink',
                type: 'dictation'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="QuestionHeader__innerContainer___2J16p">
                <div class="QuestionHeader__center___2GqF7">1/1</div>
            </div>
            <main>
                <div class="QuestionArea__dictationArea___1EZet"></div>
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
            window.__ready = false;
            window.__solveAttempts = 0;
            window.solve = async () => {
                window.__solveAttempts += 1;
                return window.__ready;
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

        await page.waitForFunction(() => window.__solveAttempts >= 1, { timeout: 10_000 });
        await page.evaluate(() => {
            window.__ready = true;
            document.body.appendChild(document.createElement('div'));
        });

        await page.waitForFunction(() => window.__solveAttempts >= 2, { timeout: 10_000 });
        assert.equal(await page.evaluate(() => window.__solveAttempts), 2);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script matches sentence typing when the hidden word is absent from visible text', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['David was badly injured in the accident.'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '202',
                rawText: 'David was badly [injured] in the accident.',
                signature: 'davidwasbadlyinjuredintheaccident',
                shuffleQuestions: true,
                type: 'sentenceTyping'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div><span>2 / 5</span></div></div>
            <main>
                <div class="TangoSentenceTypingQuestionBuilder__questionBox___current">
                    <div class="QuestionTitleText__root___dJe1E"><span>2</span></div>:
                    <div class="TangoSentenceTypingQuestionBuilder__question___current">
                        David was badly in the accident.
                    </div>
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
            'David was badly [injured] in the accident.'
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script matches shuffled spelling sentence typing by Japanese prompt text', { timeout: 20_000 }, async () => {
    const payload = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'VocabrarySpelling4', 'tango_data_manipulate.cfc'),
        'utf8'
    );
    const questionData = parser.parseQuestionData(payload).parsed;

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div><span>2 / 10</span></div></div>
            <main>
                <div class="TangoSentenceTypingQuestionBuilder__questionBox___current">
                    <div class="QuestionTitleText__root___dJe1E"><span>2</span></div>:
                    <div class="QuestionDirectionText__root___3WtnC">
                        <p>次の意味の英語をタイピングしてください。わからない場合は「知らない」ボタンを選択してください。</p>
                    </div>
                    <div class="TangoSentenceTypingQuestionBuilder__sentenceJa___current">
                        その銀行の支店は、比較的、知られていない。
                    </div>
                    <div class="WordBox__root___1FmIC">
                        <div class="FontBox__fontBox___JZThN FontBox__notInput___1tE-e">T</div>
                        <div class="FontBox__fontBox___JZThN FontBox__hide___3tfQU"></div>
                    </div>
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
            'The [branches] of the bank are less known.'
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script keeps selected question hub links visually marked', { timeout: 20_000 }, async () => {
    const html = `
        <!doctype html>
        <html>
        <body>
            <main>
                <div class="unit-box">
                    <div class="unit-title"><span class="unit-title-char">リスタン</span></div>
                    <a class="btn" href="/as/lplayer/index.cfm?uno=1" style="width:0;height:0;overflow:hidden;display:block;"></a>
                    <span class="study_text">Q1.学習する</span>
                </div>
                <div class="unit-box">
                    <div class="unit-title"><span class="unit-title-char">Review</span></div>
                    <a class="btn" href="/as/lplayer/index.cfm?uno=2">学習する</a>
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
        await page.addInitScript(() => {
            window.chrome = {
                runtime: {
                    onMessage: { addListener() { } },
                    sendMessage() {
                        return Promise.resolve({});
                    }
                }
            };
        });

        await page.goto(`http://127.0.0.1:${port}/student/cw/unit/1322`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });

        await page.waitForSelector('#question-hub-control', { timeout: 10_000 });
        await page.click('#question-hub-speed-fast');
        await page.click('#question-hub-mode-btn');
        await page.getByText('Q1.学習する').click();

        const selected = await page.evaluate(() => ({
            fastMode: localStorage.getItem('fast-mode'),
            fastActive: document.getElementById('question-hub-speed-fast').classList.contains('active'),
            stored: JSON.parse(localStorage.getItem('question-hub-selected-links')),
            marked: document.querySelectorAll('.ae-question-hub-selected').length,
            status: document.getElementById('question-hub-status').textContent
        }));
        assert.equal(selected.fastMode, 'true');
        assert.equal(selected.fastActive, true);
        assert.equal(selected.stored.length, 1);
        assert.equal(selected.marked, 1);
        assert.equal(selected.status, '選択 1件');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script runs selected question hub links in saved order', { timeout: 20_000 }, async () => {
    const html = `
        <!doctype html>
        <html>
        <body>
            <main>
                <div class="unit-box">
                    <div class="unit-title"><span class="unit-title-char">First</span></div>
                    <a class="btn" href="/as/lplayer/index.cfm?uno=1">Q1.学習する</a>
                </div>
                <div class="unit-box">
                    <div class="unit-title"><span class="unit-title-char">Second</span></div>
                    <a class="btn" href="/as/lplayer/index.cfm?uno=2">Q2.学習する</a>
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
    const hubUrl = `http://127.0.0.1:${port}/student/cw/unit/1322`;

    try {
        await page.addInitScript(() => {
            window.chrome = {
                runtime: {
                    onMessage: { addListener() { } },
                    sendMessage() {
                        return Promise.resolve({});
                    }
                }
            };
        });

        await page.goto(hubUrl, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            localStorage.setItem(
                'question-hub-selected-links',
                JSON.stringify([
                    `${location.origin}/as/lplayer/index.cfm?uno=1`,
                    `${location.origin}/as/lplayer/index.cfm?uno=2`
                ])
            );
        });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });
        await page.waitForSelector('#question-hub-control', { timeout: 10_000 });
        await page.click('#question-hub-run-btn');
        await page.waitForURL('**/as/lplayer/index.cfm?uno=1', { timeout: 10_000 });
        const afterFirstLaunch = await page.evaluate(() => ({
            selected: JSON.parse(localStorage.getItem('question-hub-selected-links')),
            runState: JSON.parse(localStorage.getItem('question-hub-run-state'))
        }));
        assert.deepEqual(afterFirstLaunch.selected.map(url => new URL(url).search), ['?uno=2']);
        assert.equal(afterFirstLaunch.runState.completed, 1);
        assert.equal(afterFirstLaunch.runState.total, 2);

        await page.goto(hubUrl, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });
        await page.waitForURL('**/as/lplayer/index.cfm?uno=2', { timeout: 10_000 });

        const runState = await page.evaluate(() => JSON.parse(localStorage.getItem('question-hub-run-state')));
        const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('question-hub-selected-links')));
        assert.equal(runState.completed, 2);
        assert.equal(runState.total, 2);
        assert.deepEqual(selected, []);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script can stop a running question hub queue', { timeout: 20_000 }, async () => {
    const html = `
        <!doctype html>
        <html>
        <body>
            <main>
                <div class="unit-box">
                    <a class="btn" href="/as/lplayer/index.cfm?uno=1">Q1.学習する</a>
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
        await page.addInitScript(() => {
            window.chrome = {
                runtime: {
                    onMessage: { addListener() { } },
                    sendMessage() {
                        return Promise.resolve({});
                    }
                }
            };
        });

        await page.goto(`http://127.0.0.1:${port}/student/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            localStorage.setItem(
                'question-hub-run-state',
                JSON.stringify({
                    active: true,
                    queue: [`${location.origin}/as/lplayer/index.cfm?uno=1`],
                    completed: 0,
                    total: 1,
                    hubUrl: location.href
                })
            );
        });
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });
        await page.waitForSelector('#question-hub-control', { timeout: 10_000 });
        await page.click('#question-hub-stop-btn');

        const state = await page.evaluate(() => ({
            runState: localStorage.getItem('question-hub-run-state'),
            pending: localStorage.getItem('question-hub-pending-auto-url'),
            status: document.getElementById('question-hub-status').textContent
        }));
        assert.equal(state.runState, null);
        assert.equal(state.pending, null);
        assert.equal(state.status, '選択 0件');
        assert.match(page.url(), /\/student\/$/);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('content script starts auto mode after question hub direct navigation', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['correct'],
                displayOrder: 1,
                isAutoAdvance: false,
                questionNo: '1',
                rawText: 'Choose the correct answer.',
                signature: 'choosethecorrectanswer',
                type: 'choice'
            }
        ]
    };
    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div></div></div>
            <main>
                <div>1 / 1</div>
                <div>Choose the correct answer.</div>
                <button>correct</button>
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

        const quizUrl = `http://127.0.0.1:${port}/as/lplayer/index.cfm?uno=1`;
        await page.goto(quizUrl, { waitUntil: 'domcontentloaded' });
        await page.evaluate(url => {
            localStorage.setItem('question-hub-pending-auto-url', url);
        }, quizUrl);
        await page.addScriptTag({ path: path.join(extensionDir, 'content.js') });

        await page.waitForFunction(() => window.__solvedQuestions.length === 1, { timeout: 10_000 });
        const state = await page.evaluate(() => ({
            solved: window.__solvedQuestions,
            autoMode: localStorage.getItem('auto-mode'),
            autoUrl: localStorage.getItem('auto-mode-url'),
            pending: localStorage.getItem('question-hub-pending-auto-url')
        }));
        assert.deepEqual(state.solved, ['Choose the correct answer.']);
        assert.equal(state.autoMode, 'true');
        assert.equal(state.autoUrl, quizUrl);
        assert.equal(state.pending, null);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
