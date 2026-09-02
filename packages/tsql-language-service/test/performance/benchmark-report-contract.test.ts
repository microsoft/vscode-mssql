/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const packageDirectory = path.resolve(__dirname, "../..");

test("benchmark reports identify the exact commit and package worktree state", async () => {
    const { repositoryIdentity } = await import("../../benchmarks/support/repository-identity.mjs");
    const identity = await repositoryIdentity(packageDirectory);

    assert.match(identity.commit, /^[0-9a-f]{40}$/u);
    assert.equal(typeof identity.dirty, "boolean");
    assert.match(identity.sourceFingerprint, /^[0-9a-f]{64}$/u);
});

test("benchmark fingerprints executable inputs without becoming self-referential through reports", async () => {
    const { repositoryIdentity } = await import("../../benchmarks/support/repository-identity.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "tsql-benchmark-identity-"));
    const temporaryPackageDirectory = path.join(root, "packages", "tsql-language-service");
    try {
        await mkdir(path.join(temporaryPackageDirectory, "src"), { recursive: true });
        await mkdir(path.join(temporaryPackageDirectory, "docs"), { recursive: true });
        await writeFile(path.join(temporaryPackageDirectory, "src", "index.ts"), "export {};\n");
        await writeFile(path.join(temporaryPackageDirectory, "package.json"), "{}\n");
        await writeFile(path.join(temporaryPackageDirectory, "docs", "report.md"), "initial\n");
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

        const baseline = await repositoryIdentity(temporaryPackageDirectory);
        await writeFile(path.join(temporaryPackageDirectory, "docs", "report.md"), "updated\n");
        const reportOnly = await repositoryIdentity(temporaryPackageDirectory);
        assert.equal(reportOnly.sourceFingerprint, baseline.sourceFingerprint);
        assert.equal(reportOnly.dirty, false);

        await writeFile(
            path.join(temporaryPackageDirectory, "src", "index.ts"),
            "export const value = 1;\n",
        );
        const sourceEdit = await repositoryIdentity(temporaryPackageDirectory);
        assert.notEqual(sourceEdit.sourceFingerprint, baseline.sourceFingerprint);
        assert.equal(sourceEdit.dirty, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

function git(cwd: string, args: readonly string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}
