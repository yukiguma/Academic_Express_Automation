const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const parser = require('../extension/parser.js');

const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
    return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function readNestedFixture(...parts) {
    return fs.readFileSync(path.join(fixturesDir, ...parts), 'utf8');
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

test('parses listening cloze CFC fixture with mixed question types', () => {
    const { parsed, dataType } = parser.parseQuestionData(readNestedFixture('ListeningTest2', 'authoring.cfc'));

    assert.equal(dataType, 'xml');
    assert.equal(parsed.questions.length, 6);
    assert.deepEqual(parsed.questions.map(q => q.type), [
        'trueFalse',
        'trueFalse',
        'multipleChoice',
        'multipleChoice',
        'typing',
        'typing'
    ]);
    assert.deepEqual(parsed.questions.map(q => q.questionNo), [
        '30308812',
        '30308912',
        '30309012',
        '30309112',
        '30309212',
        '30028710'
    ]);
    assert.deepEqual(parsed.questions[4].answers, ['software']);
    assert.deepEqual(parsed.questions[5].answers, [
        'everything',
        'How',
        'about',
        'Here',
        'appreciate',
        'work',
        'recommend',
        'fantastic',
        'close',
        'to'
    ]);
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

test('parses saved vocabulary bank payload as wd_type 5 questions', () => {
    const { parsed, dataType } = parser.parseQuestionData(readNestedFixture('VocabularyBank', 'tango_data_manipulate.cfc'));

    assert.equal(dataType, 'json');
    assert.equal(parsed.questions.length, 10);
    assert.deepEqual(parsed.questions.slice(0, 6).map(q => [q.rawText, q.answers[0]]), [
        ['broad', '（幅が）広い'],
        ['aware', '気付いて、意識して、わかって'],
        ['recorder', '録音機器、録画機器'],
        ['since', '～して以来'],
        ['butterfly', '蝶'],
        ['rely', '頼る、あてにする（on ～で）']
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
