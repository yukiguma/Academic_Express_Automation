const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'Dictation');
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

test('Dictation fixture is auto-solved with keyboard events and exited', { timeout: 60_000 }, async () => {
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.deepEqual(questionData.questions.map(question => [question.questionNo, question.type, question.answers[0]]), [
        ['20303814', 'dictation', 'We can stay home and study by computer.']
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
            ['/as/lplayer/.authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        pageReadySelector: '[class*="AppPc__root"]',
        preparePage: page => page.getByRole('button', { name: 'スタート' }).click(),
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
        questionNo: '20303814',
        saveType: '1',
        soundCount: '1'
    }]);
});
