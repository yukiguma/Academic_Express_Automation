const test = require('node:test');
const assert = require('node:assert/strict');
const {
    compareVersions,
    normalizeVersion,
    parseLatestRelease,
    shouldNotify
} = require('../extension/update-checker.js');

test('normalizes release tags using the x.y.z format', () => {
    assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
    assert.equal(normalizeVersion(' 1.10.0 '), '1.10.0');
    assert.equal(normalizeVersion('1.2'), null);
    assert.equal(normalizeVersion('1.2.3-beta.1'), null);
});

test('compares numeric version components', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    assert.equal(compareVersions('1.2.2', '1.2.3'), -1);
});

test('parses a published stable GitHub release', () => {
    assert.deepEqual(parseLatestRelease({
        tag_name: 'v1.3.0',
        draft: false,
        prerelease: false,
        published_at: '2026-07-31T00:00:00Z'
    }), {
        latestVersion: '1.3.0',
        publishedAt: '2026-07-31T00:00:00Z'
    });
});

test('rejects draft, prerelease, and malformed releases', () => {
    assert.equal(parseLatestRelease({ tag_name: 'v1.3.0', draft: true }), null);
    assert.equal(parseLatestRelease({ tag_name: 'v1.3.0', prerelease: true }), null);
    assert.equal(parseLatestRelease({ tag_name: 'latest' }), null);
});

test('notifies only for a newer version that was not dismissed', () => {
    assert.equal(shouldNotify('1.1.2', '1.2.0', null), true);
    assert.equal(shouldNotify('1.1.2', '1.2.0', '1.2.0'), false);
    assert.equal(shouldNotify('1.2.0', '1.2.0', null), false);
    assert.equal(shouldNotify('1.3.0', '1.2.0', null), false);
});
