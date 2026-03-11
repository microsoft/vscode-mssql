const defaultJunitFile = "test-reports/test-results-ext.xml";

export const defaultCoverageConfig = {
    reporter: ["text-summary", "html", "lcov", "cobertura"],
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

    if (hasCliReporterOverride(argv)) {
        return { ...base };
    }

    return {
        ...base,
        reporter: "mocha-multi-reporters",
        reporterOptions: {
            reporterEnabled: "dot, mocha-junit-reporter",
            mochaJunitReporterReporterOptions: {
                mochaFile: junitFile,
            },
        },
    };
}
