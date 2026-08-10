import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as dotenv from "dotenv";
import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";

dotenv.config({ path: path.resolve(import.meta.dirname, "test/parser/.env") });

// TODO: Workaround for macOS CI EINVAL error — revert once the upstream VS Code issue is fixed.
// A recent VS Code build changed the socket filename format (e.g. "1.12-main.sock"), pushing the
// default .vscode-test/user-data/ path over macOS's hard 103-char Unix socket path limit.
// Tracked in: https://github.com/microsoft/vscode/issues/319752
// Use a short temp user-data-dir to avoid macOS's 103-char Unix socket path limit.
const tmpBaseDir = process.platform === "darwin" ? "/tmp" : os.tmpdir();
const userDataDir = fs.mkdtempSync(path.join(tmpBaseDir, "vsc-mssql-"));
process.on("exit", () => {
    try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
        // VS Code can retain a Windows file handle briefly while the test process exits.
    }
});

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
        {
            label: "Parser Unit Tests",
            files: "out/test/parser/unit/**/*.test.js",
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
        {
            label: "Parser Integration Tests",
            files: "out/test/parser/integration/**/*.test.js",
            version: "insiders",
            launchArgs: ["--user-data-dir", userDataDir],
            env: {
                VSCODE_LOG_LEVEL: "error",
                SERVER_NAME: process.env.SERVER_NAME,
                DATABASE_NAME: process.env.DATABASE_NAME,
                USER_NAME: process.env.USER_NAME,
                PASSWORD: process.env.PASSWORD,
            },
            mocha: createMochaConfig({
                ui: "tdd",
                timeout: 60_000,
            }),
        },
        // {
        //     label: "Activation Tests",
        //     files: "out/test/activation/**/*.test.js",
        //     version: "insiders",
        //     installExtensions: ["ms-dotnettools.vscode-dotnet-runtime"],
        //     launchArgs: ["--user-data-dir", userDataDir],
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
