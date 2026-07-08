import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

// VS Code creates an IPC socket under the test user-data-dir. On macOS, Unix domain socket
// paths are limited to ~103 characters, and the default `.vscode-test/user-data` path can
// exceed that when the repository lives under a long or space-containing path. Point the test
// user-data-dir at a short path in the OS temp directory to stay under the limit.
const userDataDir = join(tmpdir(), "vscode-mssql-test");

export default defineConfig({
    tests: [
        {
            label: "Unit Tests",
            files: "out/test/unit/**/*.test.js",
            version: "insiders",
            launchArgs: ["--user-data-dir", userDataDir],
            env: {
                VSCODE_LOG_LEVEL: "error",
            },
            mocha: createMochaConfig({
                ui: "tdd",
                timeout: 30_000,
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
