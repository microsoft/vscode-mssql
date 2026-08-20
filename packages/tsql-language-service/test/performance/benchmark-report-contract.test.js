/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

test("benchmark reports identify the exact commit and package worktree state", async () => {
    const { repositoryIdentity } = await import("../../benchmarks/support/repository-identity.mjs");
    const identity = await repositoryIdentity(path.resolve(__dirname, "../.."));

    assert.match(identity.commit, /^[0-9a-f]{40}$/u);
    assert.equal(typeof identity.dirty, "boolean");
    assert.match(identity.sourceFingerprint, /^[0-9a-f]{64}$/u);
});

test("benchmark fingerprints executable inputs without becoming self-referential through reports", async () => {
    const { repositoryIdentity } = await import("../../benchmarks/support/repository-identity.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "tsql-benchmark-identity-"));
    const packageDirectory = path.join(root, "packages", "tsql-language-service");
    try {
        await mkdir(path.join(packageDirectory, "src"), { recursive: true });
        await mkdir(path.join(packageDirectory, "docs"), { recursive: true });
        await writeFile(path.join(packageDirectory, "src", "index.ts"), "export {};\n");
        await writeFile(path.join(packageDirectory, "package.json"), "{}\n");
        await writeFile(path.join(packageDirectory, "docs", "report.md"), "initial\n");
        git(root, ["init", "--quiet"]);
        git(root, ["add", "."]);
        git(root, [
            "-c",
            "user.name=Benchmark Test",
            "-c",
            "user.email=benchmark@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "initial",
        ]);

        const baseline = await repositoryIdentity(packageDirectory);
        await writeFile(path.join(packageDirectory, "docs", "report.md"), "updated\n");
        const reportOnly = await repositoryIdentity(packageDirectory);
        assert.equal(reportOnly.sourceFingerprint, baseline.sourceFingerprint);
        assert.equal(reportOnly.dirty, false);

        await writeFile(path.join(packageDirectory, "src", "index.ts"), "export const x = 1;\n");
        const sourceEdit = await repositoryIdentity(packageDirectory);
        assert.notEqual(sourceEdit.sourceFingerprint, baseline.sourceFingerprint);
        assert.equal(sourceEdit.dirty, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

function git(cwd, args) {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}
