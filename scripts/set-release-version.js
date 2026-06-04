const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
assertVersion(version);

const rootDir = path.join(__dirname, '..');
updateJson(path.join(rootDir, 'package.json'), 2);
updatePackageLock(path.join(rootDir, 'package-lock.json'));
updateJson(path.join(rootDir, 'extension', 'manifest.json'), 4);

function updateJson(filePath, spaces) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, spaces)}\n`);
}

function updatePackageLock(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.version = version;
    data.packages[''].version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function assertVersion(value) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value || '')) {
        fail(`Usage: npm run version:sync -- <version>\nExpected numeric semver like 1.2.3, got: ${value || '(empty)'}`);
    }

    for (const part of value.split('.')) {
        const number = Number(part);
        if (!Number.isSafeInteger(number) || number > 65535) {
            fail(`Version components must be between 0 and 65535: ${value}`);
        }
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
