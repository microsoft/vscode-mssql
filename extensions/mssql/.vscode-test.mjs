import { fileURLToPath } from "url";
import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

// Absolute path so the runner resolves it regardless of its own module location.
const sourceMapSupportHook = fileURLToPath(
    new URL("./scripts/source-map-support-register.js", import.meta.url),
);

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
                timeout: 30_000,
                // Remap runtime error stack traces from compiled .js back to the original .ts
                // sources (with absolute paths) so test failures in the Test Explorer link to
                // the correct TypeScript files.
                require: [sourceMapSupportHook],
            }),
        },
        // {
        //     label: "Activation Tests",
        //     files: "out/test/activation/**/*.test.js",
        //     version: "insiders",
        //     installExtensions: ["ms-dotnettools.vscode-dotnet-runtime"],
        //     env: {
        //         VSCODE_LOG_LEVEL: "error",
        //     },
        //     mocha: createMochaConfig({
        //         ui: "tdd",
        //         timeout: 30_000,
        //     }),
        // },
    ],
    coverage: defaultCoverageConfig,
});
