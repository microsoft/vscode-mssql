import { defineConfig } from "@vscode/test-cli";

const mocha = {
    timeout: 30_000,
    require: ["./out/test/stubs/moduleShims.js"],
    reporter: "mocha-multi-reporters",
    reporterOptions: {
        reporterEnabled: "dot, mocha-junit-reporter",
        mochaJunitReporterReporterOptions: {
            mochaFile: "test-reports/test-results-ext.xml",
        },
    },
};

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            launchArgs: ["--disable-gpu"],
            env: {
                SQLPROJ_TEST_MODE: "1",
                VSCODE_LOG_LEVEL: "error",
            },
            mocha,
        },
    ],
    coverage: {
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        output: "coverage",
    },
});
