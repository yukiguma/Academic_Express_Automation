const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('@playwright/test');

const extensionDir = path.join(__dirname, '..', 'extension');

test('solver fast mode preserves explicit sorting waits', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main id="scope">
                <ul class="SortingAQuestionBuilder__sortStringList___test">
                    <li>alpha</li>
                    <li>beta</li>
                </ul>
            </main>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        const duration = await page.evaluate(async () => {
            window.__ACADEMIC_EXPRESS_FAST_MODE__ = true;
            const startedAt = performance.now();
            await solve(['alpha', 'beta'], 'sorting', document.getElementById('scope'));
            return performance.now() - startedAt;
        });

        assert.ok(duration >= 170, `Expected sorting waits to be preserved, got ${duration}ms`);
    } finally {
        await browser.close();
    }
});

test('sorting solver does not click tokens outside a scoped sorting list', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main>
                <section id="current">
                    <ul class="SortingAQuestionBuilder__sortStringList___test">
                        <li>alpha</li>
                    </ul>
                </section>
                <section id="stale">
                    <ul class="SortingAQuestionBuilder__sortStringList___test">
                        <li>beta</li>
                    </ul>
                </section>
                <script>
                    window.clicked = [];
                    document.querySelectorAll('li').forEach(item => {
                        item.addEventListener('click', () => window.clicked.push(item.textContent.trim()));
                    });
                </script>
            </main>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            window.__ACADEMIC_EXPRESS_FAST_MODE__ = true;
            await solve(['alpha', 'beta'], 'sorting', document.getElementById('current'));
        });

        const clicked = await page.evaluate(() => window.clicked);
        assert.deepEqual(clicked, ['alpha']);
    } finally {
        await browser.close();
    }
});

test('FontBox typing waits for each accepted key before sending the next', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main id="scope">
                ${Array.from('journal').map(char => `
                    <div class="FontBox__fontBox___1uhRR">
                        <div class="FontBox__label_txt___3GGpp">${char}</div>
                    </div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                let busy = false;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    if (busy) return;

                    const expected = 'journal'[index];
                    if (event.key !== expected) return;

                    busy = true;
                    window.acceptedKeys.push(event.key);
                    setTimeout(() => {
                        boxes[index].className += ' FontBox__fontBox_ok___VnRUk';
                        index += 1;
                        busy = false;
                    }, 50);
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(['journal'], 'typing', document.getElementById('scope'));
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, 'journal');
    } finally {
        await browser.close();
    }
});

test('keyboard dispatch uses physical key codes for letters and punctuation', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <script>
                window.events = [];
                for (const name of ['keydown', 'keypress', 'keyup']) {
                    document.addEventListener(name, event => {
                        window.events.push({
                            type: event.type,
                            key: event.key,
                            code: event.code,
                            charCode: event.charCode,
                            keyCode: event.keyCode,
                            shiftKey: event.shiftKey,
                            which: event.which
                        });
                    });
                }
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        const events = await page.evaluate(() => {
            dispatchKeyboardChar('o', document);
            dispatchKeyboardChar('?', document);
            dispatchKeyboardChar("'", document);
            return window.events;
        });

        assert.deepEqual(events.slice(0, 3), [
            { type: 'keydown', key: 'o', code: 'KeyO', charCode: 0, keyCode: 79, shiftKey: false, which: 79 },
            { type: 'keypress', key: 'o', code: 'KeyO', charCode: 111, keyCode: 111, shiftKey: false, which: 111 },
            { type: 'keyup', key: 'o', code: 'KeyO', charCode: 0, keyCode: 79, shiftKey: false, which: 79 }
        ]);
        assert.deepEqual(events.slice(3, 6), [
            { type: 'keydown', key: '?', code: 'Slash', charCode: 0, keyCode: 191, shiftKey: true, which: 191 },
            { type: 'keypress', key: '?', code: 'Slash', charCode: 63, keyCode: 63, shiftKey: true, which: 63 },
            { type: 'keyup', key: '?', code: 'Slash', charCode: 0, keyCode: 191, shiftKey: true, which: 191 }
        ]);
        assert.deepEqual(events.slice(6, 9), [
            { type: 'keydown', key: "'", code: 'Quote', charCode: 0, keyCode: 222, shiftKey: false, which: 222 },
            { type: 'keypress', key: "'", code: 'Quote', charCode: 39, keyCode: 39, shiftKey: false, which: 39 },
            { type: 'keyup', key: "'", code: 'Quote', charCode: 0, keyCode: 222, shiftKey: false, which: 222 }
        ]);
    } finally {
        await browser.close();
    }
});

test('Dictation solver sends only input letters and digits', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main>
                <div class="QuestionArea__dictationArea___test">
                    D o n ' t   b e   l a z y .   W h a t ' s   t h e   m a t t e r   w i t h   y o u ?
                </div>
            </main>
            <script>
                window.keypresses = [];
                document.addEventListener('keypress', event => {
                    window.keypresses.push(event.key);
                    document.querySelector('[class*="dictationArea"]').textContent += event.key;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        const keys = await page.evaluate(async () => {
            window.__ACADEMIC_EXPRESS_FAST_MODE__ = true;
            await solve(["Don't be lazy. What's the matter with you?"], 'dictation', document);
            return window.keypresses.join('');
        });

        assert.equal(keys, "DontbelazyWhatsthematterwithyou");
    } finally {
        await browser.close();
    }
});

test('Dictation solver waits for the current question text before typing', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main>
                <div id="dictation-question" class="QuestionArea__dictationArea___test">
                    O l d   q u e s t i o n .
                </div>
            </main>
            <script>
                window.keypresses = [];
                window.firstKeyAt = null;
                window.questionReadyAt = null;
                document.addEventListener('keypress', event => {
                    window.keypresses.push(event.key);
                    window.firstKeyAt = window.firstKeyAt || performance.now();
                    document.getElementById('dictation-question').textContent += event.key;
                });
                setTimeout(() => {
                    document.getElementById('dictation-question').textContent =
                        'T h i s   t e a   i s   t o o   h o t   f o r   m e   t o   d r i n k .';
                    window.questionReadyAt = performance.now();
                }, 250);
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        const result = await page.evaluate(async () => {
            window.__ACADEMIC_EXPRESS_FAST_MODE__ = true;
            await solve(['This tea is too hot for me to drink.'], 'dictation', document);
            return {
                firstKeyAt: window.firstKeyAt,
                keypresses: window.keypresses.join(''),
                questionReadyAt: window.questionReadyAt
            };
        });

        assert.equal(result.keypresses, 'Thisteaistoohotformetodrink');
        assert.ok(result.firstKeyAt >= result.questionReadyAt);
    } finally {
        await browser.close();
    }
});

test('Dictation solver defers when a dispatched key is not accepted', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <main>
                <div class="QuestionArea__dictationArea___test">
                    T h i s   t e a   i s   t o o   h o t   f o r   m e   t o   d r i n k .
                </div>
            </main>
            <script>
                window.keypresses = [];
                document.addEventListener('keypress', event => {
                    window.keypresses.push(event.key);
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        const result = await page.evaluate(async () => {
            window.__ACADEMIC_EXPRESS_FAST_MODE__ = true;
            const solved = await solve(['This tea is too hot for me to drink.'], 'dictation', document);
            return {
                keypresses: window.keypresses.join(''),
                solved
            };
        });

        assert.equal(result.solved, false);
        assert.equal(result.keypresses, 'T');
    } finally {
        await browser.close();
    }
});

test('FontBox sentence typing uses bracket text instead of the full sentence', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <style>
                .FontBox__fontBox___1uhRR {
                    display: inline-block;
                    width: 12px;
                    height: 18px;
                }
            </style>
            <main id="scope">
                ${Array.from('bargain').map(() => `
                    <div class="FontBox__fontBox___1uhRR FontBox__hide___1R5sG"></div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    const expected = 'bargain'[index];
                    if (event.key !== expected) return;

                    window.acceptedKeys.push(event.key);
                    boxes[index].className += ' FontBox__fontBox_ok___VnRUk';
                    boxes[index].textContent = event.key;
                    index += 1;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(
                ['The new sofa was half off, so I consider the purchase a bargain.'],
                'sentenceTyping',
                document.getElementById('scope'),
                { rawText: 'The new sofa was half off, so I consider the purchase a [bargain].' }
            );
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, 'bargain');
    } finally {
        await browser.close();
    }
});

test('FontBox sentence typing joins multiple bracket blanks with spaces', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <style>
                .FontBox__fontBox___1uhRR {
                    display: inline-block;
                    width: 12px;
                    height: 18px;
                }
            </style>
            <main id="scope">
                ${Array.from('Bothof').map(() => `
                    <div class="FontBox__fontBox___1uhRR FontBox__hide___1R5sG"></div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    const expected = 'Both of'[index];
                    if (event.key !== expected) return;

                    window.acceptedKeys.push(event.key);
                    if (event.key !== ' ') {
                        const boxIndex = window.acceptedKeys.filter(key => key !== ' ').length - 1;
                        boxes[boxIndex].className += ' FontBox__fontBox_ok___VnRUk';
                        boxes[boxIndex].textContent = event.key;
                    } else {
                        boxes[0].className += ' FontBox__space_accepted___test';
                    }
                    index += 1;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(
                ['Both of us were invited to the party'],
                'sentenceTyping',
                document.getElementById('scope'),
                { rawText: '[Both] [of] us were invited to the party' }
            );
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, 'Both of');
    } finally {
        await browser.close();
    }
});

test('FontBox spelling types spaces inside one bracket blank', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <style>
                .FontBox__fontBox___1uhRR {
                    display: inline-block;
                    width: 12px;
                    height: 18px;
                }
            </style>
            <main id="scope">
                ${Array.from('postoffice').map(() => `
                    <div class="FontBox__fontBox___1uhRR FontBox__hide___1R5sG"></div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    const expected = 'post office'[index];
                    if (event.key !== expected) return;

                    window.acceptedKeys.push(event.key);
                    if (event.key !== ' ') {
                        const boxIndex = window.acceptedKeys.filter(key => key !== ' ').length - 1;
                        boxes[boxIndex].className += ' FontBox__fontBox_ok___VnRUk';
                        boxes[boxIndex].textContent = event.key;
                    } else {
                        boxes[0].className += ' FontBox__space_accepted___test';
                    }
                    index += 1;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(
                ['post office'],
                'typing',
                document.getElementById('scope'),
                { rawText: '郵便局<br />[post office]' }
            );
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, 'post office');
    } finally {
        await browser.close();
    }
});

test('FontBox spelling restores spaces that are blank in DOM labels', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <style>
                .FontBox__fontBox___1uhRR {
                    display: inline-block;
                    width: 12px;
                    height: 18px;
                }
            </style>
            <main id="scope">
                ${Array.from('post office').map(char => `
                    <div class="FontBox__fontBox___1uhRR">
                        <div class="FontBox__label_txt___3GGpp FontBox__label_txt_hide___2FIdR">${char === ' ' ? '' : char}</div>
                    </div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    const expected = 'post office'[index];
                    if (event.key !== expected) return;

                    window.acceptedKeys.push(event.key);
                    boxes[index].className += ' FontBox__fontBox_ok___VnRUk';
                    boxes[index].textContent = event.key;
                    index += 1;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(
                ['post office'],
                'typing',
                document.getElementById('scope'),
                { rawText: '郵便局' }
            );
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, 'post office');
    } finally {
        await browser.close();
    }
});

test('FontBox spelling preserves punctuation while restoring blank labels', { timeout: 20_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setContent(`
            <style>
                .FontBox__fontBox___1uhRR {
                    display: inline-block;
                    width: 12px;
                    height: 18px;
                }
            </style>
            <main id="scope">
                ${Array.from('don\'t.').map(char => `
                    <div class="FontBox__fontBox___1uhRR">
                        <div class="FontBox__label_txt___3GGpp FontBox__label_txt_hide___2FIdR">${/[a-z]/i.test(char) ? char : ''}</div>
                    </div>
                `).join('')}
            </main>
            <script>
                window.acceptedKeys = [];
                let index = 0;
                const boxes = Array.from(document.querySelectorAll('[class*="FontBox__fontBox"]'));

                document.addEventListener('keydown', event => {
                    const expected = "don't."[index];
                    if (event.key !== expected) return;

                    window.acceptedKeys.push(event.key);
                    boxes[index].className += ' FontBox__fontBox_ok___VnRUk';
                    boxes[index].textContent = event.key;
                    index += 1;
                });
            </script>
        `);
        await page.addScriptTag({ path: path.join(extensionDir, 'solvers.js') });

        await page.evaluate(async () => {
            await solve(
                ["don't."],
                'typing',
                document.getElementById('scope'),
                { rawText: 'しない' }
            );
        });

        const acceptedKeys = await page.evaluate(() => window.acceptedKeys.join(''));
        assert.equal(acceptedKeys, "don't.");
    } finally {
        await browser.close();
    }
});
