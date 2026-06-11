/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy baseline selector (Scope 2, decisions D-B / M8):
 *   * picks the most recent earlier run with a DIFFERENT hash.
 *   * returns undefined when the previous run has the SAME hash (re-run).
 *   * returns undefined when there is no earlier run.
 *   * returns undefined when the current run has no hash.
 *   * skips earlier runs that share the current hash to find a differing one.
 *   * ignores the current run itself and any later runs.
 *   * skips candidates with no hash.
 */

import { expect } from "chai";

import { BaselineCandidate, selectBaselineRun } from "../../src/cloudDeploy/runs/baselineSelector";

function candidate(
    runId: string,
    startedAtMs: number,
    sourceVersionHash: string | undefined,
): BaselineCandidate {
    return { runId, startedAtMs, sourceVersionHash };
}

suite("CloudDeploy baselineSelector", () => {
    test("picks the most recent earlier run with a different hash", () => {
        const current = candidate("r3", 300, "sha256:bbb");
        const history = [
            candidate("r1", 100, "sha256:aaa"),
            candidate("r2", 200, "sha256:aaa"),
            current,
        ];

        const baseline = selectBaselineRun(current, history);

        expect(baseline?.runId).to.equal("r2");
    });

    test("returns undefined when the previous run has the same hash (re-run)", () => {
        const current = candidate("r2", 200, "sha256:aaa");
        const history = [candidate("r1", 100, "sha256:aaa"), current];

        expect(selectBaselineRun(current, history)).to.equal(undefined);
    });

    test("returns undefined when there is no earlier run (first run)", () => {
        const current = candidate("r1", 100, "sha256:aaa");

        expect(selectBaselineRun(current, [current])).to.equal(undefined);
    });

    test("returns undefined when the current run has no hash", () => {
        const current = candidate("r2", 200, undefined);
        const history = [candidate("r1", 100, "sha256:aaa"), current];

        expect(selectBaselineRun(current, history)).to.equal(undefined);
    });

    test("skips same-hash runs to find an earlier differing one", () => {
        const current = candidate("r4", 400, "sha256:ccc");
        const history = [
            candidate("r1", 100, "sha256:aaa"),
            candidate("r2", 200, "sha256:ccc"),
            candidate("r3", 300, "sha256:ccc"),
            current,
        ];

        // r2/r3 share the current hash; r1 is the most recent DIFFERENT one.
        expect(selectBaselineRun(current, history)?.runId).to.equal("r1");
    });

    test("ignores the current run and any later runs", () => {
        const current = candidate("r2", 200, "sha256:bbb");
        const history = [
            candidate("r1", 100, "sha256:aaa"),
            current,
            candidate("r3", 300, "sha256:aaa"), // later — must be ignored
        ];

        const baseline = selectBaselineRun(current, history);

        expect(baseline?.runId).to.equal("r1");
    });

    test("skips candidates that have no hash", () => {
        const current = candidate("r3", 300, "sha256:bbb");
        const history = [
            candidate("r1", 100, undefined),
            candidate("r2", 200, "sha256:aaa"),
            current,
        ];

        expect(selectBaselineRun(current, history)?.runId).to.equal("r2");
    });
});
