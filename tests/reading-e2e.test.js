const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'ReadingTest');

const expectedWrites = [
    ['6613', '0'],
    ['30165411', '1'],
    ['30165511', '2'],
    ['30257711', 'refused'],
    ['30165711', '3'],
    ['30257911', '2']
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

test('ReadingTest fixture is auto-solved and submitted through grading', { timeout: 60_000 }, async () => {
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.equal(questionData.questions.length, expectedWrites.length);
    assert.deepEqual(
        questionData.questions.map(question => [question.questionNo, question.answers[0]]),
        [
            ['6613', 'He knew, however, that he could never be a great sculptor without knowing how to draw.'],
            ['30165411', 'True'],
            ['30165511', 'False'],
            ['30257711', 'refused'],
            ['30165711', "Michelangelo's nose"],
            ['30257911', 'lead']
        ]
    );

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', '{"success":true,"result":""}']
        ]),
        fixtureDir,
        returnPaths: ['/student/reading/unit/884'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Academic Express3.html'],
            ['/as/lplayer/player-standard.js', 'player-standard.js'],
            ['/as/lplayer/player_additional.css', 'player_additional.css'],
            ['/as/lplayer/Academic Express3_files/player_additional.css', 'player_additional.css'],
            ['/as/lplayer/authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: page => page.waitForURL(/\/student\/reading\/unit\/884/, { timeout: 45_000 })
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
