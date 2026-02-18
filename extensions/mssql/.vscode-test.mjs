import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig } from "../../scripts/vscode-test-config.mjs";

export default defineConfig([
    {
        label: "Unit Tests",
        files: "out/test/**/*.test.js",
        version: "insiders",
        mocha: createMochaConfig({
            ui: "tdd",
            timeout: 6_000,
        }),
    },
]);
