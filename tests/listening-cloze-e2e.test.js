const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'ListeningTest2');
const saveSuccess = '{"success":true,"result":""}';

const expectedWrites = [
    ['30308812', ['1']],
    ['30308912', ['1']],
    ['30309012', ['3']],
    ['30309112', ['4']],
    ['30309212', ['software']],
    ['30028710', ['everything', 'How', 'about', 'Here', 'appreciate', 'work', 'recommend', 'fantastic', 'close', 'to']]
];

function parseSavedAnswer(body) {
    const params = new URLSearchParams(body);
    const answerXml = params.get('answer') || '';
    const answers = [...answerXml.matchAll(/<answer>(.*?)<\/answer>/g)].map(match => match[1]);
    const correctValues = [...answerXml.matchAll(/<correct>(.*?)<\/correct>/g)].map(match => match[1]);

    return {
        answers,
        correctFlag: params.get('correct_flag'),
        correctValues,
        questionNo: params.get('question_no'),
        saveType: params.get('save_type'),
        totalScore: params.get('totalscore')
    };
}

test('ListeningTest2 cloze fixture is auto-solved and submitted through grading', { timeout: 60_000 }, async () => {
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.equal(questionData.questions.length, expectedWrites.length);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        returnPaths: ['/student/listening/unit/675'],
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
        waitFor: page => page.waitForURL(/\/student\/listening\/unit\/675/, { timeout: 45_000 })
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);

    assert.deepEqual(
        writes.map(write => [write.questionNo, write.answers]),
        expectedWrites
    );
    assert.ok(writes.every(write => write.correctValues.every(correct => correct === 'true')));
    assert.ok(writes.every(write => write.correctFlag === '1'));
    assert.equal(writes.at(-1).totalScore, '100');
    assert.equal(writes.at(-1).saveType, '1');
});
