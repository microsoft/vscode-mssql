import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mocha = createMochaConfig({
    timeout: 30_000,
});

// Use a short temp user-data-dir to avoid macOS's 103-char Unix socket path limit.
// The "sql-database-projects" directory name makes the default path too long on CI.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsc-sqlproj-"));

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            version: "insiders",
            launchArgs: ["--disable-gpu", "--user-data-dir", userDataDir],
            env: {
                SQLPROJ_TEST_MODE: "1",
                VSCODE_LOG_LEVEL: "error",
            },
            mocha,
        },
    ],
    coverage: defaultCoverageConfig,
});
