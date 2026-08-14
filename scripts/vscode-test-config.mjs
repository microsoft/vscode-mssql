import { fileURLToPath } from "url";

const defaultJunitFile = "test-reports/test-results-ext.xml";

// Absolute path to the source-map-support registration helper. Wired into every test run so
// failures in the Test Explorer link to the original TypeScript sources in the correct folder.
const sourceMapSupportHook = fileURLToPath(
    new URL("./source-map-support-register.js", import.meta.url),
);
const quietReporter = fileURLToPath(new URL("./quiet-mocha-reporter.cjs", import.meta.url));

export const defaultCoverageConfig = {
    // The HTML reporter turns source-map HTTPS URLs into directory names. A
    // colon in that remapped path is invalid on Windows, so retain the CI
    // formats there and generate the browsable report on other platforms.
    reporter:
        process.platform === "win32"
            ? ["text-summary", "lcovonly", "cobertura"]
            : ["text-summary", "html", "lcov", "cobertura"],
    output: "coverage",
};

export function hasCliReporterOverride(argv = process.argv) {
    return argv.some(
        (arg) =>
            arg === "--reporter" ||
            arg.startsWith("--reporter=") ||
            arg === "-R" ||
            (arg.startsWith("-R") && arg.length > 2),
    );
}

export function createMochaConfig(base = {}, options = {}) {
    const { argv = process.argv, junitFile = defaultJunitFile } = options;

    // Always register source-map-support, preserving any caller-provided `require` entries.
    const { require: baseRequire, ...restBase } = base;
    const withSourceMaps = {
        ...restBase,
        require: [
            sourceMapSupportHook,
            ...(Array.isArray(baseRequire) ? baseRequire : baseRequire ? [baseRequire] : []),
        ],
    };

    if (hasCliReporterOverride(argv)) {
        return { ...withSourceMaps };
    }

    return {
        ...withSourceMaps,
        reporter: "mocha-multi-reporters",
        reporterOptions: {
            reporterEnabled: `${quietReporter}, mocha-junit-reporter`,
            mochaJunitReporterReporterOptions: {
                mochaFile: junitFile,
            },
        },
    };
}
