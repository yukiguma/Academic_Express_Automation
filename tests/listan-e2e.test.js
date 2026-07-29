const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');
const { createFixtureServer, runAutoSolve } = require('./helpers/e2e-harness.js');

test('Listan transcript fixture is auto-entered and judged', { timeout: 30_000 }, async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'Listan');
    const transcript = [
        'Look at the picture on the screen.',
        'a. There is a laptop computer on the desk.',
        'b. There is a computer printer on the desk.',
        'c. There is a vase of tall flowers on the desk.',
        'd. There is a pair of speakers on the desk.'
    ].join(' ');
    const questionData = parser.parseQuestionData(
        fs.readFileSync(path.join(fixtureDir, 'authoring.cfc'), 'utf8')
    ).parsed;

    assert.deepEqual(
        questionData.questions.map(question => [
            question.questionNo,
            question.type,
            question.answers
        ]),
        [['230003479', 'listan', [transcript]]]
    );

    const { server } = createFixtureServer({
        fixtureDir,
        routes: new Map([
            ['/as/lplayer/index.cfm', 'Academic Express3.html']
        ])
    });

    await runAutoSolve({
        fixtureUrlPath: '/as/lplayer/index.cfm?mno=230003479',
        pageReadySelector: '[class*="AppPc__common_inner"]',
        questionData,
        server,
        waitFor: page => page.waitForFunction(
            expected => window.__judgedValue === expected,
            transcript,
            { timeout: 15_000 }
        )
    });
});
