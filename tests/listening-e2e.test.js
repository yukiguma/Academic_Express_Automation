const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'ListeningTest');
const shuffledFixtureDir = path.join(__dirname, 'fixtures', 'ListeningTest3');
const saveSuccess = '{"success":true,"result":""}';

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

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', fs.readFileSync(path.join(fixtureDir, 'flash', 'data_manipulate.cfc'))]
        ]),
        fixtureDir,
        returnPaths: ['/student/cw/unit/1322'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Academic Express3.html'],
            ['/as/lplayer/player-standard.js', 'player-standard.js'],
            ['/as/lplayer/player_additional.css', 'player_additional.css'],
            ['/as/lplayer/authoring.xml', 'authoring.xml']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: page => page.waitForURL(/\/student\/cw\/unit\/1322/, { timeout: 45_000 })
    });

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

test('ListeningTest3 shuffled fixture is solved by current media signature', { timeout: 60_000 }, async () => {
    const payload = fs.readFileSync(path.join(shuffledFixtureDir, 'question_authoring.cfc'), 'utf8');
    const questionData = parser.parseQuestionData(payload).parsed;
    const expectedAnswers = {
        1489: '4',
        14948: '1',
        1594: '2',
        14866: '4',
        15006: '1',
        14768: '2',
        1596: '3',
        1494: '4',
        1597: '2',
        1591: '4'
    };

    assert.equal(questionData.questions.length, Object.keys(expectedAnswers).length);
    assert.ok(questionData.questions.every(question => question.shuffleQuestions === true));
    assert.ok(questionData.questions.every(question => question.mediaSignatures?.length > 0));

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/player_data/question_authoring.cfc', payload],
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir: shuffledFixtureDir,
        returnPaths: ['/student/cw/unit/1361'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Academic Express3.html'],
            ['/as/lplayer/player-standard.js', 'player-standard.js'],
            ['/as/lplayer/player_additional.css', 'player_additional.css'],
            ['/as/lplayer/Academic Express3_files/player_additional.css', 'player_additional.css'],
            ['/as/player_data/question_authoring.cfc', 'question_authoring.cfc']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: page => page.waitForURL(/\/student\/cw\/unit\/1361/, { timeout: 45_000 })
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);

    assert.deepEqual(
        Object.fromEntries(writes.map(write => [write.questionNo, write.answerNo])),
        expectedAnswers
    );
    assert.ok(writes.every(write => write.correct === 'true'));
    assert.ok(writes.every(write => write.correctFlag === '1'));
    assert.equal(writes.at(-1).totalScore, '100');
    assert.equal(writes.at(-1).saveType, '1');
});
