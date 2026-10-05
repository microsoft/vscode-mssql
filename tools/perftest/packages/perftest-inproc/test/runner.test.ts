/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-process runner unit tests: marker-bus freshness + timeout diagnostics,
 * honest metric derivation, and runner policies (SQL skip, CLI-only skip,
 * fail-fast after a first-rep marker timeout, cancellation).
 */
import { describe, expect, test } from "vitest";
import { MarkerBus, BusMarker } from "../src/markerBus";
import { deriveMetrics } from "../src/metrics";
import { SelfTestRunner } from "../src/runner";
import { BuiltinScenario, builtinScenario, BUILTIN_SCENARIOS } from "../src/scenarios";
import { validateTimerMs } from "../src/timer";

function marker(name: string, atMs: number): BusMarker {
    return {
        name,
        phase: "instant",
        timestampUnixNs: (BigInt(atMs) * 1_000_000n).toString(),
        process: { role: "extensionHost", pid: 1, name: "test" },
    };
}

describe("MarkerBus", () => {
    test("rejects invalid and oversized untrusted timer durations", () => {
        expect(() => validateTimerMs(-1, 100, "test timer")).toThrow(/outside/);
        expect(() => validateTimerMs(Number.NaN, 100, "test timer")).toThrow(/outside/);
        expect(() => validateTimerMs(86_400_001, 100, "test timer")).toThrow(/outside/);
        expect(validateTimerMs(undefined, 100, "test timer")).toBe(100);
    });

    test("freshness guard rejects stale markers", async () => {
        const bus = new MarkerBus();
        bus.deliver(marker("mssql.activate.end", 1000));
        // A wait scoped after t=2000 must NOT resolve on the stale marker.
        await expect(
            bus.wait("mssql.activate.end", undefined, 50, (2000n * 1_000_000n).toString()),
        ).rejects.toThrow(/Timed out/);
    });

    test("timeout errors carry diagnostics: expected marker, stale note, last-seen tail", async () => {
        const bus = new MarkerBus();
        bus.deliver(marker("mssql.activate.end", 1000));
        bus.deliver(marker("scenario.start", 3000));
        try {
            await bus.wait("mssql.activate.end", undefined, 50, (2000n * 1_000_000n).toString());
            expect.unreachable("wait should have timed out");
        } catch (error) {
            const message = (error as Error).message;
            expect(message).toContain("mssql.activate.end");
            expect(message).toContain("predate the measured window");
            expect(message).toContain("scenario.start");
        }
    });

    test("attrs matching resolves only exact matches", async () => {
        const bus = new MarkerBus();
        const wait = bus.wait("mssql.query.complete", { rowCount: 10 }, 500);
        bus.deliver({ ...marker("mssql.query.complete", 1000), attrs: { rowCount: 5 } });
        bus.deliver({ ...marker("mssql.query.complete", 1001), attrs: { rowCount: 10 } });
        const resolved = await wait;
        expect(resolved.attrs?.rowCount).toBe(10);
    });
});

describe("deriveMetrics", () => {
    test("derives wallclock and named metrics from real marker deltas", () => {
        const markers = [
            marker("scenario.start", 1000),
            marker("mssql.query.submit", 1010),
            marker("mssql.query.complete", 1040),
            marker("scenario.end", 1055),
        ];
        const metrics = deriveMetrics(markers, [
            { name: "scenario.wallclock", official: true },
            {
                name: "q",
                official: false,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.query.complete",
            },
        ]);
        expect(metrics.find((m) => m.name === "scenario.wallclock")?.value).toBe(55);
        expect(metrics.find((m) => m.name === "q")?.value).toBe(30);
    });

    test("missing markers produce NO metric — never fabricated", () => {
        const metrics = deriveMetrics(
            [marker("scenario.start", 1000)],
            [{ name: "scenario.wallclock", official: true }],
        );
        expect(metrics).toHaveLength(0);
    });
});

function runnerFor(
    scenarios: BuiltinScenario[],
    options?: { connection?: boolean; reps?: number },
) {
    const events: string[] = [];
    const runner = new SelfTestRunner({
        runId: "test",
        scenarios,
        repetitions: options?.reps ?? 1,
        warmupRepetitions: 0,
        ...(options?.connection
            ? {
                  connectionProfiles: {
                      default: { server: "s", authenticationType: "Integrated" as const },
                  },
              }
            : {}),
        onEngineMarker: (m) => runner.deliverMarker(m),
        onEvent: (e) => events.push(e.kind + (e.kind === "scenarioSkipped" ? `:${e.reason}` : "")),
    });
    return { runner, events };
}

describe("SelfTestRunner policies", () => {
    test("CLI-only scenarios skip with their honest reason (no hang)", async () => {
        const activation = builtinScenario("selftest-activation")!;
        const { runner, events } = runnerFor([activation]);
        const started = Date.now();
        const result = await runner.run();
        expect(Date.now() - started).toBeLessThan(2000);
        expect(result.scenarios[0].skipped).toBe(true);
        expect(result.scenarios[0].reason).toContain("once-per-process");
        expect(events.some((e) => e.startsWith("scenarioSkipped"))).toBe(true);
    });

    test("SQL scenarios skip without a connection", async () => {
        const connect = builtinScenario("selftest-connect")!;
        const { runner } = runnerFor([connect]);
        const result = await runner.run();
        expect(result.scenarios[0].skipped).toBe(true);
        expect(result.scenarios[0].reason).toContain("SQL connection");
    });

    test("first-rep marker timeout aborts the scenario's remaining reps", async () => {
        const doomed: BuiltinScenario = {
            id: "test-timeout",
            title: "waits for a marker that never comes",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-timeout",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "noop" }],
                    end: { type: "waitForMarker", name: "never.emitted" },
                    timeoutMs: 100,
                },
            },
        };
        const { runner } = runnerFor([doomed], { reps: 5 });
        const started = Date.now();
        const result = await runner.run();
        const elapsed = Date.now() - started;
        // One rep (~100ms timeout), not five.
        expect(result.reps.filter((r) => r.scenarioId === "test-timeout")).toHaveLength(1);
        expect(elapsed).toBeLessThan(2000);
        expect(result.reps[0].failureReason).toContain("never.emitted");
    });

    test("noop scenario passes with derived wallclock and cancellation stops the run", async () => {
        const noop = builtinScenario("selftest-noop")!;
        const delay = builtinScenario("selftest-synthetic-delay")!;
        const { runner } = runnerFor([noop, delay], { reps: 2 });
        // Cancel during the delay scenario's FIRST rep (noop reps take ~1ms,
        // the delay rep takes ~250ms): rep 0 completes, rep 1 must never start.
        setTimeout(() => runner.cancel(), 100);
        const result = await runner.run();
        const noopReps = result.reps.filter((r) => r.scenarioId === "selftest-noop");
        expect(noopReps).toHaveLength(2);
        expect(noopReps.every((r) => r.status === "passed")).toBe(true);
        expect(noopReps.every((r) => r.metrics.some((m) => m.name === "scenario.wallclock"))).toBe(
            true,
        );
        const delayReps = result.reps.filter((r) => r.scenarioId === "selftest-synthetic-delay");
        expect(delayReps).toHaveLength(1);
    });

    test("cancel interrupts an IN-FLIGHT marker wait within ~a second", async () => {
        const waiting: BuiltinScenario = {
            id: "test-cancel-wait",
            title: "waits forever unless cancelled",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-cancel-wait",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "noop" }],
                    // 60s timeout: only cancellation can end this quickly.
                    end: {
                        type: "waitForMarker",
                        name: "never.emitted",
                        timeoutMs: 60000,
                    } as never,
                    timeoutMs: 60000,
                },
            },
        };
        const { runner } = runnerFor([waiting], { reps: 3 });
        setTimeout(() => runner.cancel(), 150);
        const started = Date.now();
        const result = await runner.run();
        expect(Date.now() - started).toBeLessThan(3000);
        expect(result.reps[0].status).toBe("skipped");
        expect(result.reps[0].failureReason).toBe("cancelled");
    });

    test("first-rep failure of ANY kind aborts the scenario's remaining reps", async () => {
        const broken: BuiltinScenario = {
            id: "test-broken-step",
            title: "step throws immediately",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-broken-step",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "definitely-not-a-step" }],
                    end: { type: "afterLastAction" },
                    timeoutMs: 5000,
                },
            },
        };
        const { runner } = runnerFor([broken], { reps: 4 });
        const result = await runner.run();
        expect(result.reps.filter((r) => r.scenarioId === "test-broken-step")).toHaveLength(1);
        expect(result.reps[0].failureReason).toContain("Unknown step type");
    });

    test("markerAbsent criterion fails when the marker occurred, naming the occurrence", async () => {
        const scenario: BuiltinScenario = {
            id: "test-marker-absent-fails",
            title: "asserts absence of a marker the engine itself emits",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-marker-absent-fails",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "noop" }],
                    end: { type: "afterLastAction" },
                    timeoutMs: 5000,
                },
                // scenario.start IS emitted by the engine — the negative proof
                // must fail and the message must name the offending occurrence.
                success: [{ type: "markerAbsent", name: "scenario.start" }],
            },
        };
        const { runner } = runnerFor([scenario]);
        const result = await runner.run();
        expect(result.reps[0].status).toBe("failed");
        expect(result.reps[0].failureReason).toContain("scenario.start");
        expect(result.reps[0].failureReason).toContain("WAS observed");
    });

    test("markerAbsent criterion passes for absent names and non-matching attrs", async () => {
        const scenario: BuiltinScenario = {
            id: "test-marker-absent-passes",
            title: "asserts absence honestly",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-marker-absent-passes",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "noop" }],
                    end: { type: "afterLastAction" },
                    timeoutMs: 5000,
                },
                success: [
                    // Never emitted at all.
                    { type: "markerAbsent", name: "never.emitted" },
                    // Emitted, but with different attrs — markerSeen matching
                    // semantics apply symmetrically.
                    {
                        type: "markerAbsent",
                        name: "scenario.start",
                        attrs: { scenarioId: "some-other-scenario" },
                    },
                ],
            },
        };
        const { runner } = runnerFor([scenario]);
        const result = await runner.run();
        expect(result.reps[0].status).toBe("passed");
    });

    test("markerAbsent without a name fails honestly (never a vacuous pass)", async () => {
        const scenario: BuiltinScenario = {
            id: "test-marker-absent-noname",
            title: "spec bug: no marker name",
            description: "",
            tags: [],
            needsSql: false,
            estMs: 10,
            metrics: [{ name: "scenario.wallclock", official: true }],
            spec: {
                scenarioId: "test-marker-absent-noname",
                displayName: "t",
                measure: {
                    start: { type: "beforeFirstAction" },
                    action: [{ type: "noop" }],
                    end: { type: "afterLastAction" },
                    timeoutMs: 5000,
                },
                success: [{ type: "markerAbsent" }],
            },
        };
        const { runner } = runnerFor([scenario]);
        const result = await runner.run();
        expect(result.reps[0].status).toBe("failed");
        expect(result.reps[0].failureReason).toContain("missing marker name");
    });

    test("catalog sanity: every builtin has metrics or an honest skip", () => {
        for (const scenario of BUILTIN_SCENARIOS) {
            if (scenario.inProcess === false) {
                expect(scenario.skipReason, scenario.id).toBeTruthy();
            } else {
                expect(scenario.metrics.length, scenario.id).toBeGreaterThan(0);
            }
        }
    });
});
