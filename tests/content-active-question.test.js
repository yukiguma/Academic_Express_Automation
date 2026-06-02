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

test('content script scopes shuffled auto-advance typing to the current visible question box', { timeout: 20_000 }, async () => {
    const questionData = {
        questions: [
            {
                answers: ['The tax burden has increased since last year.'],
                displayOrder: 1,
                isAutoAdvance: true,
                questionNo: '101',
                rawText: 'The tax [burden] has increased since last year.',
                signature: 'thetaxburdenhasincreasedsincelastyear',
                shuffleQuestions: true,
                type: 'sentenceTyping'
            },
            {
                answers: ['To know more about this, you can ask at the sales division.'],
                displayOrder: 2,
                isAutoAdvance: true,
                questionNo: '102',
                rawText: 'To know more about this, you can ask at the sales [division].',
                signature: 'toknowmoreaboutthisyoucanaskatthesalesdivision',
                shuffleQuestions: true,
                type: 'sentenceTyping'
            },
            {
                answers: ['unused third'],
                displayOrder: 3,
                isAutoAdvance: true,
                questionNo: '103',
                rawText: 'unused third',
                signature: 'unusedthird',
                shuffleQuestions: true,
                type: 'typing'
            },
            {
                answers: ['unused fourth'],
                displayOrder: 4,
                isAutoAdvance: true,
                questionNo: '104',
                rawText: 'unused fourth',
                signature: 'unusedfourth',
                shuffleQuestions: true,
                type: 'typing'
            },
            {
                answers: ['confident'],
                displayOrder: 5,
                isAutoAdvance: true,
                questionNo: '105',
                rawText: '自信がある、確信して、自信に満ちた',
                signature: '自信がある確信して自信に満ちた',
                shuffleQuestions: true,
                type: 'typing'
            }
        ]
    };

    const html = `
        <!doctype html>
        <html>
        <body>
            <div class="AppHeader__fixed-top"><div><div>前のページに戻る</div><span>3 / 5</span></div></div>
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
