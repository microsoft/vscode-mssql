/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Identifies both the checked-out commit and uncommitted package sources used by a benchmark.
 *
 * A commit alone is misleading while a worktree is dirty. The fingerprint hashes the scoped Git
 * diff plus every untracked, non-ignored package file, so two reports can prove they measured the
 * same source state without copying source or SQL into the report.
 */
export async function repositoryIdentity(packageDirectory) {
    try {
        const root = git(packageDirectory, ["rev-parse", "--show-toplevel"]).trim();
        const commit = git(root, ["rev-parse", "HEAD"]).trim();
        const scope = path.relative(root, packageDirectory).replaceAll("\\", "/");
        const scopes = executableScopes(scope);
        const status = gitBuffer(root, [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ...scopes,
        ]);
        const difference = gitBuffer(root, ["diff", "--binary", "HEAD", "--", ...scopes]);
        const untracked = gitBuffer(root, [
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ...scopes,
        ])
            .toString("utf8")
            .split("\0")
            .filter(Boolean)
            .sort();
        const hash = createHash("sha256")
            .update("tsql-language-service-benchmark-source-v1\0")
            .update(commit)
            .update("\0")
            .update(difference);
        for (const relative of untracked) {
            hash.update("\0").update(relative).update("\0");
            hash.update(await readFile(path.resolve(root, relative)));
        }
        return Object.freeze({
            commit,
            dirty: status.length > 0,
            sourceFingerprint: hash.digest("hex"),
        });
    } catch {
        return Object.freeze({
            commit: "unknown",
            dirty: false,
            sourceFingerprint: createHash("sha256")
                .update("tsql-language-service-benchmark-source-unknown")
                .digest("hex"),
        });
    }
}

function executableScopes(scope) {
    return [
        "src",
        "benchmarks",
        "scripts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
    ].map((entry) => `${scope}/${entry}`);
}

function git(cwd, args) {
    return gitBuffer(cwd, args).toString("utf8");
}

function gitBuffer(cwd, args) {
    return execFileSync("git", args, {
        cwd,
        encoding: "buffer",
        // Generated parser output makes a legitimate package diff larger than Node's 1 MiB
        // default. Keep the limit explicit and bounded so an oversized repository still fails.
        maxBuffer: 256 * 1024 * 1024,
    });
}
