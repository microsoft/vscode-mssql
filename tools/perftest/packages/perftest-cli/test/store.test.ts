/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { PerfStore } from "../src/store/sqliteStore";
import { HarnessLogger, MemorySink } from "../src/telemetry/logger";
import { nowUnixNs } from "@mssqlperf/contracts";

function tempStore(): { store: PerfStore; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "perfstore-"));
    const logger = new HarnessLogger("test", new MemorySink());
    const store = PerfStore.open(join(dir, "perf.db"), logger);
    return { store, dir };
}

describe("PerfStore", () => {
    it("initializes all schema tables and the official-samples view", () => {
        const { store, dir } = tempStore();
        try {
            const tables = store.tableNames();
            for (const expected of [
                "runs",
                "run_repositories",
                "environments",
                "scenarios",
                "repetitions",
                "metrics",
                "artifacts",
                "validations",
                "baselines",
                "comparisons",
                "comparison_metrics",
                "official_metric_samples",
            ]) {
                expect(tables).toContain(expected);
            }
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("open is idempotent (re-applies schema without error)", () => {
        const { store, dir } = tempStore();
        const logger = new HarnessLogger("test", new MemorySink());
        try {
            const again = PerfStore.open(store.path, logger);
            expect(again.tableNames()).toContain("runs");
            again.close();
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("refuses a database created by an unsupported schema version", () => {
        const dir = mkdtempSync(join(tmpdir(), "perfstore-stale-"));
        const path = join(dir, "perf.db");
        const db = new Database(path);
        db.pragma("user_version = 999");
        db.close();

        try {
            const logger = new HarnessLogger("test", new MemorySink());
            expect(() => PerfStore.open(path, logger)).toThrow(
                "Unsupported perf-store schema version 999",
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("round-trips a run, rep, and metrics; official view filters correctly", () => {
        const { store, dir } = tempStore();
        try {
            const now = nowUnixNs();
            store.upsertEnvironment({
                environmentHash: "sha256:test",
                capturedAtUnixNs: now,
                configFingerprintJson: "{}",
            });
            store.insertRun({
                runId: "run-1",
                createdAtUnixNs: now,
                passType: "measurement",
                status: "passed",
                configHash: "sha256:cfg",
                outputDir: "perf-runs/run-1",
                environmentHash: "sha256:test",
            });
            store.upsertScenario({ scenarioId: "noop", displayName: "No-op" });
            store.insertRepetition({
                runId: "run-1",
                scenarioId: "noop",
                repId: 0,
                status: "passed",
                warmup: false,
                resultPath: "scenarios/noop/reps/rep-00/result.json",
            });
            store.insertMetrics("run-1", "noop", 0, 0, [
                {
                    name: "scenario.wallclock",
                    value: 123.4,
                    unit: "ms",
                    component: "scenario",
                    processRole: "boundary",
                    source: "marker",
                    official: true,
                    lowerIsBetter: true,
                },
                {
                    name: "harness.controlRoundTrip",
                    value: 1.5,
                    unit: "ms",
                    component: "harness",
                    processRole: "orchestrator",
                    source: "manual",
                    official: false,
                    lowerIsBetter: true,
                },
            ]);

            const official = store.query<{ name: string; value: number }>(
                "SELECT name, value FROM official_metric_samples WHERE run_id = ?",
                ["run-1"],
            );
            expect(official).toHaveLength(1);
            expect(official[0]!.name).toBe("scenario.wallclock");
            expect(official[0]!.value).toBeCloseTo(123.4);
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("rejects invalid enum values via CHECK constraints", () => {
        const { store, dir } = tempStore();
        try {
            expect(() =>
                store.insertRun({
                    runId: "run-x",
                    createdAtUnixNs: nowUnixNs(),
                    // @ts-expect-error deliberately invalid pass type must be rejected by SQL CHECK
                    passType: "vibes",
                    status: "passed",
                    configHash: "h",
                    outputDir: "o",
                    environmentHash: "e",
                }),
            ).toThrow();
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
