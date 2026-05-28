const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const saveSuccess = '{"success":true,"result":""}';

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

test('VocabraryMatching fixture is auto-solved and submitted through grading', { timeout: 60_000 }, async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'VocabraryMatching');
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    assert.deepEqual(questionData.questions.map(question => [question.questionNo, question.type]), [
        ['16269', 'matching']
    ]);

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        returnPaths: ['/student/reading/unit/970'],
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
        waitFor: page => page.waitForURL(/\/student\/reading\/unit\/970/, { timeout: 45_000 })
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.questionNo);

    assert.deepEqual(writes.map(write => [write.questionNo, write.answers]), [
        ['16269', ['0', '1', '2', '3', '4', '5', '6', '7']]
    ]);
    assert.ok(writes.every(write => write.correctValues.every(correct => correct === 'true')));
    assert.ok(writes.every(write => write.correctFlag === '1'));
    assert.equal(writes.at(-1).totalScore, '100');
    assert.equal(writes.at(-1).saveType, '1');
});

test('Scanning fixture is auto-solved after the start screen and submitted through grading', { timeout: 60_000 }, async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'Scanning');
    const questionData = parser.parseQuestionData(fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')).parsed;
    const expectedWrites = [
        ['5914', ['In 1847 he was elected for two years to the House of Representatives.']],
        ['5916', ['Lincoln thought slavery was evil and joined the Republican Party, which opposed it.']],
        ['5918', ['Lincoln was re-elected president in 1864 and the Confederates surrendered shortly afterwards.']]
    ];
    assert.deepEqual(
        questionData.questions.map(question => [question.questionNo, question.type, question.answers]),
        expectedWrites.map(([questionNo, answers]) => [questionNo, 'scanning', answers])
    );

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/flash/data_manipulate.cfc', saveSuccess]
        ]),
        fixtureDir,
        returnPaths: ['/student/reading/unit/886'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Reading Bank _ Academic Express3.html'],
            ['/as/lplayer/player-scanning.js', 'player-scanning.js'],
            ['/as/lplayer/Reading Bank _ Academic Express3_files/css', 'css'],
            ['/as/lplayer/Reading Bank _ Academic Express3_files/icon', 'icon'],
            ['/as/lplayer/Reading Bank _ Academic Express3_files/webfont.js.ダウンロード', 'webfont.js.ダウンロード'],
            ['/as/lplayer/authoring.cfc', 'authoring.cfc']
        ])
    });

    await runAutoSolve({
        preparePage: page => page.getByText('スタート').click(),
        questionData,
        server,
        waitFor: page => page.waitForURL(/\/student\/reading\/unit\/886/, { timeout: 45_000 })
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
    assert.ok(writes.every(write => write.totalScore === '100'));
    assert.ok(writes.every(write => write.saveType === '1'));
});
