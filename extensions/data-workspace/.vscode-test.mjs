import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            launchArgs: ["--disable-extensions"],
            mocha: {
                timeout: 10_000,
            },
        },
    ],
    coverage: {
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        output: "coverage",
    },
});
