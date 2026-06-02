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
