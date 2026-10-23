/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Phase 0 (final plan WI-0.1/0.2/0.5): durable capture identity, the
 * ObservabilityLinkV1 cross-plane block, and the strict v1/v2 trace envelope
 * parser with untrusted-import limits.
 */

import { expect } from "chai";
import {
    FeatureCaptureStore,
    normalizeNullableBoolean,
    normalizeNullableString,
} from "../../src/diagnostics/featureCapture/captureStore";
import {
    newCaptureEventId,
    newCaptureSessionId,
} from "../../src/diagnostics/featureCapture/identity";
import {
    normalizeFeatureTraceFile,
    serializeFeatureTraceV2,
} from "../../src/diagnostics/featureCapture/traceCodec";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import {
    DEFAULT_FEATURE_TRACE_LIMITS,
    FEATURE_TRACE_SCHEMA_V2,
} from "../../src/sharedInterfaces/featureTrace";
import { ObservabilityLinkV1 } from "../../src/sharedInterfaces/observabilityLink";

interface TestEvent {
    id: string;
    timestamp: number;
    result: string;
    link?: ObservabilityLinkV1;
}

interface TestOverrides {
    name: string | null;
    flag: boolean | null;
}

function createStore(capacity?: number) {
    return new FeatureCaptureStore<TestEvent, TestOverrides>({
        logName: "FeatureCaptureIdentityTest",
        featureId: "identityTest",
        capacity,
        defaultOverrides: { name: null, flag: null },
        normalizeOverrides: (overrides) => ({
            name: normalizeNullableString(overrides.name ?? null),
            flag: normalizeNullableBoolean(overrides.flag ?? null),
        }),
        normalizePartialOverrides: (overrides) => overrides,
    });
}

suite("Durable capture identity (WI-0.1/0.2)", () => {
    test("ids are globally unique across stores and allocations", () => {
        const seen = new Set<string>();
        const storeA = createStore();
        const storeB = createStore();
        for (let index = 0; index < 200; index++) {
            seen.add(storeA.createEventLink().captureEventId);
            seen.add(storeB.createEventLink().captureEventId);
            seen.add(newCaptureEventId());
            seen.add(newCaptureSessionId());
        }
        expect(seen.size).to.equal(800);
    });

    test("link carries feature, host session, capture session, and trace ids", () => {
        const store = createStore();
        const link = store.createEventLink({ traceId: "trace_test_1" });
        expect(link.schema).to.equal("mssql.observabilityLink/1");
        expect(link.featureId).to.equal("identityTest");
        expect(link.hostSessionId).to.equal(diag.sessionId);
        expect(link.captureSessionId).to.equal(store.captureSessionId);
        expect(link.traceId).to.equal("trace_test_1");
    });

    test("capture epoch renews on clear and on import; imported links survive", () => {
        const store = createStore();
        const initialEpoch = store.captureSessionId;
        store.addEvent({ timestamp: 1, result: "success" });
        store.clearEvents();
        const clearedEpoch = store.captureSessionId;
        expect(clearedEpoch).to.not.equal(initialEpoch);

        const importedLink = store.createEventLink();
        store.importEvents(
            [{ id: "E-1", timestamp: 1, result: "success", link: importedLink }],
            undefined,
        );
        expect(store.captureSessionId).to.not.equal(clearedEpoch);
        expect(store.getEvents()[0].link?.captureEventId).to.equal(importedLink.captureEventId);
    });

    test("logical identity survives ring eviction: same captureEventId after reinsert", () => {
        const store = createStore(2);
        const link = store.createEventLink();
        const pending = store.addEvent({ timestamp: 1, result: "pending", link });

        // Evict the pending row out of the tiny ring.
        store.addEvent({ timestamp: 2, result: "success" });
        store.addEvent({ timestamp: 3, result: "success" });
        expect(store.getEvent(pending.id)).to.equal(undefined);

        // Finalization falls back to re-adding with the SAME link block —
        // one logical event, found by durable id (WI-0.1 acceptance).
        const finalized =
            store.updateEvent(pending.id, { timestamp: 4, result: "success", link }) ??
            store.addEvent({ timestamp: 4, result: "success", link });
        expect(finalized.link?.captureEventId).to.equal(link.captureEventId);
        expect(store.findByCaptureEventId(link.captureEventId)?.id).to.equal(finalized.id);
        expect(
            store.getEvents().filter((e) => e.link?.captureEventId === link.captureEventId).length,
        ).to.equal(1);
    });
});

suite("Feature trace envelope v2 (WI-0.5)", () => {
    const V2_METADATA = {
        featureId: "identityTest",
        captureSessionId: "cs-test",
        eventSchema: "test.event/1",
        overridesSchema: "test.overrides/1",
        extensionVersion: "0.0.0-test",
        overrides: { name: "n", flag: true } as TestOverrides,
    };

    test("v2 round trip preserves envelope metadata", () => {
        const events: TestEvent[] = [{ id: "E-1", timestamp: 1, result: "success" }];
        const envelope = serializeFeatureTraceV2(events, {
            ...V2_METADATA,
            provenance: { origin: "generatedFixture" },
        });
        expect(envelope.schema).to.equal(FEATURE_TRACE_SCHEMA_V2);

        const normalized = normalizeFeatureTraceFile<TestEvent, TestOverrides>(
            JSON.parse(JSON.stringify(envelope)),
            "fixture.json",
            { featureLabel: "a test", expectedFeatureId: "identityTest" },
        );
        expect(normalized._sourceSchema).to.equal(FEATURE_TRACE_SCHEMA_V2);
        expect(normalized._v2?.captureSessionId).to.equal("cs-test");
        expect(normalized._v2?.eventSchema).to.equal("test.event/1");
        expect(normalized._v2?.provenance?.origin).to.equal("generatedFixture");
        expect(normalized.events.length).to.equal(1);
        expect(normalized.overrides.name).to.equal("n");
    });

    test("v1 fixtures keep loading and are marked v1", () => {
        const v1 = {
            version: 1,
            exportedAt: 123,
            _savedAt: "2026-01-01T00:00:00.000Z",
            _extensionVersion: "legacy",
            overrides: { name: null, flag: null },
            recordWhenClosed: true,
            events: [{ id: "E-1", timestamp: 1, result: "success" }],
        };
        const normalized = normalizeFeatureTraceFile<TestEvent, TestOverrides>(v1, "legacy.json", {
            featureLabel: "a test",
        });
        expect(normalized._sourceSchema).to.equal("v1");
        expect(normalized.recordWhenClosed).to.equal(true);
        expect(normalized.events.length).to.equal(1);
    });

    test("unknown major versions are rejected, never coerced", () => {
        expect(() =>
            normalizeFeatureTraceFile({ version: 3, events: [] }, "future.json", {
                featureLabel: "a test",
            }),
        ).to.throw(/unsupported trace version 3/);
        expect(() =>
            normalizeFeatureTraceFile(
                { schema: "mssql.featureTrace/9", events: [] },
                "future.json",
                { featureLabel: "a test" },
            ),
        ).to.throw(/unsupported trace schema/);
    });

    test("v2 files with the wrong featureId are rejected", () => {
        const envelope = serializeFeatureTraceV2([] as TestEvent[], {
            ...V2_METADATA,
            featureId: "otherFeature",
        });
        expect(() =>
            normalizeFeatureTraceFile(JSON.parse(JSON.stringify(envelope)), "wrong.json", {
                featureLabel: "a test",
                expectedFeatureId: "identityTest",
            }),
        ).to.throw(/is a "otherFeature" trace/);
    });

    test("malformed and over-limit files are rejected with actionable errors", () => {
        expect(() =>
            normalizeFeatureTraceFile("not an object", "malformed.json", {
                featureLabel: "a test",
            }),
        ).to.throw(/is not a a test trace JSON file/);

        const tooManyEvents = {
            version: 1,
            events: new Array(11).fill({ id: "E-1", timestamp: 1, result: "success" }),
        };
        expect(() =>
            normalizeFeatureTraceFile(tooManyEvents, "big.json", {
                featureLabel: "a test",
                limits: { ...DEFAULT_FEATURE_TRACE_LIMITS, maxEvents: 10 },
            }),
        ).to.throw(/over the 10-event import limit/);

        const hugeString = {
            version: 1,
            events: [{ id: "E-1", timestamp: 1, result: "x".repeat(100) }],
        };
        expect(() =>
            normalizeFeatureTraceFile(hugeString, "hugeString.json", {
                featureLabel: "a test",
                limits: { ...DEFAULT_FEATURE_TRACE_LIMITS, maxStringLength: 50 },
            }),
        ).to.throw(/over the 50-character import limit/);

        let deep: Record<string, unknown> = { leaf: true };
        for (let index = 0; index < 20; index++) {
            deep = { nested: deep };
        }
        expect(() =>
            normalizeFeatureTraceFile(
                { version: 1, events: [{ id: "E-1", timestamp: 1, result: "ok", deep }] },
                "deep.json",
                {
                    featureLabel: "a test",
                    limits: { ...DEFAULT_FEATURE_TRACE_LIMITS, maxDepth: 10 },
                },
            ),
        ).to.throw(/deeper than the 10-level import limit/);
    });

    test("v2 size cap truncates oldest-first with an honest truncation report", () => {
        const events: TestEvent[] = [];
        for (let index = 0; index < 50; index++) {
            events.push({ id: `E-${index}`, timestamp: index, result: "x".repeat(2000) });
        }
        const envelope = serializeFeatureTraceV2(events, V2_METADATA, {
            maxFileSizeMB: 0.05,
        });
        expect(envelope.events.length).to.be.lessThan(50);
        expect(envelope.truncation?.occurred).to.equal(true);
        expect(envelope.truncation?.omittedEvents).to.equal(50 - envelope.events.length);
        expect(envelope.truncation?.firstRetainedAt).to.equal(
            (envelope.events[0] as TestEvent).timestamp,
        );
    });
});
