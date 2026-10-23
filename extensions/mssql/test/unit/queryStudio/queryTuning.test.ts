/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryTuning parameter system (QO-1): precedence ladder, normalization/
 * clamping, digest stability, profile behavior, and the snapshot value-space
 * privacy canary (numbers/booleans/closed enums only — snapshots ride
 * diagnostics and run records).
 */

import { expect } from "chai";
import {
    QUERY_TUNING_DEFAULTS,
    QUERY_TUNING_KEYS,
    QUERY_TUNING_SPEC,
    normalizeQueryTuningOverrides,
    queryTuningParamsToOverrides,
} from "../../../src/sharedInterfaces/queryTuning";
import {
    QueryTuningSettingsReader,
    QUERY_TUNING_OVERRIDES_SETTING,
    QUERY_TUNING_PROFILE_SETTING,
    resolveQueryTuning,
} from "../../../src/queryStudio/tuning/queryTuningResolver";
import { QueryTuningOverrideStore } from "../../../src/queryStudio/tuning/queryTuningStore";

function reader(map: Record<string, unknown> = {}): QueryTuningSettingsReader {
    return { get: (section) => map[section] };
}

/** Resolve isolated from the live singleton store. */
function resolve(opts: {
    settings?: Record<string, unknown>;
    store?: Record<string, unknown>;
    run?: Record<string, unknown>;
}) {
    return resolveQueryTuning({
        reader: reader(opts.settings ?? {}),
        storeOverrides: normalizeQueryTuningOverrides(opts.store ?? {}),
        ...(opts.run ? { runOverrides: normalizeQueryTuningOverrides(opts.run) } : {}),
    });
}

suite("Query Studio QueryTuning parameters", () => {
    test("defaults resolve when nothing is configured", () => {
        const snapshot = resolve({});
        expect(snapshot.profileId).to.equal("interactive");
        expect(snapshot.params).to.deep.equal(QUERY_TUNING_DEFAULTS);
        expect(snapshot.overriddenKeys).to.deep.equal([]);
        expect(snapshot.digest).to.match(/^[0-9a-f]{12}$/);
    });

    test("dedicated settings feed their knob (maxRowsPerResultSet back-compat)", () => {
        const snapshot = resolve({
            settings: { "mssql.queryStudio.maxRowsPerResultSet": 1000 },
        });
        expect(snapshot.params.maxRowsPerResultSet).to.equal(1000);
        // Dedicated settings are the configured base, not an override layer.
        expect(snapshot.overriddenKeys).to.deep.equal([]);
    });

    test("profile presets apply and change the digest", () => {
        const defaults = resolve({});
        const throughput = resolve({
            settings: { [QUERY_TUNING_PROFILE_SETTING]: "throughput" },
        });
        expect(throughput.profileId).to.equal("throughput");
        expect(throughput.params.pageRows).to.equal(4096);
        expect(throughput.params.maxCellBytes).to.equal(defaults.params.maxCellBytes);
        expect(throughput.digest).to.not.equal(defaults.digest);
    });

    test("precedence: run override > store override > settings overrides > profile", () => {
        const base = {
            settings: {
                [QUERY_TUNING_PROFILE_SETTING]: "throughput",
                [QUERY_TUNING_OVERRIDES_SETTING]: { pageRows: 128 },
            },
        };
        expect(resolve(base).params.pageRows).to.equal(128);
        expect(resolve({ ...base, store: { pageRows: 256 } }).params.pageRows).to.equal(256);
        expect(
            resolve({ ...base, store: { pageRows: 256 }, run: { pageRows: 64 } }).params.pageRows,
        ).to.equal(64);
        const snapshot = resolve({ ...base, store: { pageRows: 256 } });
        expect(snapshot.overriddenKeys).to.include("pageRows");
    });

    test("null defers to the next layer", () => {
        const snapshot = resolve({
            store: { pageRows: 256 },
            run: { pageRows: null },
        });
        expect(snapshot.params.pageRows).to.equal(256);
    });

    test("profileId from overrides wins over the profile setting", () => {
        const snapshot = resolve({
            settings: { [QUERY_TUNING_PROFILE_SETTING]: "throughput" },
            run: { profileId: "lowMemory" },
        });
        expect(snapshot.profileId).to.equal("lowMemory");
        expect(snapshot.params.maxCellBytes).to.equal(256 * 1024);
    });

    test("invalid values are dropped, out-of-range values are clamped", () => {
        const snapshot = resolve({
            settings: {
                [QUERY_TUNING_OVERRIDES_SETTING]: {
                    pageRows: "big",
                    spillEnabled: "yes",
                    diagnosticsLevel: "chatty",
                    protectedCacheRatio: 2,
                    gridWindowRows: 3,
                },
            },
        });
        expect(snapshot.params.pageRows).to.equal(QUERY_TUNING_DEFAULTS.pageRows);
        expect(snapshot.params.spillEnabled).to.equal(QUERY_TUNING_DEFAULTS.spillEnabled);
        expect(snapshot.params.diagnosticsLevel).to.equal(QUERY_TUNING_DEFAULTS.diagnosticsLevel);
        expect(snapshot.params.protectedCacheRatio).to.equal(1);
        expect(snapshot.params.gridWindowRows).to.equal(10);
    });

    test("unknown keys are dropped by normalization", () => {
        expect(normalizeQueryTuningOverrides({ bogus: 1, alsoBogus: "x" })).to.deep.equal({});
    });

    test("digest is stable for equal params and changes when a param changes", () => {
        const a = resolve({ store: { pageBytes: 131072 } });
        const b = resolve({ store: { pageBytes: 131072 } });
        const c = resolve({ store: { pageBytes: 65536 } });
        expect(a.digest).to.equal(b.digest);
        expect(a.digest).to.not.equal(c.digest);
    });

    test("snapshot params round-trip through queryTuningParamsToOverrides", () => {
        const original = resolve({
            settings: { [QUERY_TUNING_PROFILE_SETTING]: "lowMemory" },
            store: { gridWindowRows: 100 },
        });
        const replayed = resolve({ run: queryTuningParamsToOverrides(original) });
        expect(replayed.digest).to.equal(original.digest);
        expect(replayed.params).to.deep.equal(original.params);
        expect(replayed.profileId).to.equal(original.profileId);
    });

    test("privacy canary: snapshot value space is numbers, booleans, and closed enums only", () => {
        const snapshot = resolve({
            store: { pageRows: 512, diagnosticsLevel: "verbose" },
        });
        for (const key of QUERY_TUNING_KEYS) {
            const value = snapshot.params[key];
            const spec = QUERY_TUNING_SPEC[key];
            switch (spec.kind) {
                case "number":
                    expect(value, key).to.be.a("number");
                    break;
                case "boolean":
                    expect(value, key).to.be.a("boolean");
                    break;
                case "enum":
                    expect(spec.values, key).to.include(value);
                    break;
            }
        }
    });

    test("override store normalizes updates and reset clears", () => {
        const store = new QueryTuningOverrideStore();
        store.updateOverrides({ pageRows: 512, bogus: true, spillEnabled: "no" });
        expect(store.getOverrides()).to.deep.equal({ pageRows: 512 });
        store.updateOverrides({ pageRows: null });
        expect(store.getOverrides()).to.deep.equal({ pageRows: null });
        store.reset();
        expect(store.getOverrides()).to.deep.equal({});
    });
});
