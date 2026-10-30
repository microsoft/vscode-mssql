/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-5 §5.13 + TSQ2-8 §11: memory-pressure breaker and debug overrides.
 * Pins: unknown override keys ignored with a diagnostic; capability masks
 * force OFF only (allowlist); fault profiles parse deterministically;
 * measurement-tainting detection; breaker samples at bounded intervals and
 * trips a typed ResourceLimit terminal through the engine.
 */

import { expect } from "chai";
import {
    DataPlaneErrorCodes,
    IQueryEventSink,
    SqlConnectionProfileRef,
} from "../../../src/services/sqlDataPlane/api";
import { FakeTdsDriver, VirtualClock } from "../../../src/services/tsNative/driver/fakeTdsDriver";
import { MemoryBreaker, MemoryReader } from "../../../src/services/tsNative/memoryBudget";
import {
    hasMeasurementTaintingOverrides,
    maskCapabilities,
    parseTsNativeOverrides,
} from "../../../src/services/tsNative/overrides";
import {
    TS_NATIVE_CAPABILITIES,
    TsNativeBackend,
} from "../../../src/services/tsNative/tsNativeBackend";

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_ovr",
    server: "fakehost",
    authKind: "sql",
    user: "sa",
};

suite("ts-native overrides and memory breaker (TSQ2-5/8)", () => {
    test("parse: knobs, unknown keys, mask allowlist, faults", () => {
        const parsed = parseTsNativeOverrides({
            pageRows: 50,
            pageBytes: 1024.7,
            bogusKnob: true,
            lossyPreview: true,
            capabilityMask: ["types.spatialWkbV1", "auth.integrated", "types.typedCells"],
            faults: { seed: 7, openDelayMs: 100, openFailure: "auth", hangOnCancel: true },
            memoryBudgetMiB: 256,
        });
        expect(parsed.pageRows).to.equal(50);
        expect(parsed.pageBytes).to.equal(1024);
        expect(parsed.memoryBudgetMiB).to.equal(256);
        expect(parsed.lossyPreview).to.equal(true);
        // auth.integrated is NOT maskable (masks never fabricate/force auth
        // semantics) — rejected into ignoredKeys with a prefix.
        expect(parsed.capabilityMask).to.deep.equal(["types.spatialWkbV1", "types.typedCells"]);
        expect(parsed.ignoredKeys).to.include("bogusKnob");
        expect(parsed.ignoredKeys?.some((k) => k.includes("auth.integrated"))).to.equal(true);
        expect(parsed.faults).to.deep.include({
            seed: 7,
            openDelayMs: 100,
            openFailure: "auth",
            hangOnCancel: true,
        });
        expect(hasMeasurementTaintingOverrides(parsed)).to.equal(true);
        expect(hasMeasurementTaintingOverrides(parseTsNativeOverrides({ pageRows: 10 }))).to.equal(
            false,
        );
        expect(parseTsNativeOverrides(null)).to.deep.equal({});
        expect(parseTsNativeOverrides("nope")).to.deep.equal({});
    });

    test("capability mask forces struct fields OFF, never on", () => {
        const masked = maskCapabilities(TS_NATIVE_CAPABILITIES, [
            "exec.compactRows",
            "types.typedCells",
        ]);
        expect(masked.compactRows).to.equal(false);
        expect(masked.typedCells).to.equal(false);
        // untouched fields keep their honest values
        expect(masked.streamingRows).to.equal(true);
        expect(masked.vectorBinaryV1).to.equal(false);
    });

    test("breaker: bounded sampling interval and pressure verdict", () => {
        let now = 0;
        let heap = 100;
        const reader: MemoryReader = {
            sample: () => ({
                heapUsedBytes: heap,
                externalBytes: 0,
                arrayBuffersBytes: 0,
                rssBytes: heap,
            }),
        };
        const breaker = new MemoryBreaker(
            reader,
            { maxUsedBytes: 1000, sampleEveryMs: 100 },
            () => now,
        );
        expect(breaker.check().pressure).to.equal(false);
        heap = 5000;
        // within the interval: no sample, no verdict flip (bounded cost)
        now = 50;
        expect(breaker.check().pressure).to.equal(false);
        now = 150;
        const verdict = breaker.check();
        expect(verdict.pressure).to.equal(true);
        expect(verdict.snapshot?.heapUsedBytes).to.equal(5000);
    });

    test("engine trips ResourceLimit through the breaker at a page point", async () => {
        const clock = new VirtualClock();
        const driver = new FakeTdsDriver(clock, {
            queries: [
                {
                    match: "BIG",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "rows", count: 100, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 100, more: false },
                    ],
                },
            ],
        });
        let heap = 0;
        let n = 0;
        const backend = new TsNativeBackend({
            driver,
            clock,
            ids: { next: (p) => `${p}-${++n}` },
            memoryBudget: { maxUsedBytes: 10_000, sampleEveryMs: 0 },
            memoryReader: {
                sample: () => ({
                    heapUsedBytes: (heap += 6000), // escalates past budget on 2nd page
                    externalBytes: 0,
                    arrayBuffersBytes: 0,
                    rssBytes: heap,
                }),
            },
        });
        const session = await (async () => {
            const opening = backend.openSession({
                profile: PROFILE,
                applicationName: "t",
                auth: { passwordProvider: async () => "" },
            });
            await clock.flush();
            return opening;
        })();
        const sink: IQueryEventSink = {
            onResultSetStarted: () => undefined,
            onRowsPage: () => undefined,
            onMessage: () => undefined,
            onComplete: () => undefined,
        };
        const handle = session.execute("BIG", { pageRows: 10 }, sink);
        await clock.advance(500);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.resourceLimit);
        await session.close();
    });
});
