/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookRunHistoryEntry } from "../../src/sharedInterfaces/runbookStudio";
import { presentRunHistoryEntry } from "../../src/webviews/pages/RunbookStudio/runHistoryPresentation";

function entry(overrides: Partial<RunbookRunHistoryEntry> = {}): RunbookRunHistoryEntry {
    return {
        runId: "run-1",
        startedEpochMs: 1_000,
        state: "succeeded",
        planRevision: "4",
        verdict: "pass",
        ...overrides,
    };
}

suite("runHistoryPresentation", () => {
    test("presents selected current-plan verdicts", () => {
        expect(presentRunHistoryEntry(entry(), "4", "run-1")).to.deep.equal({
            outcome: "pass",
            tone: "pass",
            planRelation: "current",
            selected: true,
        });
    });

    test("keeps lifecycle outcomes and unknown/different revisions explicit", () => {
        expect(
            presentRunHistoryEntry(
                entry({ runId: "run-2", state: "running", verdict: undefined }),
                "5",
                "run-1",
            ),
        ).to.deep.equal({
            outcome: "running",
            tone: "active",
            planRelation: "different",
            selected: false,
        });
        expect(presentRunHistoryEntry(entry(), undefined, undefined).planRelation).to.equal(
            "unknown",
        );
    });

    test("maps terminal states without verdicts to honest tones", () => {
        expect(
            presentRunHistoryEntry(entry({ state: "failed", verdict: undefined }), "4", undefined)
                .tone,
        ).to.equal("fail");
        expect(
            presentRunHistoryEntry(
                entry({ state: "cancelled", verdict: undefined }),
                "4",
                undefined,
            ).tone,
        ).to.equal("indeterminate");
    });
});
