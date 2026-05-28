const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');

const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');

function readFixture(name) {
    return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function readSavedBodyFixture(name) {
    const html = readFixture(name);
    const match = html.match(/<body>([\s\S]*)<\/body>/i);
    assert.ok(match, `${name} should contain a saved body`);
    return match[1].trim();
}

test('parses listening XML answers through numbered choices', () => {
    const { parsed, dataType } = parser.parseQuestionData(readFixture('authoring.xml'));

    assert.equal(dataType, 'xml');
    assert.equal(parsed.questions.length, 9);
    assert.deepEqual(
        parsed.questions.map(q => q.answers[0]),
        ['b.', 'd.', 'd.', 'b.', 'a.', 'b.', 'Location', 'By special phone.', 'Sunny.']
    );
    assert.equal(parsed.questions[0].rawText, 'Click your answer on the screen.');
    assert.equal(parsed.questions[0].signature, 'clickyouransweronthescreen');
    assert.equal(parsed.questions[0].displayOrder, 1);
    assert.equal(parsed.questions[0].questionNo, '1590');
});

test('parses reading XML question range fixture', () => {
    const { parsed } = parser.parseQuestionData(readFixture('authoring2.xml'));

    assert.equal(parsed.questions.length, 5);
    assert.deepEqual(
        parsed.questions.map(q => q.answers[0]),
        [
            'Venezuela',
            'Thousands of barrels each day',
            'Basketball',
            'Three seconds',
            'The regional championship'
        ]
    );
    assert.equal(parsed.questions[1].rawText, 'What is the unit of measure for the oil?');
    assert.equal(parsed.questions[4].displayOrder, 5);
});

test('parses shuffled question authoring XML by question text and exact answers', () => {
    const { parsed } = parser.parseQuestionData(readFixture('question_authoring.xml'));

    assert.equal(parsed.questions.length, 23);

    const shuffledExample = parsed.questions.find(q => q.rawText === 'I was very late because I took the ------- bus.');
    assert.ok(shuffledExample);
    assert.deepEqual(shuffledExample.answers, ['wrong']);
    assert.equal(shuffledExample.displayOrder, 8);

    const apostropheExample = parsed.questions.find(q => q.rawText === 'Sue went to a ------- high school.');
    assert.ok(apostropheExample);
    assert.deepEqual(apostropheExample.answers, ["girls'"]);
});

test('parses saved tango payload as bidirectional wd_type 7 questions', () => {
    const { parsed, dataType } = parser.parseQuestionData(readSavedBodyFixture('tango_data_manipulate.htm'));

    assert.equal(dataType, 'json');
    assert.equal(parsed.questions.length, 20);
    assert.deepEqual(parsed.questions.slice(0, 6).map(q => [q.rawText, q.answers[0]]), [
        ['はがき', 'postcard'],
        ['postcard', 'はがき'],
        ['（手紙の冒頭で）親愛なる、いとしい、かわいい', 'dear'],
        ['dear', '（手紙の冒頭で）親愛なる、いとしい、かわいい'],
        ['可能にする', 'enable'],
        ['enable', '可能にする']
    ]);
    assert.ok(parsed.questions.every(q => q.isAutoAdvance));
});

test('parses tango direction and typing variants without using know_chk as an answer', () => {
    const baseQuestion = {
        keyword: { ja: 'はがき', en: 'postcard' },
        tangolists_jan: ['はがき', '神話'],
        tangolists_eng: ['postcard', 'myth'],
        know_chk: 'known',
        word_no: 9747
    };

    assert.deepEqual(parser.parseJSON({ wd_type: 1, questions: [baseQuestion] }).questions.map(q => [q.rawText, q.answers[0]]), [
        ['はがき', 'postcard']
    ]);
    assert.deepEqual(parser.parseJSON({ wd_type: 5, questions: [baseQuestion] }).questions.map(q => [q.rawText, q.answers[0]]), [
        ['postcard', 'はがき']
    ]);
    assert.deepEqual(parser.parseJSON({ wd_type: 2, questions: [baseQuestion] }).questions.map(q => [q.type, q.rawText, q.answers[0]]), [
        ['typing', 'はがき', 'postcard']
    ]);
});

test('normalizes text without losing meaningful apostrophes', () => {
    assert.equal(parser.unwrapText('<p><![CDATA[Tom &amp; Jerry&nbsp;]]></p>'), 'Tom & Jerry');
    assert.equal(parser.makeSignature('The [girls\'] answer'), 'theanswer');
});
