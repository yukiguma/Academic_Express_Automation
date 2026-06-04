const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const packageJson = readJson(path.join(rootDir, 'package.json'));
const packageLock = readJson(path.join(rootDir, 'package-lock.json'));
const manifest = readJson(path.join(rootDir, 'extension', 'manifest.json'));

assertVersion(packageJson.version, 'package.json version');
assertVersion(packageLock.version, 'package-lock.json version');
assertVersion(packageLock.packages[''].version, 'package-lock.json root package version');
assertVersion(manifest.version, 'extension/manifest.json version');

const versions = {
    'package.json': packageJson.version,
    'package-lock.json': packageLock.version,
    'package-lock.json packages[""]': packageLock.packages[''].version,
    'extension/manifest.json': manifest.version,
};

const mismatched = Object.entries(versions).filter(([, version]) => version !== packageJson.version);
if (mismatched.length > 0) {
    const details = Object.entries(versions)
        .map(([source, version]) => `${source}=${version}`)
        .join(', ');
    fail(`Version mismatch: ${details}`);
}

const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;
if (refType === 'tag') {
    const expectedTag = `v${packageJson.version}`;
    if (refName !== expectedTag) {
        fail(`Tag mismatch: expected ${expectedTag}, got ${refName}`);
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertVersion(version, label) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        fail(`${label} must be a numeric semver value like 1.2.3: ${version}`);
    }

    for (const part of version.split('.')) {
        const value = Number(part);
        if (!Number.isSafeInteger(value) || value > 65535) {
            fail(`${label} component must be between 0 and 65535: ${version}`);
        }
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
