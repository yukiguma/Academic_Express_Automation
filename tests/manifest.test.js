const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');

function readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertExtensionFile(relativePath) {
    const filePath = path.join(extensionDir, relativePath);
    assert.ok(fs.existsSync(filePath), `${relativePath} should exist`);
}

test('manifest is valid Manifest V3 and references existing files', () => {
    const manifest = readJSON(path.join(extensionDir, 'manifest.json'));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.background.service_worker, 'background.js');
    assertExtensionFile(manifest.background.service_worker);

    for (const scriptGroup of manifest.content_scripts) {
        for (const script of scriptGroup.js) {
            assertExtensionFile(script);
        }
    }

    for (const iconPath of Object.values(manifest.icons)) {
        assertExtensionFile(iconPath);
    }

    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(manifest.permissions.includes('scripting'));
});

test('manifest version matches package version', () => {
    const manifest = readJSON(path.join(extensionDir, 'manifest.json'));
    const packageJson = readJSON(path.join(rootDir, 'package.json'));
    const packageLock = readJSON(path.join(rootDir, 'package-lock.json'));

    assert.equal(manifest.version, packageJson.version);
    assert.equal(packageLock.version, packageJson.version);
    assert.equal(packageLock.packages[''].version, packageJson.version);
});

test('background imports parser file that exists', () => {
    const background = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
    const imports = [...background.matchAll(/importScripts\(([^)]+)\)/g)]
        .flatMap(match => match[1].split(','))
        .map(value => value.trim().replace(/^['"]|['"]$/g, ''));

    assert.deepEqual(imports, ['parser.js']);
    imports.forEach(assertExtensionFile);
});
