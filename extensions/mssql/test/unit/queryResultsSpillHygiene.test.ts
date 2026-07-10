/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-1 spill crash-safety (addendum §5.4) and the queryResults parameter
 * registry (addendum §6): nonce-stamped run dirs, stale-lock orphan sweep
 * that never touches live sessions, and settings resolution/clamping/digest.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    SESSION_SPILL_NONCE,
    STALE_LOCK_MS,
    runSpillDirName,
    sweepOrphanSpillDirs,
} from "../../src/queryResults/spillHygiene";
import {
    QUERY_RESULTS_DEFAULTS,
    computeQueryResultsDigest,
    resolveQueryResultsParams,
} from "../../src/queryResults/queryResultsParams";

function tempRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "qr-spill-"));
}

function mkRunDir(root: string, doc: string, run: string): string {
    const dir = path.join(root, doc, run);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "resultsets.pages"), "x".repeat(64), "utf8");
    return dir;
}

suite("queryResults spill hygiene", () => {
    test("run dir names carry the session nonce", () => {
        expect(runSpillDirName(3)).to.equal(`run3_${SESSION_SPILL_NONCE}`);
    });

    test("sweep removes dirs of dead sessions, keeps live and own dirs", () => {
        const root = tempRoot();
        const now = Date.now();
        // Own session dir: must survive (no lock file needed — own nonce is live).
        const own = mkRunDir(root, "docA", runSpillDirName(1));
        // Dead session: stale lock file.
        const dead = mkRunDir(root, "docA", "run2_deadnonce");
        fs.writeFileSync(path.join(root, "session-deadnonce.lock"), "1", "utf8");
        const stale = new Date(now - STALE_LOCK_MS - 60_000);
        fs.utimesSync(path.join(root, "session-deadnonce.lock"), stale, stale);
        // Dead session with NO lock at all.
        const ghost = mkRunDir(root, "docB", "run1_ghostnonce");
        // Live sibling session: fresh lock.
        const sibling = mkRunDir(root, "docC", "run1_livenonce");
        fs.writeFileSync(path.join(root, "session-livenonce.lock"), "1", "utf8");
        // Legacy dir without nonce: never touched.
        const legacy = mkRunDir(root, "docD", "run7");

        const result = sweepOrphanSpillDirs(root, now);
        expect(result.dirsRemoved).to.equal(2);
        expect(result.bytesRemoved).to.equal(128);
        expect(fs.existsSync(own)).to.equal(true);
        expect(fs.existsSync(dead)).to.equal(false);
        expect(fs.existsSync(ghost)).to.equal(false);
        expect(fs.existsSync(sibling)).to.equal(true);
        expect(fs.existsSync(legacy)).to.equal(true);
        // Stale lock file itself is removed.
        expect(fs.existsSync(path.join(root, "session-deadnonce.lock"))).to.equal(false);
    });

    test("sweep of a missing root is a no-op", () => {
        const result = sweepOrphanSpillDirs(path.join(tempRoot(), "missing"));
        expect(result).to.deep.equal({ dirsRemoved: 0, bytesRemoved: 0, failures: 0 });
    });
});

suite("queryResults params", () => {
    test("defaults resolve with a stable digest and no overrides", () => {
        const resolved = resolveQueryResultsParams({ get: () => undefined });
        expect(resolved.params).to.deep.equal(QUERY_RESULTS_DEFAULTS);
        expect(resolved.overriddenKeys).to.deep.equal([]);
        expect(resolved.digest).to.equal(computeQueryResultsDigest(QUERY_RESULTS_DEFAULTS));
        expect(resolved.digest).to.have.length(12);
    });

    test("overrides object wins over dedicated settings; values clamp", () => {
        const resolved = resolveQueryResultsParams({
            get: (section) => {
                if (section === "mssql.queryResults.overrides") {
                    return { snapshotTtlMinutes: 5, retainedStoreMemoryBytes: 1 };
                }
                if (section === "mssql.queryResults.snapshot.ttlMinutes") {
                    return 99;
                }
                return undefined;
            },
        });
        expect(resolved.params.snapshotTtlMinutes).to.equal(5);
        // Clamped up to the 1 MiB floor.
        expect(resolved.params.retainedStoreMemoryBytes).to.equal(1024 * 1024);
        expect(resolved.overriddenKeys).to.deep.equal([
            "snapshotTtlMinutes",
            "retainedStoreMemoryBytes",
        ]);
    });

    test("unknown keys and mistyped values are ignored", () => {
        const resolved = resolveQueryResultsParams({
            get: (section) =>
                section === "mssql.queryResults.overrides"
                    ? { nonsense: 1, snapshotTtlMinutes: "soon", aiEnabled: "yes" }
                    : undefined,
        });
        expect(resolved.params).to.deep.equal(QUERY_RESULTS_DEFAULTS);
        expect(resolved.overriddenKeys).to.deep.equal([]);
    });

    test("digest changes when any knob changes", () => {
        const base = computeQueryResultsDigest(QUERY_RESULTS_DEFAULTS);
        const changed = computeQueryResultsDigest({
            ...QUERY_RESULTS_DEFAULTS,
            maxUnpinnedStores: 11,
        });
        expect(base).to.not.equal(changed);
    });
});
