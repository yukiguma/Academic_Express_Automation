(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    root.AcademicExpressUpdateChecker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const RELEASE_API_URL = 'https://api.github.com/repos/yukiguma/Academic_Express_Automation/releases/latest';
    const LATEST_ZIP_URL = 'https://github.com/yukiguma/Academic_Express_Automation/releases/latest/download/academic-express-automation.zip';

    function normalizeVersion(version) {
        if (typeof version !== 'string') {
            return null;
        }

        const normalized = version.trim().replace(/^v/i, '');
        if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
            return null;
        }

        return normalized;
    }

    function compareVersions(left, right) {
        const normalizedLeft = normalizeVersion(left);
        const normalizedRight = normalizeVersion(right);

        if (!normalizedLeft || !normalizedRight) {
            throw new TypeError('Versions must use the x.y.z format.');
        }

        const leftParts = normalizedLeft.split('.').map(Number);
        const rightParts = normalizedRight.split('.').map(Number);

        for (let index = 0; index < leftParts.length; index += 1) {
            if (leftParts[index] !== rightParts[index]) {
                return leftParts[index] > rightParts[index] ? 1 : -1;
            }
        }

        return 0;
    }

    function parseLatestRelease(release) {
        if (!release || release.draft || release.prerelease) {
            return null;
        }

        const version = normalizeVersion(release.tag_name);
        if (!version) {
            return null;
        }

        return {
            latestVersion: version,
            publishedAt: typeof release.published_at === 'string' ? release.published_at : null
        };
    }

    function shouldNotify(currentVersion, latestVersion, dismissedVersion) {
        const normalizedDismissed = normalizeVersion(dismissedVersion);
        return compareVersions(latestVersion, currentVersion) > 0
            && normalizedDismissed !== normalizeVersion(latestVersion);
    }

    return {
        RELEASE_API_URL,
        LATEST_ZIP_URL,
        normalizeVersion,
        compareVersions,
        parseLatestRelease,
        shouldNotify
    };
});
