import { defineConfig } from "@vscode/test-cli";
import { createMochaConfig, defaultCoverageConfig } from "../../scripts/vscode-test-config.mjs";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mocha = createMochaConfig({ timeout: 10_000 });

// Keep the user-data path below macOS's Unix socket path limit.
const tmpBaseDir = process.platform === "darwin" ? "/tmp" : os.tmpdir();
const userDataDir = fs.mkdtempSync(path.join(tmpBaseDir, "vsc-dataworkspace-"));
process.on("exit", () => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
});

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            launchArgs: ["--disable-extensions", "--user-data-dir", userDataDir],
            env: {
                VSCODE_LOG_LEVEL: "error",
            },
            mocha,
        },
    ],
    coverage: defaultCoverageConfig,
});
