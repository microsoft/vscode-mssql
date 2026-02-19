import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

const mocha = createMochaConfig({
    timeout: 30_000,
    require: ["./out/test/stubs/moduleShims.js"],
});

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
    coverage: defaultCoverageConfig,
});
