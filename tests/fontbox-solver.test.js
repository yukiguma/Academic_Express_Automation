const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('@playwright/test');

const extensionDir = path.join(__dirname, '..', 'extension');

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
