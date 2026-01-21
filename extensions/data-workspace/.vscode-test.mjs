import * as testCli from "@vscode/test-cli";

export default testCli.defineConfig([
    {
        label: "Unit Tests",
        files: "out/src/test/**/*.test.js",
        version: "insiders",
        skipExtensionDependencies: true,
        mocha: {
            ui: "tdd",
            timeout: 6_000,
        },
    },
]);
