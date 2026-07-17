/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WI-4.4 — Session History artifact chips: pure projection from a bundle
 * catalog's DESCRIPTORS to chip counts (no child manifest or segment is ever
 * read — the projection input is the bundle object alone), zero counts
 * omitted, invalid/missing artifacts surfaced as the "!" state, legacy
 * sessions (no bundle) get no chips at all.
 */

import { expect } from "chai";
import {
    hasHistoryArtifactChips,
    projectHistoryArtifactChips,
} from "../../src/diagnostics/sessionBundle/historyChips";
import {
    OBSERVABILITY_BUNDLE_SCHEMA,
    ObservabilityArtifactDescriptorV1,
    ObservabilityBundleV1,
} from "../../src/diagnostics/sessionBundle/bundleSchemas";

function artifact(
    overrides: Partial<ObservabilityArtifactDescriptorV1>,
): ObservabilityArtifactDescriptorV1 {
    return {
        artifactId: "art-1",
        kind: "featureCapture",
        schema: "mssql.featureCapture.stream/1",
        createdUtc: "2026-07-16T00:00:00Z",
        updatedUtc: "2026-07-16T00:00:00Z",
        status: "closed",
        bytes: 10,
        gaps: 0,
        truncations: 0,
        classification: {
            containsRichPayload: true,
            maximumClass: "model.prompt",
            policyId: "fullLocal",
        },
        ...overrides,
    };
}

function bundle(artifacts: ObservabilityArtifactDescriptorV1[]): ObservabilityBundleV1 {
    return {
        schema: OBSERVABILITY_BUNDLE_SCHEMA,
        bundleId: "b-1",
        hostSessionId: "hs-1",
        createdUtc: "2026-07-16T00:00:00Z",
        updatedUtc: "2026-07-16T00:00:00Z",
        status: "closed",
        provenance: {},
        artifacts,
        totals: {
            artifacts: artifacts.length,
            bytes: 0,
            gaps: 0,
            truncations: 0,
        },
    };
}

suite("Session History artifact chips (WI-4.4)", () => {
    test("counts come from bundle descriptors only", () => {
        const chips = projectHistoryArtifactChips(
            bundle([
                artifact({ artifactId: "diag", kind: "diagStream", events: 8_142 }),
                artifact({ artifactId: "cs-1", featureId: "completions", events: 200 }),
                artifact({ artifactId: "cs-2", featureId: "completions", events: 14 }),
                artifact({ artifactId: "qs-1", featureId: "queryStudio", events: 9 }),
                artifact({
                    artifactId: "rr-1",
                    kind: "replayRun",
                    featureId: "completions",
                    events: 6,
                }),
                artifact({
                    artifactId: "rr-2",
                    kind: "replayRun",
                    featureId: "queryStudio",
                    events: 2,
                }),
            ]),
        );
        expect(chips.diagEvents).to.equal(8_142);
        expect(chips.completionEvents).to.equal(214); // summed across streams
        expect(chips.qsRuns).to.equal(9);
        expect(chips.replayRuns).to.equal(2); // run COUNT, not item count
        expect(chips.invalidArtifacts).to.equal(undefined);
        expect(hasHistoryArtifactChips(chips)).to.equal(true);
    });

    test("zero counts are omitted — no '0' noise", () => {
        const chips = projectHistoryArtifactChips(
            bundle([
                artifact({ artifactId: "diag", kind: "diagStream", events: 0 }),
                artifact({ artifactId: "cs-1", featureId: "completions", events: 0 }),
            ]),
        );
        expect(chips).to.deep.equal({});
        expect(hasHistoryArtifactChips(chips)).to.equal(false);
    });

    test("invalid and missing artifacts become the '!' state (counts untrusted)", () => {
        const chips = projectHistoryArtifactChips(
            bundle([
                artifact({
                    artifactId: "cs-bad",
                    featureId: "completions",
                    status: "invalid",
                    events: 999, // must NOT be counted
                }),
                artifact({ artifactId: "rr-gone", kind: "replayRun", status: "missing" }),
                artifact({ artifactId: "cs-ok", featureId: "completions", events: 3 }),
            ]),
        );
        expect(chips.completionEvents).to.equal(3);
        expect(chips.invalidArtifacts).to.equal(2);
        expect(chips.invalidArtifactLabels).to.deep.equal([
            "featureCapture:cs-bad (invalid)",
            "replayRun:rr-gone (missing)",
        ]);
    });

    test("external refs do not produce chips yet", () => {
        const chips = projectHistoryArtifactChips(
            bundle([
                artifact({ artifactId: "perf", kind: "perfRunRef", events: 5 }),
                artifact({ artifactId: "sts2", kind: "sts2RunRef", events: 5 }),
            ]),
        );
        expect(chips).to.deep.equal({});
    });
});
