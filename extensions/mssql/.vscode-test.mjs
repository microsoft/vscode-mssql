import * as testCli from "@vscode/test-cli";

export default testCli.defineConfig([
    {
        label: "Unit Tests",
        files: "out/test/**/*.test.js",
        version: "insiders",
        mocha: {
            ui: "tdd",
            timeout: 6_000,
        },
    },
]);
