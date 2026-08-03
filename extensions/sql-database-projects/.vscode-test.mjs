import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mocha = createMochaConfig({
    timeout: 30_000,
});

// TODO: Workaround for macOS CI EINVAL error — revert once the upstream VS Code issue is fixed.
// A recent VS Code build changed the socket filename format (e.g. "1.12-main.sock"), pushing the
// default .vscode-test/user-data/ path over macOS's hard 103-char Unix socket path limit.
// Tracked in: https://github.com/microsoft/vscode/issues/319752
// Use a short temp user-data-dir to avoid macOS's 103-char Unix socket path limit.
// The "sql-database-projects" directory name makes the default path too long on CI.
const tmpBaseDir = process.platform === "darwin" ? "/tmp" : os.tmpdir();
const userDataDir = fs.mkdtempSync(path.join(tmpBaseDir, "vsc-sqlproj-"));
process.on("exit", () => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
});

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            // TODO: Switch back to Insiders after https://github.com/microsoft/vscode-test/issues/349.
            version: "stable",
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
