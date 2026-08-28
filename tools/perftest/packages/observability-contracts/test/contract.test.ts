/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The sacred small suite: registry integrity + timing-honesty rules.
 * If these fail, the shared observability story is broken — fix the
 * registry or the offending emitter, never the test.
 */

import { describe, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { deriveEligibility, explainEventName, isKnownMetricName, loadRegistry } from "../src/index";

const reg = loadRegistry();

describe("registry integrity", () => {
    test("every entry has exactly one of name|prefix and no duplicates", () => {
        const seen = new Set<string>();
        for (const e of reg.events) {
            expect(Boolean(e.name) !== Boolean(e.prefix), `${e.name ?? e.prefix}`).toBe(true);
            const key = e.name ?? `prefix:${e.prefix}`;
            expect(seen.has(key), `duplicate ${key}`).toBe(false);
            seen.add(key);
        }
    });

    test("every attr classification exists in the taxonomy", () => {
        for (const e of reg.events) {
            for (const [attr, cls] of Object.entries(e.attrs)) {
                expect(
                    reg.classifications[cls],
                    `${e.name ?? e.prefix}.${attr} -> unknown classification '${cls}'`,
                ).toBeDefined();
            }
        }
    });

    test("marker pairing is symmetric and phases are consistent", () => {
        for (const e of reg.events) {
            if (!e.pairsWith || !e.name) {
                continue;
            }
            const partner = reg.events.find((p) => p.name === e.pairsWith);
            expect(partner, `${e.name} pairsWith missing ${e.pairsWith}`).toBeDefined();
            expect(partner!.pairsWith, `${e.pairsWith} must pair back to ${e.name}`).toBe(e.name);
            expect(
                e.phase === "begin" || e.phase === "end",
                `${e.name} paired but phase=${e.phase}`,
            ).toBe(true);
        }
    });

    test("every derived metric's inputs are registered events", () => {
        for (const m of reg.metrics) {
            for (const input of m.derivedFrom) {
                expect(explainEventName(input, reg).known, `${m.name} input ${input} unknown`).toBe(
                    true,
                );
            }
        }
    });

    test("derived metric names do not collide with exact event names", () => {
        const eventNames = new Set(reg.events.flatMap((event) => (event.name ? [event.name] : [])));
        for (const metric of reg.metrics) {
            expect(eventNames.has(metric.name), `metric/event name collision: ${metric.name}`).toBe(
                false,
            );
        }
    });

    test("sts.* families are epoch-aligned and never measurement-eligible", () => {
        for (const e of reg.events) {
            if (e.prefix?.startsWith("sts.")) {
                expect(e.timingClass, e.prefix).toBe("epochAligned");
                expect(e.measurementEligible, e.prefix).toBe(false);
            }
        }
    });

    test("timing classes referenced by events all exist", () => {
        for (const e of reg.events) {
            expect(reg.timingClasses[e.timingClass], `${e.name ?? e.prefix}`).toBeDefined();
        }
    });
});

describe("name matching", () => {
    test("exact, prefix (with phase suffixes), and unknown", () => {
        expect(explainEventName("mssql.query.complete").matchedBy).toBe("exact");
        expect(explainEventName("rpc.query/executeString.begin").matchedBy).toBe("prefix");
        expect(explainEventName("sts.dacfx.tableDesigner.initialize").entry?.feature).toBe("dacfx");
        expect(explainEventName("sts.dispatch.connection/connect").entry?.feature).toBe(
            "stsDispatcher",
        );
        expect(explainEventName("mssql.made.up.name").known).toBe(false);
    });

    test("longest prefix wins", () => {
        // sts.dispatch. must not be shadowed by a hypothetical shorter sts. entry
        const match = explainEventName("sts.dispatch.query/executeString");
        expect(match.entry?.prefix).toBe("sts.dispatch.");
    });

    test("metric names", () => {
        expect(isKnownMetricName("scenario.wallclock")).toBe(true);
        expect(isKnownMetricName("mssql.query.toRender")).toBe(true);
        expect(isKnownMetricName("bogus.metric")).toBe(false);
    });
});

describe("timing honesty (eligibility decision)", () => {
    const base = {
        source: "marker",
        passType: "measurement" as const,
        environment: "controlledHarness" as const,
        timePlane: "monotonic" as const,
        repStatus: "passed" as const,
        richCollection: false,
    };

    test("same-process marker pair in a controlled measurement run gates CI", () => {
        const e = deriveEligibility(base);
        expect(e.measurementEligible).toBe(true);
        expect(e.ciGatingEligible).toBe(true);
        expect(e.diagnosticOnly).toBe(false);
    });

    test("interactive host (self-test) is exploratory, never gating", () => {
        const e = deriveEligibility({ ...base, environment: "interactiveHost" });
        expect(e.measurementEligible).toBe(true);
        expect(e.exploratory).toBe(true);
        expect(e.ciGatingEligible).toBe(false);
        expect(e.reason).toContain("never a gate");
    });

    test("epoch-aligned duration can never be measurement-eligible", () => {
        const e = deriveEligibility({ ...base, timePlane: "epoch" });
        expect(e.measurementEligible).toBe(false);
        expect(e.diagnosticOnly).toBe(true);
    });

    test("diagnostic pass can never produce gating metrics", () => {
        const e = deriveEligibility({ ...base, passType: "diagnostic" });
        expect(e.ciGatingEligible).toBe(false);
        expect(e.diagnosticOnly).toBe(true);
    });

    test("rich collection forces diagnostic-only", () => {
        const e = deriveEligibility({ ...base, richCollection: true });
        expect(e.diagnosticOnly).toBe(true);
        expect(e.reason).toContain("rich collection");
    });

    test("collector provenance forces diagnostic-only", () => {
        const e = deriveEligibility({ ...base, source: "sqlServerXEvents", fromCollector: true });
        expect(e.diagnosticOnly).toBe(true);
    });

    test("failed/invalid reps measure nothing", () => {
        for (const repStatus of ["failed", "invalid", "aborted"] as const) {
            expect(deriveEligibility({ ...base, repStatus }).measurementEligible).toBe(false);
        }
    });

    test("derived metrics need an eligible derivation chain to measure", () => {
        const bare = deriveEligibility({ ...base, source: "derived" });
        expect(bare.diagnosticOnly).toBe(true);
        expect(bare.reason).toContain("derivation block");
        const provenanced = deriveEligibility({
            ...base,
            source: "derived",
            timePlane: "derived",
            hasDerivation: true,
            inputs: [deriveEligibility(base)],
        });
        expect(provenanced.measurementEligible).toBe(true);
        expect(provenanced.timePlane).toBe("monotonic");

        const collector = deriveEligibility({
            ...base,
            source: "sqlServerXEvents",
            fromCollector: true,
        });
        const laundered = deriveEligibility({
            ...base,
            source: "derived",
            timePlane: "derived",
            hasDerivation: true,
            inputs: [deriveEligibility(base), collector],
        });
        expect(laundered.diagnosticOnly).toBe(true);
        expect(laundered.reason).toContain("derived input is diagnostic-only");
    });
});

describe("cross-repo conformance: names actually used by scenarios", () => {
    test("every marker the in-proc and CLI scenarios wait on is registered", () => {
        const files = [
            path.join(__dirname, "..", "..", "perftest-inproc", "src", "scenarios.ts"),
            path.join(__dirname, "..", "..", "perftest-cli", "src", "scenarios", "registry.ts"),
        ].filter((f) => fs.existsSync(f));
        expect(files.length).toBeGreaterThan(0);
        const unknown: string[] = [];
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            // Names passed to marker waits / metric marker pairs.
            for (const m of source.matchAll(/"((?:mssql|scenario|sts)\.[a-zA-Z0-9./_-]+)"/g)) {
                const name = m[1];
                if (explainEventName(name).known || isKnownMetricName(name)) {
                    continue;
                }
                // Command ids and non-event strings share the mssql. prefix; only
                // flag names that look like marker phases or known metric shapes.
                if (/\.(begin|end|ready|complete|failed|cancelled)$/.test(name)) {
                    unknown.push(`${path.basename(file)}: ${name}`);
                }
            }
        }
        expect(unknown, `unregistered marker names:\n${unknown.join("\n")}`).toEqual([]);
    });
});
