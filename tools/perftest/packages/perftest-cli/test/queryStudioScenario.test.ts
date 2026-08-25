import { describe, expect, it } from "vitest";
import {
    explainEventName,
    isKnownMetricName,
    loadRegistry,
} from "@mssqlperf/observability-contracts";

import { getScenario, listScenarios, scenarioMaturity } from "../src/scenarios/registry";

/**
 * querystudio-query-10k must stay the honest twin of the classic gate:
 * same fixture, same provisioning, registered markers only, exploratory
 * maturity until baseline history exists (no enthusiasm promotions).
 */
describe("querystudio-query-10k scenario registration", () => {
    const entry = getScenario("querystudio-query-10k");
    const classic = getScenario("query-10k-results");

    it("is registered, implemented, and exploratory", () => {
        expect(entry).toBeDefined();
        expect(entry!.implemented).toBe(true);
        expect(scenarioMaturity(entry!)).toBe("exploratory");
    });

    it("uses the classic gate's fixture document and SQL provisioning", () => {
        expect(classic).toBeDefined();
        expect(entry!.spec.sql?.database).toBe(classic!.spec.sql?.database);
        expect(entry!.spec.sql?.connectionProfile).toBe(classic!.spec.sql?.connectionProfile);
        const fixtureOf = (steps: Array<{ type: string; path?: string }> | undefined) =>
            steps?.find((s) => s.type === "openDocument")?.path;
        expect(fixtureOf(entry!.spec.setup as never)).toBe(fixtureOf(classic!.spec.setup as never));
    });

    it("waits only on markers registered in the observability contract", () => {
        const registry = loadRegistry();
        const names: string[] = [];
        for (const step of [...(entry!.spec.setup ?? []), ...entry!.spec.measure.action]) {
            if (step.type === "waitForMarker") names.push(step.name);
        }
        if (entry!.spec.measure.end.type === "waitForMarker") {
            names.push(entry!.spec.measure.end.name);
        }
        for (const criterion of entry!.spec.success ?? []) {
            if (criterion.type === "markerSeen") names.push(criterion.name);
        }
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            expect(explainEventName(name, registry).known, `unregistered marker: ${name}`).toBe(
                true,
            );
        }
    });

    it("derives only registry-declared metrics with the exact registered pairs", () => {
        const registry = loadRegistry();
        const paired = (entry!.spec.metrics ?? []).filter((m) => m.beginMarker && m.endMarker);
        expect(paired.length).toBe(2);
        for (const metric of paired) {
            expect(
                isKnownMetricName(metric.name, registry),
                `unregistered metric: ${metric.name}`,
            ).toBe(true);
            const declared = registry.metrics.find((m) => m.name === metric.name)!;
            expect([metric.beginMarker, metric.endMarker]).toEqual(declared.derivedFrom);
        }
    });

    it("keeps scenario.wallclock as the only official metric (driver plane)", () => {
        const officials = (entry!.spec.metrics ?? []).filter((m) => m.official);
        expect(officials.map((m) => m.name)).toEqual(["scenario.wallclock"]);
    });
});

describe("Query Studio backend A/B registration (TSQ2-12)", () => {
    const sts2 = getScenario("querystudio-query-10k-sts2");
    const tsNative = getScenario("querystudio-query-10k-tsnative");
    const expandedShapes = [
        {
            id: "querystudio-query-100k-narrow",
            fixture: "queries/select-100000-backend-ab.sql",
            endAttrs: { rows: 100000, resultSets: 1, activeTab: "results" },
            measureEnd: {
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 100000, resultSets: 1, activeTab: "results" },
            },
        },
        {
            id: "querystudio-query-wide-1000x300",
            fixture: "queries/wide-columns-1000.sql",
            endAttrs: { rows: 1000, resultSets: 1, activeTab: "results" },
            measureEnd: {
                name: "mssql.queryStudio.grid.firstVisibleRowsPainted",
                attrs: { columns: 300, projected: true },
            },
        },
        {
            id: "querystudio-query-large-cells",
            fixture: "queries/large-cells-1mb.sql",
            endAttrs: { rows: 20, resultSets: 1, activeTab: "results" },
            measureEnd: {
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 20, resultSets: 1, activeTab: "results" },
            },
        },
        {
            id: "querystudio-query-100-resultsets",
            fixture: "queries/hundred-result-sets.sql",
            endAttrs: { rows: 500, resultSets: 100, activeTab: "results" },
            measureEnd: {
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 500, resultSets: 100, activeTab: "results" },
            },
        },
    ] as const;

    function fixtureOf(entry: NonNullable<typeof sts2>): string | undefined {
        return (
            entry.spec.setup?.find((step) => step.type === "openDocument") as
                | { type: "openDocument"; path: string }
                | undefined
        )?.path;
    }

    function normalizeBackendIdentity(entry: NonNullable<typeof sts2>): unknown {
        const spec = structuredClone(entry.spec);
        spec.scenarioId = "<scenario>";
        spec.displayName = "<display>";
        return JSON.parse(
            JSON.stringify(spec)
                .replaceAll("sts2-local", "<backend>")
                .replaceAll("sts2-jsonrpc", "<backend>")
                .replaceAll("ts-native", "<backend>"),
        );
    }

    it("registers an exploratory pair whose only behavioral delta is backend identity", () => {
        expect(sts2).toBeDefined();
        expect(tsNative).toBeDefined();
        expect(sts2!.implemented).toBe(true);
        expect(tsNative!.implemented).toBe(true);
        expect(scenarioMaturity(sts2!)).toBe("exploratory");
        expect(scenarioMaturity(tsNative!)).toBe("exploratory");
        expect(normalizeBackendIdentity(sts2!)).toEqual(normalizeBackendIdentity(tsNative!));
    });

    it("uses a provider-neutral decimal projection without changing the shared data set", () => {
        expect(fixtureOf(sts2!)).toBe("queries/select-10000-backend-ab.sql");
        expect(fixtureOf(tsNative!)).toBe(fixtureOf(sts2!));
        expect(sts2!.spec.sql).toEqual(tsNative!.spec.sql);
    });

    it.each([
        ["sts2-local", "sts2-jsonrpc", sts2],
        ["ts-native", "ts-native", tsNative],
    ] as const)(
        "selects %s and proves provider=%s through Results paint",
        (setting, backend, entry) => {
            expect(entry!.spec.userSettings?.["mssql.sqlDataPlane.backend"]).toBe(setting);
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.connect.ready",
                attrs: { backend },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.query.submit",
                attrs: { backend },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.query.firstPage",
                attrs: { backend },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.query.complete",
                attrs: { rows: 10000, errors: 0, status: "succeeded", backend },
            });
            expect(entry!.spec.measure.end).toEqual({
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
            });
        },
    );

    it("derives a registered submit-to-first-accepted-page metric", () => {
        for (const entry of [sts2!, tsNative!]) {
            expect(entry.spec.metrics).toContainEqual({
                name: "mssql.queryStudio.query.toFirstPage",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.query.firstPage",
                component: "queryStudio",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            });
        }
    });

    it.each(expandedShapes)(
        "registers provider-identical $id pressure-shape pairs with exact provenance and focus oracles",
        ({ id, fixture, endAttrs, measureEnd }) => {
            const pair = [
                {
                    entry: getScenario(`${id}-sts2`),
                    setting: "sts2-local",
                    provenance: "sts2-jsonrpc",
                },
                {
                    entry: getScenario(`${id}-tsnative`),
                    setting: "ts-native",
                    provenance: "ts-native",
                },
            ] as const;

            expect(pair[0].entry).toBeDefined();
            expect(pair[1].entry).toBeDefined();
            expect(normalizeBackendIdentity(pair[0].entry!)).toEqual(
                normalizeBackendIdentity(pair[1].entry!),
            );

            for (const { entry, setting, provenance } of pair) {
                expect(scenarioMaturity(entry!)).toBe("exploratory");
                expect(entry!.spec.tags).toContain("backend-ab");
                expect(fixtureOf(entry!)).toBe(fixture);
                expect(entry!.spec.userSettings?.["mssql.sqlDataPlane.backend"]).toBe(setting);
                expect(entry!.spec.setup).toContainEqual({
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: 1, resultSets: 1, activeTab: "results" },
                    timeoutMs: 30000,
                });
                expect(entry!.spec.measure.end).toEqual({
                    type: "waitForMarker",
                    name: measureEnd.name,
                    attrs: measureEnd.attrs,
                });
                for (const [name, attrs] of [
                    ["mssql.queryStudio.connect.ready", { backend: provenance }],
                    ["mssql.queryStudio.query.submit", { backend: provenance }],
                    ["mssql.queryStudio.query.firstPage", { backend: provenance }],
                    [
                        "mssql.queryStudio.query.complete",
                        { backend: provenance, status: "succeeded", errors: 0 },
                    ],
                ] as const) {
                    expect(entry!.spec.success).toContainEqual({ type: "markerSeen", name, attrs });
                }
                expect(entry!.spec.success).toContainEqual({
                    type: "markerSeen",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: endAttrs,
                });
                expect(entry!.spec.metrics).toContainEqual(
                    expect.objectContaining({
                        name: "mssql.queryStudio.query.toFirstPage",
                        beginMarker: "mssql.queryStudio.query.submit",
                        endMarker: "mssql.queryStudio.query.firstPage",
                        withinMeasuredWindow: true,
                    }),
                );
                expect(entry!.spec.metrics).toContainEqual(
                    expect.objectContaining({ name: "scenario.wallclock", official: true }),
                );
            }
        },
    );

    it("keeps vector capability expectations honest across providers", () => {
        for (const [scenarioId, expectedVectorColumns] of [
            ["querystudio-query-vector-5k-sts2", 1],
            ["querystudio-query-vector-5k-tsnative", 0],
        ] as const) {
            const entry = getScenario(scenarioId);
            expect(entry).toBeDefined();
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.tabs.eligibility",
                attrs: { resultSets: 1, columns: 3, vectorColumns: expectedVectorColumns },
            });
        }
    });

    it("pairs forced spill and exact large-cell copy across providers without weakening readiness", () => {
        const pair = [
            {
                entry: getScenario("querystudio-interaction-copyall-large-cells-forced-spill-sts2"),
                setting: "sts2-local",
                provenance: "sts2-jsonrpc",
            },
            {
                entry: getScenario(
                    "querystudio-interaction-copyall-large-cells-forced-spill-tsnative",
                ),
                setting: "ts-native",
                provenance: "ts-native",
            },
        ] as const;

        expect(pair[0].entry).toBeDefined();
        expect(pair[1].entry).toBeDefined();
        expect(normalizeBackendIdentity(pair[0].entry!)).toEqual(
            normalizeBackendIdentity(pair[1].entry!),
        );

        for (const { entry, setting, provenance } of pair) {
            expect(scenarioMaturity(entry!)).toBe("exploratory");
            expect(entry!.spec.tags).toContain("backend-ab");
            expect(fixtureOf(entry!)).toBe("queries/large-cells-1mb.sql");
            expect(entry!.spec.userSettings?.["mssql.sqlDataPlane.backend"]).toBe(setting);
            expect(entry!.spec.userSettings?.["mssql.queryStudio.tuning.overrides"]).toEqual({
                storeMemoryBytes: 1048576,
                maxPendingSpillBytes: 1048576,
                diagnosticsLevel: "verbose",
            });
            expect(entry!.spec.setup).toContainEqual({
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 1, resultSets: 1, activeTab: "results" },
                timeoutMs: 30000,
            });
            for (const [name, attrs] of [
                ["mssql.queryStudio.connect.ready", { backend: provenance }],
                ["mssql.queryStudio.query.submit", { backend: provenance }],
                ["mssql.queryStudio.query.firstPage", { backend: provenance }],
                [
                    "mssql.queryStudio.query.complete",
                    { backend: provenance, status: "succeeded", errors: 0 },
                ],
            ] as const) {
                expect(entry!.spec.success).toContainEqual({ type: "markerSeen", name, attrs });
            }
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 20, resultSets: 1, activeTab: "results" },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.rows.spill.write",
                attrs: { encoding: "v8-v1" },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.rows.spill.read",
                attrs: { encoding: "v8-v1" },
            });
            expect(entry!.spec.success).toContainEqual({
                type: "markerSeen",
                name: "mssql.queryStudio.grid.copy.end",
                attrs: {
                    outcome: "copied",
                    rows: 20,
                    columns: 3,
                    characters: 2621556,
                    copyRoute: "hostDirect",
                    clipboardMode: "hostDirect",
                    hostRowFetches: 1,
                },
            });
            expect(entry!.spec.measure.action).toContainEqual({
                type: "queryStudioInteract",
                action: {
                    kind: "copyGrid",
                    resultSetIndex: 0,
                    selection: "all",
                    includeHeaders: true,
                },
                timeoutMs: 300000,
            });
            expect(entry!.spec.metrics).toContainEqual(
                expect.objectContaining({ name: "scenario.wallclock", official: true }),
            );
            expect(entry!.spec.metrics).toContainEqual({
                name: "mssql.queryStudio.grid.copy",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.grid.copy.begin",
                endMarker: "mssql.queryStudio.grid.copy.end",
                component: "queryStudio",
                processRole: "webview",
                withinMeasuredWindow: true,
            });
        }
    });
});

/**
 * EVERY querystudio-* scenario (including the QO-9a result-shape family and
 * any QO-9b spread expansion) obeys the same conformance rules: registered
 * markers only, registry-declared metric pairs, rows/attrs-guarded measured
 * end (the connect preflight emits the same marker family), and no official
 * metric beyond wallclock while maturity is exploratory.
 */
describe("querystudio scenario family conformance", () => {
    const registry = loadRegistry();
    const family = listScenarios().filter((s) => s.spec.scenarioId.startsWith("querystudio-"));

    it("has the QO-9a result-shape scenarios registered", () => {
        const ids = family.map((s) => s.spec.scenarioId);
        for (const expected of [
            "querystudio-query-scalar-results-focus",
            "querystudio-query-100k-narrow",
            "querystudio-query-wide-1000x300",
            "querystudio-query-large-cells",
            "querystudio-query-10k-messages",
            "querystudio-query-100-resultsets",
            "querystudio-soak-forced-spill-lifecycle",
        ]) {
            expect(ids, `missing scenario: ${expected}`).toContain(expected);
        }
    });

    it("pins first-query and fast scalar focus to the post-paint Results tab", () => {
        const scalar = getScenario("querystudio-query-scalar-results-focus")!;
        expect(scalar.spec.setup).toContainEqual({
            type: "openDocument",
            path: "queries/select-scalar-100.sql",
        });
        expect(scalar.spec.setup).toContainEqual({
            type: "waitForMarker",
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 1, resultSets: 1, activeTab: "results" },
            timeoutMs: 30000,
        });
        expect(scalar.spec.measure.end).toEqual({
            type: "waitForMarker",
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 1, resultSets: 1, activeTab: "results" },
        });
        expect(scalar.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 1, resultSets: 1, activeTab: "results" },
        });
    });

    it.each(family.map((s) => [s.spec.scenarioId, s] as const))(
        "%s waits/asserts only registered markers and derives registered metric pairs",
        (_id, scenario) => {
            const names: string[] = [];
            for (const step of [
                ...(scenario.spec.setup ?? []),
                ...(scenario.spec.loop?.steps ?? []),
                ...(scenario.spec.loop?.settleSteps ?? []),
                ...scenario.spec.measure.action,
                ...(scenario.spec.cleanup ?? []),
            ]) {
                if (step.type === "waitForMarker") names.push(step.name);
            }
            if (scenario.spec.measure.end.type === "waitForMarker") {
                names.push(scenario.spec.measure.end.name);
            }
            for (const criterion of scenario.spec.success ?? []) {
                // Negative proofs are still contract-bound: a markerAbsent on an
                // unregistered name would pass vacuously forever.
                if (criterion.type === "markerSeen" || criterion.type === "markerAbsent") {
                    names.push(criterion.name);
                }
            }
            for (const criterion of scenario.spec.loop?.success ?? []) {
                if (criterion.type === "markerSeen" || criterion.type === "markerAbsent") {
                    names.push(criterion.name);
                }
            }
            for (const name of names) {
                expect(explainEventName(name, registry).known, `unregistered marker: ${name}`).toBe(
                    true,
                );
            }
            for (const metric of (scenario.spec.metrics ?? []).filter(
                (m) => m.beginMarker && m.endMarker,
            )) {
                expect(
                    isKnownMetricName(metric.name, registry),
                    `unregistered metric: ${metric.name}`,
                ).toBe(true);
                const declared = registry.metrics.find((m) => m.name === metric.name)!;
                expect([metric.beginMarker, metric.endMarker]).toEqual(declared.derivedFrom);
            }
        },
    );

    it.each(family.map((s) => [s.spec.scenarioId, s] as const))(
        "%s guards its measured end with attrs and stays exploratory-honest on official metrics",
        (_id, scenario) => {
            if (scenario.spec.measure.end.type === "waitForMarker") {
                expect(
                    Object.keys(scenario.spec.measure.end.attrs ?? {}).length,
                    "measured end must be attrs-guarded against the connect preflight",
                ).toBeGreaterThan(0);
            }
            if (scenarioMaturity(scenario) === "exploratory") {
                const officials = (scenario.spec.metrics ?? []).filter((m) => m.official);
                for (const metric of officials) {
                    expect(metric.name).toBe("scenario.wallclock");
                }
            }
        },
    );

    it("soaks exact forced-spill copy and cleanup inside one process", () => {
        const soak = getScenario("querystudio-soak-forced-spill-lifecycle")!;
        expect(soak.spec.loop).toMatchObject({
            iterations: 100,
            warmupIterations: 5,
            onFailure: "continue",
        });
        expect(soak.spec.loop?.steps[0]).toEqual({
            type: "openDocument",
            path: "queries/large-cells-1mb.sql",
        });
        expect(soak.spec.loop?.steps).toContainEqual({
            type: "waitForMarker",
            name: "mssql.queryStudio.rows.dispose.end",
            attrs: { outcome: "ok", spillFileRemoved: true },
            timeoutMs: 60000,
        });
        expect(soak.spec.loop?.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.read",
            attrs: { encoding: "v8-v1" },
        });
    });
});

/**
 * VEC-12 — the Vector Workbench pair: the unopened-cost claim is proven with
 * markerAbsent negative proofs (chunk never requested, host never ingested),
 * and the activation profile derives only registry-declared pairs scoped to
 * the measured window. Both gate on the vectorWorkbench setting at launch.
 */
describe("querystudio-vector scenarios (VEC-12)", () => {
    const unopened = getScenario("querystudio-vector-unopened-f32");
    const profile = getScenario("querystudio-vector-profile-f32");
    const projection = getScenario("querystudio-vector-projection-f32");
    const searchExact = getScenario("querystudio-vector-search-exact-f32");
    const searchAnn = getScenario("querystudio-vector-search-ann-f32");

    it("both are registered, implemented, exploratory, and vector-gated", () => {
        for (const entry of [unopened, profile]) {
            expect(entry).toBeDefined();
            expect(entry!.implemented).toBe(true);
            expect(scenarioMaturity(entry!)).toBe("exploratory");
            expect(entry!.spec.userSettings?.["mssql.queryStudio.vectorWorkbench.enabled"]).toBe(
                true,
            );
            expect(entry!.spec.tags).toContain("vector");
        }
    });

    it("unopened: proves absence of BOTH the webview chunk request and the host ingest", () => {
        const absent = (unopened!.spec.success ?? []).filter((c) => c.type === "markerAbsent");
        expect(absent.map((c) => (c as { name: string }).name).sort()).toEqual([
            "mssql.queryResults.vector.ingest",
            "mssql.queryStudio.boot.vectorChunkRequested",
        ]);
    });

    it("unopened: measured end is rows-guarded against the connect preflight", () => {
        expect(unopened!.spec.measure.end).toEqual({
            type: "waitForMarker",
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 5000 },
        });
    });

    it("profile: activates the vector tab through the perf seam with an args payload", () => {
        const command = profile!.spec.measure.action.find((s) => s.type === "command");
        expect(command).toBeDefined();
        expect((command as { command: string }).command).toBe("mssql.perf.queryStudioActivateTab");
        expect((command as { args?: unknown[] }).args).toEqual([{ tab: "vector" }]);
    });

    it("profile: the query execute lives in SETUP so only activation → firstPaint is measured", () => {
        expect(profile!.spec.setup?.some((s) => s.type === "queryStudioExecute")).toBe(true);
        expect(profile!.spec.measure.action.some((s) => s.type === "queryStudioExecute")).toBe(
            false,
        );
        const lastAction = profile!.spec.measure.action[profile!.spec.measure.action.length - 1];
        expect(lastAction).toMatchObject({
            type: "waitForMarker",
            name: "mssql.queryResults.vector.render.firstPaint",
        });
        expect(profile!.spec.measure.end.type).toBe("afterLastAction");
    });

    it("profile: derives ONLY registry-declared pairs, all scoped to the measured window", () => {
        const registry = loadRegistry();
        const paired = (profile!.spec.metrics ?? []).filter((m) => m.beginMarker && m.endMarker);
        expect(paired.map((m) => m.name).sort()).toEqual([
            "mssql.queryResults.vector.analysis",
            "mssql.queryStudio.boot.vectorChunkLoad",
        ]);
        for (const metric of paired) {
            expect(
                isKnownMetricName(metric.name, registry),
                `unregistered metric: ${metric.name}`,
            ).toBe(true);
            const declared = registry.metrics.find((m) => m.name === metric.name)!;
            expect([metric.beginMarker, metric.endMarker]).toEqual(declared.derivedFrom);
            expect(metric.withinMeasuredWindow, `${metric.name} must be window-scoped`).toBe(true);
            expect(metric.official, `${metric.name} official before baselines exist`).toBe(false);
        }
    });

    it("registers Projection and both Search variants as implemented exploratory scenarios", () => {
        for (const entry of [projection, searchExact, searchAnn]) {
            expect(entry).toBeDefined();
            expect(entry!.implemented).toBe(true);
            expect(entry!.plannedMilestone).toBe("VEC-12");
            expect(scenarioMaturity(entry!)).toBe("exploratory");
            expect(entry!.spec.userSettings?.["mssql.queryStudio.vectorWorkbench.enabled"]).toBe(
                true,
            );
            expect(entry!.spec.tags).toContain("vector");
        }
    });

    it("nested workspaces start from a profile-ready setup outside the measured window", () => {
        for (const entry of [projection, searchExact, searchAnn]) {
            expect(entry!.spec.setup?.some((step) => step.type === "queryStudioExecute")).toBe(
                true,
            );
            expect(
                entry!.spec.setup?.some(
                    (step) =>
                        step.type === "waitForMarker" &&
                        step.name === "mssql.queryResults.vector.render.firstPaint",
                ),
            ).toBe(true);
            expect(
                entry!.spec.measure.action.some((step) => step.type === "queryStudioExecute"),
            ).toBe(false);
        }
    });

    it("Projection selects the real workspace and ends only on its Canvas first paint", () => {
        const command = projection!.spec.measure.action.find((step) => step.type === "command");
        expect(command).toMatchObject({
            type: "command",
            command: "mssql.perf.queryStudioActivateTab",
            args: [{ tab: "vector", vector: { workspace: "projection" } }],
        });
        expect(projection!.spec.measure.end).toEqual({
            type: "waitForMarker",
            name: "mssql.queryResults.vector.render.firstPaint",
            attrs: { workspace: "projection" },
        });
        const absent = (projection!.spec.success ?? []).filter((criterion) =>
            ["markerAbsent"].includes(criterion.type),
        );
        expect(absent.map((criterion) => (criterion as { name: string }).name).sort()).toEqual([
            "mssql.queryResults.vector.analysis.cancel",
            "mssql.queryResults.vector.model.end",
            "mssql.queryResults.vector.search.end",
            "mssql.queryResults.vector.worker.end",
            "mssql.queryResults.vector.worker.end",
        ]);
        expect(projection!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryResults.vector.worker.end",
            attrs: { operation: "projection", outcome: "ok", rows: 4988, dimensions: 64 },
        });
        expect(projection!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryResults.vector.analysis.end",
            attrs: { outcome: "ok", rows: 4988, dimensions: 64 },
        });
    });

    it("Search exact and ANN share one deterministic composition and differ only by the variant gate", () => {
        const commandArgs = (entry: NonNullable<typeof searchExact>) => {
            const command = entry.spec.measure.action.find((step) => step.type === "command");
            return (command as { command: string; args?: unknown[] }).args?.[0] as {
                tab: string;
                vector: {
                    workspace: string;
                    search: {
                        source: { kind: string; ordinal: number };
                        target: { schema: string; table: string; vectorColumn: string };
                        metric: string;
                        k: number;
                        includeApprox: boolean;
                    };
                };
            };
        };
        const exactArgs = commandArgs(searchExact!);
        const annArgs = commandArgs(searchAnn!);
        expect(exactArgs).toMatchObject({
            tab: "vector",
            vector: {
                workspace: "search",
                search: {
                    source: { kind: "selectedRow", ordinal: 1000 },
                    target: {
                        schema: "dbo",
                        table: "VectorLabSearchCorpus",
                        vectorColumn: "embedding",
                    },
                    metric: "cosine",
                    k: 20,
                    includeApprox: false,
                },
            },
        });
        expect(annArgs).toEqual({
            ...exactArgs,
            vector: {
                ...exactArgs.vector,
                search: { ...exactArgs.vector.search, includeApprox: true },
            },
        });
    });

    it("Search terminal markers prove the requested variant and exclude model calls", () => {
        for (const [entry, included] of [
            [searchExact!, false],
            [searchAnn!, true],
        ] as const) {
            expect(entry.spec.measure.end).toEqual({
                type: "waitForMarker",
                name: "mssql.queryResults.vector.search.end",
                attrs: { outcome: "ok", k: 20, approxIncluded: included },
            });
            expect(entry.spec.success).toContainEqual({
                type: "markerAbsent",
                name: "mssql.queryResults.vector.search.end",
                attrs: { approxIncluded: !included },
            });
            expect(entry.spec.success).toContainEqual({
                type: "markerAbsent",
                name: "mssql.queryResults.vector.model.end",
            });
        }
    });
});

describe("querystudio select-all interaction", () => {
    const entry = getScenario("querystudio-interaction-selectall-100k");

    it("drives the closed product selection seam over the 100k fixture", () => {
        expect(entry).toBeDefined();
        expect(entry!.spec.setup).toContainEqual({
            type: "openDocument",
            path: "queries/select-100000.sql",
        });
        expect(entry!.spec.measure.action).toContainEqual({
            type: "queryStudioInteract",
            action: { kind: "selectGrid", resultSetIndex: 0, selection: "all" },
        });
        expect(entry!.spec.measure.end).toEqual({ type: "afterLastAction" });
        expect(entry!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.interaction.end",
        });
    });
});

describe("querystudio copy-all interaction", () => {
    const entry = getScenario("querystudio-interaction-copyall-100k");

    it("drives the product copy path and requires its terminal work cardinalities", () => {
        expect(entry).toBeDefined();
        expect(entry!.spec.setup).toContainEqual({
            type: "openDocument",
            path: "queries/select-100000.sql",
        });
        expect(entry!.spec.measure.action).toContainEqual({
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        });
        expect(entry!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: { outcome: "copied", rows: 100000, columns: 4 },
        });
    });
});

describe("querystudio large-cell grid interaction", () => {
    const entry = getScenario("querystudio-interaction-large-cells-20x1mb");
    const copy = getScenario("querystudio-interaction-copyall-large-cells");
    const forcedSpill = getScenario("querystudio-interaction-copyall-large-cells-forced-spill");

    it("drives the real grid over the bounded JSON/XML MAX fixture", () => {
        expect(entry).toBeDefined();
        expect(entry!.spec.setup).toContainEqual({
            type: "openDocument",
            path: "queries/large-cells-1mb.sql",
        });
        expect(entry!.spec.measure.action).toContainEqual({
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "vertical", target: "end" },
        });
        expect(entry!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.rows.windowFetch.end",
            attrs: { gridPreview: true },
        });
        expect(entry!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.grid.window.received",
            attrs: { valueMode: "gridPreview" },
        });
    });

    it("copies the same large-cell fixture through the exact-value path", () => {
        expect(copy).toBeDefined();
        expect(copy!.spec.measure.action).toContainEqual({
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        });
        expect(copy!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: {
                outcome: "copied",
                rows: 20,
                columns: 3,
                characters: 2621556,
                copyRoute: "hostDirect",
                clipboardMode: "hostDirect",
                hostRowFetches: 1,
            },
        });
    });

    it("copies a message flood host-direct without returning raw text to the webview", () => {
        const entry = getScenario("querystudio-interaction-copyall-10k-messages");
        expect(entry).toBeDefined();
        expect(entry!.spec.measure.action).toContainEqual({
            type: "queryStudioInteract",
            action: { kind: "copyMessages" },
            timeoutMs: 300000,
        });
        expect(entry!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.messages.copy.end",
            attrs: { outcome: "copied", messages: 10003, copyRoute: "hostDirect" },
        });
    });

    it("forces eviction and proves exact copy after spill re-materialization", () => {
        expect(forcedSpill).toBeDefined();
        expect(forcedSpill!.spec.userSettings?.["mssql.queryStudio.tuning.overrides"]).toEqual({
            storeMemoryBytes: 1048576,
            maxPendingSpillBytes: 1048576,
            diagnosticsLevel: "verbose",
        });
        expect(forcedSpill!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.write",
            attrs: { encoding: "v8-v1" },
        });
        expect(forcedSpill!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.read",
            attrs: { encoding: "v8-v1" },
        });
        expect(forcedSpill!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: {
                outcome: "copied",
                rows: 20,
                columns: 3,
                characters: 2621556,
                copyRoute: "hostDirect",
                clipboardMode: "hostDirect",
                hostRowFetches: 1,
            },
        });
    });
});

describe("querystudio-spatial scenarios (SPA-9)", () => {
    const unopened = getScenario("querystudio-spatial-unopened-points");
    const points10k = getScenario("querystudio-spatial-points-10k-offline");
    const points100k = getScenario("querystudio-spatial-points-100k");

    it("registers gated exploratory unopened, 10k, and 100k scenarios", () => {
        for (const entry of [unopened, points10k, points100k]) {
            expect(entry).toBeDefined();
            expect(entry!.implemented).toBe(true);
            expect(entry!.plannedMilestone).toBe("SPA-9");
            expect(scenarioMaturity(entry!)).toBe("exploratory");
            expect(entry!.spec.userSettings?.["mssql.queryStudio.spatial.enabled"]).toBe(true);
            expect(entry!.spec.tags).toContain("spatial");
            expect(entry!.spec.sql).toEqual({ connectionProfile: "default", cacheMode: "warm" });
        }
    });

    it("unopened proves host, worker, chunk, and renderer absence", () => {
        const absent = (unopened!.spec.success ?? [])
            .filter((criterion) => criterion.type === "markerAbsent")
            .map((criterion) => (criterion as { name: string }).name)
            .sort();
        expect(absent).toEqual([
            "mssql.queryResults.spatial.decode.begin",
            "mssql.queryResults.spatial.prepare.begin",
            "mssql.queryResults.spatial.render.begin",
            "mssql.queryStudio.boot.spatialChunkRequested",
        ]);
    });

    it("activation scenarios execute in setup and drive the generic pane command", () => {
        for (const entry of [points10k, points100k]) {
            expect(entry!.spec.setup?.some((step) => step.type === "queryStudioExecute")).toBe(
                true,
            );
            expect(entry!.spec.measure.action).toContainEqual({
                type: "command",
                command: "mssql.perf.queryStudioActivateTab",
                args: [{ tab: "spatial" }],
                timeoutMs: 30000,
            });
        }
        expect(points10k!.spec.measure.end).toEqual({
            type: "waitForMarker",
            name: "mssql.queryResults.spatial.render.settled",
            attrs: { tier: "clusters" },
        });
        expect(points100k!.spec.measure.end).toEqual({
            type: "waitForMarker",
            name: "mssql.queryResults.spatial.render.settled",
            attrs: { tier: "clusters" },
        });
        expect(points100k!.spec.success).toContainEqual({
            type: "markerSeen",
            name: "mssql.queryResults.spatial.render.settled",
            attrs: { tier: "clusters", partial: "true" },
        });
    });

    it("paired activation metrics are registry declared and window scoped", () => {
        const registry = loadRegistry();
        for (const entry of [points10k, points100k]) {
            const paired = (entry!.spec.metrics ?? []).filter(
                (metric) => metric.beginMarker && metric.endMarker,
            );
            for (const metric of paired) {
                expect(isKnownMetricName(metric.name, registry)).toBe(true);
                expect(
                    registry.metrics.find((candidate) => candidate.name === metric.name)
                        ?.derivedFrom,
                ).toEqual([metric.beginMarker, metric.endMarker]);
                expect(metric.withinMeasuredWindow).toBe(true);
                expect(metric.official).toBe(false);
            }
        }
    });
});
