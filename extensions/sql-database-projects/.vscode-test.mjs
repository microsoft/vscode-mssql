import * as testCli from "@vscode/test-cli";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default testCli.defineConfig([
    {
        label: "Unit Tests",
        files: "out/test/**/*.test.js",
        version: "insiders",
        skipExtensionDependencies: true,
        mocha: {
            ui: "tdd",
            timeout: 60_000,
            // Preload module shims to mock azdata, dataworkspace, mssql modules
            require: [path.resolve(__dirname, "out/test/stubs/moduleShims.js")],
        },
    },
]);
