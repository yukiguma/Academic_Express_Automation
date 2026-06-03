const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const saveSuccess = '{"success":true,"result":""}';

function parseSavedAnswer(body) {
    const params = new URLSearchParams(body);
    return {
        answer: params.get('answer'),
        correctFlag: params.get('correct_flag'),
        method: params.get('method'),
        missCount: params.get('miss_cnt'),
        questionNo: params.get('question_no'),
        saveType: params.get('save_type'),
        soundCount: params.get('sound_cnt')
    };
}

function dictation3ExpectedQuestions() {
    return [
        ['20280414', 'dictation', 'I have to go to the bank before lunch.'],
        ['203016143', 'dictation', "Don't be lazy. You have to study English harder."],
        ['20275814', 'dictation', 'It was snowing when I arrived at the library.'],
        ['20302814', 'dictation', 'My uncle liked singing so he became a singer.'],
        ['20296914', 'dictation', 'You have to take off your shoes here.'],
        ['20288014', 'dictation', 'My brother and I were playing catch this morning.'],
        ['20303814', 'dictation', 'We can stay home and study by computer.'],
        ['20296514', 'dictation', 'Look at those white clouds in the blue sky.'],
        ['203143143', 'dictation', "You look very sick. What's the matter with you?"],
        ['20299014', 'dictation', 'I believe her because she never tells a lie.']
    ];
}

async function waitForSavedQuestionCount(saveRequests, count, timeoutMs = 45_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const writes = saveRequests
            .filter(request => request.method === 'POST')
            .map(request => parseSavedAnswer(request.body))
            .filter(answer => answer.questionNo);
        if (writes.length >= count) return writes;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);
    throw new Error(`Timed out waiting for ${count} saved dictation answers: ${JSON.stringify(writes)}`);
}

async function runDictationFixture({ expectedAnswer, fixtureName, questionNo, startFirst = false }) {
    const fixtureDir = path.join(__dirname, 'fixtures', fixtureName);
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.deepEqual(questionData.questions.map(question => [question.questionNo, question.type, question.answers[0]]), [
        [questionNo, 'dictation', expectedAnswer]
    ]);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        returnPaths: ['/student/cw/unit/1322'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'ディクタン _ Academic Express3.html'],
            ['/as/lplayer/bundle.js', 'bundle.js'],
            ['/as/lplayer/.authoring.cfc', 'authoring.cfc'],
            ['/as/lplayer/authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        pageReadySelector: '[class*="AppPc__root"]',
        preparePage: startFirst
            ? async page => {
                await page.getByRole('button', { name: 'スタート' }).click();
                await page.waitForSelector('text=スタート', { state: 'detached', timeout: 10_000 }).catch(() => { });
            }
            : undefined,
        questionData,
        server,
        waitFor: page => page.waitForURL(/\/student\/cw\/unit\/1322/, { timeout: 45_000 })
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);

    assert.deepEqual(writes, [{
        answer: '',
        correctFlag: '5',
        method: 'write_answer_au',
        missCount: '0',
        questionNo,
        saveType: '1',
        soundCount: '1'
    }]);
}

test('Dictation fixture is auto-solved with keyboard events and exited', { timeout: 60_000 }, async () => {
    await runDictationFixture({
        expectedAnswer: 'We can stay home and study by computer.',
        fixtureName: 'Dictation',
        questionNo: '20303814',
        startFirst: true
    });
});

test('Dictation2 fixture starts after an already-open prefix and exits', { timeout: 60_000 }, async () => {
    await runDictationFixture({
        expectedAnswer: 'began studying for his English test early this morning.',
        fixtureName: 'Dictation2',
        questionNo: '20274614',
        startFirst: true
    });
});

test('Dictation3 fixture with QuestionHeader layout shows controls', { timeout: 30_000 }, async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'Dictation3');
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.equal(questionData.questions.length, 10);

    const { server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        routes: new Map([
            ['/as/lplayer/index.cfm', 'ディクタン _ Academic Express3.html'],
            ['/as/lplayer/bundle.js', 'bundle.js'],
            ['/as/player_data/authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        clickSolve: false,
        pageReadySelector: '[class*="QuestionHeader__innerContainer"]',
        questionData,
        server
    });
});

test('Dictation3 fixture auto-solves consecutive questions without skipping', { timeout: 75_000 }, async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'Dictation3');
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    const expectedQuestions = dictation3ExpectedQuestions();
    assert.deepEqual(questionData.questions.map(question => [question.questionNo, question.type, question.answers[0]]), expectedQuestions);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        routes: new Map([
            ['/as/lplayer/index.cfm', 'ディクタン _ Academic Express3.html'],
            ['/as/lplayer/bundle.js', 'bundle.js'],
            ['/as/player_data/authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        pageReadySelector: '[class*="QuestionHeader__innerContainer"]',
        questionData,
        server,
        waitFor: () => waitForSavedQuestionCount(saveRequests, expectedQuestions.length)
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);
    assert.deepEqual(writes.map(({ soundCount, ...write }) => write), expectedQuestions.map(([questionNo], index) => ({
        answer: '',
        correctFlag: '5',
        method: 'write_answer_au',
        missCount: '0',
        questionNo,
        saveType: index === expectedQuestions.length - 1 ? '1' : '0'
    })));
});
