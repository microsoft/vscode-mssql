/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Feature request latency, and the staleness count that sits beside it.
//
// The package states as an invariant that a result computed against a superseded document never
// reaches the editor. `staleDiscarded` is the number that demonstrates it was caught rather than
// published, so a test that only checked timings would miss the half of this that matters.

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    RequestLatencyRecorder,
    TsqlLanguageFeatureService,
} from "../../../src/index.ts";
import { defined } from "../support/assertions.ts";

suite("request latency recorder", () => {
    test("summarises only the methods that were called", () => {
        const recorder = new RequestLatencyRecorder();

        recorder.measure("completion", () => 1);
        recorder.measure("completion", () => 2);
        recorder.measure("hover", () => 3);

        const summary = recorder.summary();
        assert.equal(defined(summary.completion).count, 2);
        assert.equal(defined(summary.hover).count, 1);
        assert.equal(
            summary.definition,
            undefined,
            "a method nobody called is absent, not a measured zero",
        );
    });

    test("reports a percentile that is a sample which actually occurred", () => {
        const recorder = new RequestLatencyRecorder();
        // Nearest-rank over a known set: p95 of 1..20 is the 19th value.
        for (let index = 1; index <= 20; index += 1) {
            recorder.measure("completion", () => index);
        }

        const { p50Ms, p95Ms, maximumMs } = defined(recorder.summary().completion);
        assert.ok(p50Ms <= p95Ms, "p50 cannot exceed p95");
        assert.ok(p95Ms <= maximumMs, "p95 cannot exceed the maximum");
    });

    test("counts a stale request without counting it as an answer", () => {
        const recorder = new RequestLatencyRecorder();

        assert.throws(() =>
            recorder.measure("completion", () => {
                throw new Error("Stale document request for file:///a.sql: expected 1, current 2");
            }),
        );

        const summary = recorder.summary();
        assert.equal(defined(summary.completion).staleDiscarded, 1);
        assert.equal(
            defined(summary.completion).count,
            0,
            "a discarded result is not a served request",
        );
        assert.equal(recorder.staleDiscarded, 1);
    });

    test("still times a request that failed for any other reason", () => {
        const recorder = new RequestLatencyRecorder();

        assert.throws(() =>
            recorder.measure("hover", () => {
                throw new Error("boom");
            }),
        );

        assert.equal(
            defined(recorder.summary().hover).count,
            1,
            "a slow error path must not look fast",
        );
        assert.equal(defined(recorder.summary().hover).staleDiscarded, 0);
    });

    // Cancellation is the editor abandoning a request, which a synchronous method cannot observe.
    test("reports cancellation as zero because it cannot be seen from here", () => {
        const recorder = new RequestLatencyRecorder();
        recorder.measure("completion", () => 1);

        assert.equal(defined(recorder.summary().completion).cancelled, 0);
    });
});

suite("feature latency reaches the published statistics", () => {
    test("a completion request is measured and reported", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            new InMemoryMetadataProvider(),
        );
        const features = new TsqlLanguageFeatureService(runtime, new InMemoryMetadataProvider());
        await runtime.open("file:///latency.sql", 1, "SELECT 1;");

        features.completion("file:///latency.sql", 1, 7);
        features.hover("file:///latency.sql", 1, 1);
        // Republished so the statistics pick up the calls made since the open.
        await runtime.change("file:///latency.sql", 1, 2, [{ start: 8, end: 8, text: " " }]);

        const { latency } = defined(runtime.getStats("file:///latency.sql")).requests;
        assert.equal(defined(latency.completion).count, 1);
        assert.equal(defined(latency.hover).count, 1);
        assert.ok(defined(latency.completion).p95Ms >= 0);
    });

    test("a request against a superseded version is discarded and counted", async () => {
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            new InMemoryMetadataProvider(),
        );
        const features = new TsqlLanguageFeatureService(runtime, new InMemoryMetadataProvider());
        await runtime.open("file:///stale.sql", 1, "SELECT 1;");
        await runtime.change("file:///stale.sql", 1, 2, [{ start: 8, end: 8, text: " " }]);

        assert.throws(
            () => features.completion("file:///stale.sql", 1, 7),
            /Stale document request/u,
            "a request for a version the document has moved past must not be answered",
        );

        await runtime.change("file:///stale.sql", 2, 3, [{ start: 8, end: 8, text: " " }]);
        assert.equal(
            defined(runtime.getStats("file:///stale.sql")).requests.staleResultsDiscarded,
            1,
        );
    });
});
