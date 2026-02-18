import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

export default defineConfig({
    tests: [
        {
            label: "Unit Tests",
            files: "out/test/unit/**/*.test.js",
            version: "insiders",
            env: {
                VSCODE_LOG_LEVEL: "error",
            },
            mocha: createMochaConfig({
                ui: "tdd",
                timeout: 6_000,
            }),
        },
    ],
    coverage: defaultCoverageConfig,
});
