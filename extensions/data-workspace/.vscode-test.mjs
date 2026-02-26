import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

const mocha = createMochaConfig({ timeout: 10_000 });

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            launchArgs: ["--disable-extensions"],
            env: {
                VSCODE_LOG_LEVEL: "error",
            },
            mocha,
        },
    ],
    coverage: defaultCoverageConfig,
});
