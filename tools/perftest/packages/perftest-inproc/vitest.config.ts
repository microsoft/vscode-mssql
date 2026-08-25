import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            vscode: resolve(__dirname, "test", "vscodeStub.ts"),
        },
    },
    test: {
        include: ["test/**/*.test.ts"],
    },
});
