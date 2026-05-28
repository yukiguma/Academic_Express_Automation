const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'VocabularyBank');
const spellingFixtureDir = path.join(__dirname, 'fixtures', 'VocabrarySpelling');

const expectedProgress = [
    ['551', '（幅が）広い'],
    ['6371', '気付いて、意識して、わかって'],
    ['118079', '録音機器、録画機器'],
    ['105462', '～して以来'],
    ['9343', '蝶'],
    ['7435', '頼る、あてにする（on ～で）'],
    ['80', '返事、返答'],
    ['601', 'カラフルな、変化に富んだ、面白い'],
    ['4493', '重さ、重量、体重'],
    ['4062', '最近の、最新の']
];

const expectedSpellingWordNos = ['3526', '3405', '9696', '100012', '100088'];

function parseProgressSave(body) {
    const params = new URLSearchParams(body);
    if (params.get('method') !== 'save_progress_up') return null;

    const data = JSON.parse(params.get('data') || '{}');
    return {
        answer: data.answer,
        okFlag: String(data.ok_flag),
        saveType: String(data.save_type),
        wordNo: String(data.word_no)
    };
}

async function waitForProgressSaves(saveRequests, expectedCount) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45_000) {
        const count = saveRequests
            .map(request => parseProgressSave(request.body))
            .filter(Boolean)
            .length;
        if (count >= expectedCount) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`Expected ${expectedCount} vocabulary progress saves, got ${saveRequests.length}`);
}

test('VocabularyBank wd_type 5 fixture is auto-solved with Japanese choices', { timeout: 60_000 }, async () => {
    const payload = fs.readFileSync(path.join(fixtureDir, 'tango_data_manipulate.cfc'), 'utf8');
    const questionData = parser.parseQuestionData(payload).parsed;
    assert.equal(questionData.questions.length, expectedProgress.length);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/lplayer/tango_data_manipulate.cfc', payload]
        ]),
        fixtureDir,
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Vocabulary_Bank_Academic_Express3.html'],
            ['/as/lplayer/player-tango.js', 'player-tango.js'],
            ['/as/lplayer/tango_data_manipulate.cfc', 'tango_data_manipulate.cfc']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: () => waitForProgressSaves(saveRequests, expectedProgress.length)
    });

    const progress = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseProgressSave(request.body))
        .filter(Boolean);
    const uniqueProgress = Array.from(
        new Map(progress.map(entry => [entry.wordNo, entry])).values()
    );

    assert.deepEqual(
        uniqueProgress
            .map(entry => [entry.wordNo, entry.answer])
            .sort(([left], [right]) => Number(left) - Number(right)),
        expectedProgress.sort(([left], [right]) => Number(left) - Number(right))
    );
    assert.ok(uniqueProgress.every(entry => entry.okFlag === '1'));
    assert.equal(uniqueProgress.at(-1).saveType, '1');
});

test('VocabrarySpelling wd_type 2 fixture is auto-solved with keyboard input', { timeout: 60_000 }, async () => {
    const payload = fs.readFileSync(path.join(spellingFixtureDir, 'tango_data_manipulate.cfc'), 'utf8');
    const questionData = parser.parseQuestionData(payload).parsed;
    assert.equal(questionData.questions.length, expectedSpellingWordNos.length);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/tango_data_manipulate.cfc', payload]
        ]),
        fixtureDir: spellingFixtureDir,
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Vocabulary Bank _ Academic Express3.html'],
            ['/as/lplayer/player-tango.js', 'player-tango.js'],
            ['/as/flash/tango_data_manipulate.cfc', 'tango_data_manipulate.cfc']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: async page => {
            await waitForProgressSaves(saveRequests, expectedSpellingWordNos.length);
            await page.waitForFunction(() => {
                const visibleButtons = Array.from(document.querySelectorAll('button')).filter(button => {
                    return button.offsetWidth || button.offsetHeight || button.getClientRects().length;
                });
                return visibleButtons.some(button => button.textContent.includes('前のページに戻る')) &&
                    !visibleButtons.some(button => button.textContent.includes('続ける'));
            }, { timeout: 10_000 });
        }
    });

    const progress = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseProgressSave(request.body))
        .filter(Boolean);
    const uniqueProgress = Array.from(
        new Map(progress.map(entry => [entry.wordNo, entry])).values()
    );

    assert.deepEqual(
        uniqueProgress.map(entry => entry.wordNo).sort((left, right) => Number(left) - Number(right)),
        expectedSpellingWordNos.sort((left, right) => Number(left) - Number(right))
    );
    assert.ok(uniqueProgress.every(entry => entry.answer === ''));
    assert.ok(uniqueProgress.every(entry => entry.okFlag === '1'));
    assert.equal(uniqueProgress.at(-1).saveType, '1');
});
