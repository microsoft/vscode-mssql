import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            launchArgs: ["--disable-gpu"],
            env: {
                SQLPROJ_TEST_MODE: "1",
            },
            mocha: {
                timeout: 30_000,
                require: ["./out/test/stubs/moduleShims.js"],
            },
        },
    ],
    coverage: {
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        output: "coverage",
    },
});
