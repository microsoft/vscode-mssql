/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf Test History directory provider: pure aggregation math, filtering,
 * grouping, incremental index cache behavior, corrupt-run tolerance, and a
 * synthetic large-history performance measurement (scale is a feature).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    DirectoryHistoryProvider,
    filterRuns,
    IndexedScenario,
    mergeGroup,
    officialSamples,
    percentile,
    runVerdict,
    scenarioRowFrom,
    suiteFor,
} from "../../src/diagnostics/perfHistory/directoryProvider";
import { PerfRunRow } from "../../src/sharedInterfaces/perfHistory";

// --- pure helpers -------------------------------------------------------------

function indexedScenario(values: number[], overrides?: Partial<IndexedScenario>): IndexedScenario {
    return {
        scenarioId: "query-10k-results",
        reps: values.map((value, repId) => ({
            repId,
            status: "passed",
            warmup: false,
            official: { "scenario.wallclock": value },
            diagnostic: {},
        })),
        artifactKinds: ["markers"],
        validationFailures: 0,
        ...overrides,
    };
}

suite("Perf history aggregation (pure)", () => {
    test("percentile handles empty, single, and even-sized samples", () => {
        expect(percentile([], 50)).to.equal(undefined);
        expect(percentile([7], 50)).to.equal(7);
        expect(percentile([1, 2, 3, 4], 50)).to.equal(2);
        expect(percentile([1, 2, 3, 4], 95)).to.equal(4);
    });

    test("officialSamples excludes warmup and failed reps", () => {
        const scenario = indexedScenario([100, 200, 300]);
        scenario.reps[0].warmup = true;
        scenario.reps[2].status = "failed";
        expect(officialSamples(scenario, "scenario.wallclock")).to.deep.equal([200]);
    });

    test("runVerdict maps statuses honestly", () => {
        expect(runVerdict({ status: "passed", failedReps: 0, invalidReps: 0 })).to.equal("ok");
        expect(runVerdict({ status: "passed", failedReps: 1, invalidReps: 0 })).to.equal("warning");
        expect(runVerdict({ status: "failed", failedReps: 2, invalidReps: 0 })).to.equal("failed");
        expect(runVerdict({ status: "invalid", failedReps: 0, invalidReps: 3 })).to.equal(
            "invalid",
        );
        expect(runVerdict({ status: "???", failedReps: 0, invalidReps: 0 })).to.equal("unknown");
    });

    test("scenarioRowFrom aggregates p50/p95 and computes baseline delta", () => {
        const current = indexedScenario([100, 110, 120, 130]);
        const baseline = indexedScenario([100, 100, 100, 100]);
        const row = scenarioRowFrom(
            "query-10k-results",
            [{ runId: "run-b", scenario: current }],
            "scenario.wallclock",
            baseline,
        );
        expect(row.p50Ms).to.equal(110);
        expect(row.baselineP50Ms).to.equal(100);
        expect(row.deltaPct).to.equal(10);
        expect(row.verdict).to.equal("ok");
        expect(row.suite).to.equal("Query & Results");
        expect(row.lowConfidence).to.equal(undefined);
    });

    test("scenarioRowFrom flags low confidence under 3 valid reps and never invents values", () => {
        const row = scenarioRowFrom(
            "selftest-noop",
            [{ runId: "r", scenario: indexedScenario([5, 6]) }],
            "scenario.wallclock",
        );
        expect(row.lowConfidence).to.equal(true);
        expect(row.baselineP50Ms).to.equal(undefined);
        expect(row.deltaPct).to.equal(undefined);
    });

    test("scenarioRowFrom marks skipped scenarios instead of fabricating a verdict", () => {
        const skipped = indexedScenario([], { reps: [], skippedReason: "needs a SQL connection" });
        const row = scenarioRowFrom(
            "selftest-connect",
            [{ runId: "r", scenario: skipped }],
            "scenario.wallclock",
        );
        expect(row.skippedReason).to.equal("needs a SQL connection");
        expect(row.p50Ms).to.equal(undefined);
    });

    test("mergeGroup takes the worst verdict and unions artifacts", () => {
        const ok = scenarioRowFrom(
            "a",
            [{ runId: "r", scenario: indexedScenario([10, 10, 10]) }],
            "scenario.wallclock",
        );
        const failed = scenarioRowFrom(
            "b",
            [
                {
                    runId: "r",
                    scenario: indexedScenario([20, 20, 20], {
                        reps: [
                            {
                                repId: 0,
                                status: "failed",
                                warmup: false,
                                official: {},
                                diagnostic: {},
                            },
                        ],
                        artifactKinds: ["markers", "sqlActivity"],
                    }),
                },
            ],
            "scenario.wallclock",
        );
        const merged = mergeGroup("Query & Results", [ok, failed]);
        expect(merged.verdict).to.equal("failed");
        expect(merged.artifactKinds).to.include("sqlActivity");
        expect(merged.key).to.include("(2)");
    });

    test("suiteFor buckets scenario families", () => {
        expect(suiteFor("query-10k-results")).to.equal("Query & Results");
        expect(suiteFor("expand-tables-node-10k")).to.equal("Object Explorer");
        expect(suiteFor("connect-local-container")).to.equal("Connections");
        expect(suiteFor("soak-connect-query-disconnect")).to.equal("Soak");
        expect(suiteFor("something-else")).to.equal("Other");
    });

    test("filterRuns applies text/verdict/time filters with paging", () => {
        const rows: PerfRunRow[] = [
            {
                runId: "2026-07-01T00-00-00Z_a",
                sourceId: "s",
                createdUtc: "2026-07-01T00:00:00Z",
                status: "passed",
                verdict: "ok",
                commit: "abc12345",
                scenarioTotal: 1,
                scenarioPassed: 1,
                repTotal: 4,
                failedReps: 0,
                invalidReps: 0,
                artifactKinds: [],
            },
            {
                runId: "2026-07-03T00-00-00Z_b",
                sourceId: "s",
                createdUtc: "2026-07-03T00:00:00Z",
                status: "failed",
                verdict: "failed",
                scenarioTotal: 2,
                scenarioPassed: 1,
                repTotal: 8,
                failedReps: 2,
                invalidReps: 0,
                artifactKinds: [],
            },
        ];
        const byVerdict = filterRuns(rows, { sourceId: "s", verdicts: ["failed"] });
        expect(byVerdict.rows).to.have.length(1);
        expect(byVerdict.totalInSource).to.equal(2);
        const byText = filterRuns(rows, { sourceId: "s", text: "abc123" });
        expect(byText.rows[0].runId).to.include("_a");
        const since = filterRuns(rows, { sourceId: "s", sinceUtc: "2026-07-02T00:00:00Z" });
        expect(since.rows).to.have.length(1);
        const paged = filterRuns(rows, { sourceId: "s", offset: 1, limit: 1 });
        expect(paged.rows).to.have.length(1);
        expect(paged.total).to.equal(2);
    });
});

// --- filesystem provider -------------------------------------------------------

function writeRun(
    root: string,
    runId: string,
    options: {
        status?: string;
        scenarios: Record<string, number[]>;
        corruptRep?: boolean;
    },
): void {
    const runDir = path.join(root, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
        path.join(runDir, "summary.json"),
        JSON.stringify({
            status: options.status ?? "passed",
            passType: "selfTest",
            environmentHash: "test-env",
            runId,
        }),
    );
    for (const [scenarioId, values] of Object.entries(options.scenarios)) {
        values.forEach((value, repId) => {
            const repDir = path.join(
                runDir,
                "scenarios",
                scenarioId,
                "reps",
                `rep-${String(repId).padStart(2, "0")}`,
            );
            fs.mkdirSync(repDir, { recursive: true });
            if (options.corruptRep && repId === 0) {
                fs.writeFileSync(path.join(repDir, "result.json"), "{not json!!");
                return;
            }
            fs.writeFileSync(
                path.join(repDir, "result.json"),
                JSON.stringify({
                    runId,
                    scenarioId,
                    repId,
                    status: "passed",
                    warmup: false,
                    metrics: [
                        {
                            name: "scenario.wallclock",
                            value,
                            unit: "ms",
                            official: true,
                        },
                    ],
                }),
            );
        });
    }
}

suite("Perf history directory provider (filesystem)", function () {
    // Filesystem + synthetic-scale tests get a wider budget.
    this.timeout(120_000);

    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ph-test-"));
    });

    teardown(() => {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // temp cleanup is best-effort on Windows
        }
    });

    test("indexes runs, aggregates, and tolerates corrupt reps", async () => {
        writeRun(root, "2026-07-01T00-00-00Z_aa", {
            scenarios: { "query-10k-results": [100, 110, 120, 130] },
        });
        writeRun(root, "2026-07-02T00-00-00Z_bb", {
            scenarios: { "query-10k-results": [200, 210, 220, 230] },
            corruptRep: true,
        });
        const provider = new DirectoryHistoryProvider("test", root);
        await provider.rescan();
        expect(provider.runCount()).to.equal(2);
        const runs = provider.queryRuns({ sourceId: "test" });
        expect(runs.rows).to.have.length(2);
        const newest = runs.rows[0];
        expect(newest.runId).to.include("_bb");
        // Corrupt rep dropped, three good reps remain.
        expect(newest.repTotal).to.equal(3);
        const scenarios = provider.queryScenarios({
            sourceId: "test",
            runIds: [newest.runId],
        });
        expect(scenarios).to.have.length(1);
        expect(scenarios[0].p50Ms).to.equal(220);
        // Baseline = previous run (median 110 → delta +100%).
        expect(scenarios[0].baselineP50Ms).to.equal(110);
        expect(scenarios[0].deltaPct).to.equal(100);
        const series = provider.metricSeries("query-10k-results", "scenario.wallclock");
        expect(series).to.have.length(2);
    });

    test("incremental rescan only reindexes changed runs and survives cache reload", async () => {
        writeRun(root, "2026-07-01T00-00-00Z_aa", {
            scenarios: { "selftest-noop": [1, 2, 3] },
        });
        const provider = new DirectoryHistoryProvider("test", root);
        await provider.rescan();
        expect(provider.runCount()).to.equal(1);
        expect(fs.existsSync(path.join(root, ".dc-history-index.json"))).to.equal(true);

        // A fresh provider must serve from the persisted cache without re-reading reps.
        const cached = new DirectoryHistoryProvider("test", root);
        expect(cached.runCount()).to.equal(1);

        // New run appears after rescan.
        writeRun(root, "2026-07-02T00-00-00Z_bb", {
            scenarios: { "selftest-noop": [4, 5, 6] },
        });
        await cached.rescan();
        expect(cached.runCount()).to.equal(2);

        // Deleted run disappears after rescan.
        fs.rmSync(path.join(root, "2026-07-01T00-00-00Z_aa"), { recursive: true, force: true });
        await cached.rescan();
        expect(cached.runCount()).to.equal(1);
    });

    test("deleteRun removes the directory, evicts the index, and rejects path tricks", async () => {
        writeRun(root, "2026-07-01T00-00-00Z_aa", {
            scenarios: { "selftest-noop": [1, 2, 3] },
        });
        writeRun(root, "2026-07-02T00-00-00Z_bb", {
            scenarios: { "selftest-noop": [4, 5, 6] },
        });
        const provider = new DirectoryHistoryProvider("test", root);
        await provider.rescan();
        expect(provider.runCount()).to.equal(2);

        const outcome = provider.deleteRun("2026-07-01T00-00-00Z_aa");
        expect(outcome.ok).to.equal(true);
        expect(fs.existsSync(path.join(root, "2026-07-01T00-00-00Z_aa"))).to.equal(false);
        expect(provider.runCount()).to.equal(1);

        // Survives a cache reload (index was persisted post-delete).
        const reloaded = new DirectoryHistoryProvider("test", root);
        expect(reloaded.runCount()).to.equal(1);

        // Path traversal / absolute paths are refused.
        expect(provider.deleteRun("../outside").ok).to.equal(false);
        expect(provider.deleteRun("a/b").ok).to.equal(false);
        expect(provider.deleteRun(".dc-history-index.json").ok).to.equal(false);
    });

    test("scenario details expose reps, submetrics, and failure reasons lazily", async () => {
        writeRun(root, "2026-07-01T00-00-00Z_aa", {
            scenarios: { "query-10k-results": [100, 110, 120] },
        });
        const provider = new DirectoryHistoryProvider("test", root);
        await provider.rescan();
        const details = provider.scenarioDetails({
            sourceId: "test",
            runId: "2026-07-01T00-00-00Z_aa",
            scenarioId: "query-10k-results",
        });
        expect(details.reps).to.have.length(3);
        expect(details.submetrics.map((s) => s.name)).to.include("scenario.wallclock");
        expect(details.submetrics[0].n).to.equal(3);
    });

    test("large synthetic history (1,000 runs) indexes in bounded time and serves cached queries fast", async () => {
        const RUNS = 1000;
        for (let index = 0; index < RUNS; index++) {
            const day = String((index % 27) + 1).padStart(2, "0");
            const sec = String(index % 60).padStart(2, "0");
            const min = String(Math.floor(index / 60) % 60).padStart(2, "0");
            writeRun(root, `2026-06-${day}T00-${min}-${sec}Z_${index.toString(36)}`, {
                scenarios: { "selftest-noop": [1, 2, 3] },
            });
        }
        const coldStart = Date.now();
        const provider = new DirectoryHistoryProvider("perfscale", root);
        await provider.rescan();
        const coldMs = Date.now() - coldStart;
        expect(provider.runCount()).to.equal(RUNS);

        // Warm path: a new provider instance must load the persisted index
        // without touching any rep files.
        const warmStart = Date.now();
        const warm = new DirectoryHistoryProvider("perfscale", root);
        const paged = warm.queryRuns({ sourceId: "perfscale", limit: 100 });
        const warmMs = Date.now() - warmStart;
        expect(paged.rows).to.have.length(100);
        expect(paged.totalInSource).to.equal(RUNS);

        // Practical bounds (generous for CI variance); actuals logged for the
        // progress notes.
        // eslint-disable-next-line no-console
        console.log(
            `      perf: cold index ${RUNS} runs = ${coldMs}ms · warm cached query = ${warmMs}ms`,
        );
        expect(coldMs, "cold index time").to.be.lessThan(60_000);
        expect(warmMs, "warm cached query time").to.be.lessThan(2_000);
    });
});
