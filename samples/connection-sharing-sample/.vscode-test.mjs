import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    files: "out/test/**/*.test.js",
    env: {
        VSCODE_LOG_LEVEL: "error",
    },
    mocha: {
        reporter: "mocha-multi-reporters",
        reporterOptions: {
            reporterEnabled: "dot, mocha-junit-reporter",
            mochaJunitReporterReporterOptions: {
                mochaFile: "test-reports/test-results-ext.xml",
            },
        },
    },
});
