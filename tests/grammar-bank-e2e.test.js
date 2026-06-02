const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'GrammarBank');

async function waitForGrammarSaves(saveRequests, expectedCount) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 75_000) {
        const count = saveRequests
            .filter(request => request.method === 'POST')
            .map(request => parseSavedAnswer(request.body))
            .filter(answer => answer.method === 'save_answer_s')
            .length;
        if (count >= expectedCount) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`Expected ${expectedCount} GrammarBank answer saves, got ${saveRequests.length}`);
}

function parseSavedAnswer(body) {
    const params = new URLSearchParams(body);
    const data = JSON.parse(params.get('data') || '{}');
    const answerXml = data.answer || params.get('answer') || '';

    return {
        answers: [...answerXml.matchAll(/<answer>(.*?)<\/answer>/g)].map(match => match[1]),
        correctFlag: String(data.ok_flag ?? params.get('correct_flag') ?? ''),
        correctValues: [...answerXml.matchAll(/<correct>(.*?)<\/correct>/g)].map(match => match[1]),
        method: params.get('method'),
        questionNo: String(data.question_no ?? params.get('question_no') ?? ''),
        saveType: String(data.save_type ?? params.get('save_type') ?? '')
    };
}

test('GrammarBank sortingA fixture is auto-solved and submitted through completion', { timeout: 75_000 }, async () => {
    const fullPayload = fs.readFileSync(path.join(fixtureDir, 'question_authoring.cfc'), 'utf8');
    const sortingQuestion = fullPayload.match(/<question no="20014317"[\s\S]*?<\/question>/)?.[0];
    assert.ok(sortingQuestion);

    const payload = fullPayload
        .replace('shuffleQuestions="true"', 'shuffleQuestions="false"');
    const singleQuestionPayload = payload.replace(
        /<questions>[\s\S]*?<\/questions>/,
        `<questions>${sortingQuestion}</questions>`
    );
    const questionData = parser.parseQuestionData(singleQuestionPayload).parsed;
    const expectedQuestionNos = questionData.questions.map(question => question.questionNo).sort();

    assert.deepEqual(
        questionData.questions.map(question => question.type).reduce((counts, type) => {
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {}),
        { sorting: 1 }
    );

    const { saveRequests, server } = createFixtureServer({
        apiResponses: new Map([
            ['/as/player_data/question_authoring.cfc', singleQuestionPayload],
            ['/as/flash/data_manipulate.cfc', '{"success":true,"result":""}']
        ]),
        fixtureDir,
        returnPaths: ['/student/cw/unit/1332'],
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Grammar Bank _ Academic Express3.html'],
            ['/as/lplayer/player-supergrammar.js', 'player-supergrammar.js'],
            ['/as/player_data/question_authoring.cfc', 'question_authoring.cfc']
        ])
    });

    await runAutoSolve({
        questionData,
        server,
        waitFor: async page => {
            await waitForGrammarSaves(saveRequests, expectedQuestionNos.length);
            await page.waitForFunction(() => {
                const text = document.body.innerText || '';
                return text.includes('解答・解説') || text.includes('点');
            }, { timeout: 10_000 });
        }
    });

    const writes = saveRequests
        .filter(request => request.method === 'POST')
        .map(request => parseSavedAnswer(request.body))
        .filter(answer => answer.method === 'save_answer_s');

    assert.deepEqual(writes.map(write => write.questionNo).sort(), expectedQuestionNos);
    assert.ok(writes.every(write => write.correctFlag === '1'));
    assert.ok(writes.every(write => write.correctValues.every(correct => correct === 'true')));
    assert.equal(writes.at(-1).saveType, '1');
});
