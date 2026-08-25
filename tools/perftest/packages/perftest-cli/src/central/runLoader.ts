/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run-directory → PerfRunSource loader for `perftest push` (central design
 * §8.1: read result.json and run artifacts, NOT perf.db, so a fresh clone can
 * backfill history).
 *
 * Parity rule: everything projected must be derivable from the run directory
 * alone, identically by this loader and the product's imported-run loader
 * (T-B5). Consequences, all deliberate:
 *  - scenarios.display_name = scenario_id (summary.json carries no display
 *    names; registry names are a read-side join, not upload content);
 *  - created_at_unix_ns derives from the runId prefix (second precision);
 *  - config_hash is recomputed from run-config.snapshot.jsonc, which the
 *    pipeline writes as the verbatim config text;
 *  - repetition start/end derive from the scenario.wallclock metric's
 *    startUnixNs/endUnixNs when present, else null;
 *  - warmup = repId < config.warmupRepetitions (from the config snapshot).
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type { PerfRunRepSource, PerfRunSource, SourceFileInfo } from "@mssqlperf/contracts";

export class RunLoadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RunLoadError";
    }
}

/** Epoch ns (decimal string) from the runId's ISO-second prefix. */
export function createdAtFromRunId(runId: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z_/.exec(runId);
    if (!match) {
        throw new RunLoadError(`runId '${runId}' has no ISO timestamp prefix`);
    }
    const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) {
        throw new RunLoadError(`runId '${runId}' timestamp does not parse`);
    }
    return (BigInt(ms) * 1_000_000n).toString();
}

function fileInfo(runDir: string, relativePath: string): SourceFileInfo {
    const abs = join(runDir, relativePath);
    const content = readFileSync(abs);
    return {
        relativePath,
        sha256: createHash("sha256").update(content).digest("hex"),
        sizeBytes: statSync(abs).size,
    };
}

export function loadRunDirectory(runDir: string): PerfRunSource {
    const summaryPath = join(runDir, "summary.json");
    if (!existsSync(summaryPath)) {
        throw new RunLoadError(`${runDir} has no summary.json — not a perftest run directory`);
    }
    const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
        runId: string;
        passType: string;
        status: string;
        environmentHash: string;
    };

    const environmentPath = join(runDir, "environment.json");
    if (!existsSync(environmentPath)) {
        throw new RunLoadError(`${runDir} has no environment.json`);
    }
    const environment = JSON.parse(readFileSync(environmentPath, "utf8")) as Record<
        string,
        unknown
    >;

    const snapshotPath = join(runDir, "run-config.snapshot.jsonc");
    if (!existsSync(snapshotPath)) {
        throw new RunLoadError(`${runDir} has no run-config.snapshot.jsonc`);
    }
    const rawConfig = readFileSync(snapshotPath, "utf8");
    const configHash = "sha256:" + createHash("sha256").update(rawConfig, "utf8").digest("hex");
    const config = parseJsonc(rawConfig) as { warmupRepetitions?: number } | undefined;
    const warmupRepetitions = config?.warmupRepetitions ?? 0;

    const files: SourceFileInfo[] = [
        fileInfo(runDir, "summary.json"),
        fileInfo(runDir, "environment.json"),
        fileInfo(runDir, "run-config.snapshot.jsonc"),
    ];

    const reps: PerfRunRepSource[] = [];
    const scenarioIds = new Set<string>();
    const scenariosDir = join(runDir, "scenarios");
    if (existsSync(scenariosDir)) {
        for (const scenarioId of readdirSync(scenariosDir).sort()) {
            const repsDir = join(scenariosDir, scenarioId, "reps");
            if (!existsSync(repsDir)) {
                continue;
            }
            for (const repName of readdirSync(repsDir).sort()) {
                const relResult = `scenarios/${scenarioId}/reps/${repName}/result.json`;
                if (!existsSync(join(runDir, relResult))) {
                    continue;
                }
                files.push(fileInfo(runDir, relResult));
                const result = JSON.parse(
                    readFileSync(join(runDir, relResult), "utf8"),
                ) as PerfRunRepSource["result"];
                scenarioIds.add(scenarioId);
                const wallclock = result.metrics.find(
                    (m) =>
                        m["name"] === "scenario.wallclock" && typeof m["startUnixNs"] === "string",
                );
                reps.push({
                    scenarioId,
                    repId: result.repId,
                    attemptId: result.attemptId ?? 0,
                    repDir: `scenarios/${scenarioId}/reps/${repName}`,
                    startUnixNs: (wallclock?.["startUnixNs"] as string | undefined) ?? null,
                    endUnixNs: (wallclock?.["endUnixNs"] as string | undefined) ?? null,
                    warmup: result.repId < warmupRepetitions,
                    result,
                });
            }
        }
    }
    if (reps.length === 0) {
        throw new RunLoadError(`${runDir} contains no rep result.json files`);
    }

    return {
        runId: summary.runId,
        passType: summary.passType,
        status: summary.status,
        environmentHash: summary.environmentHash,
        createdAtUnixNs: createdAtFromRunId(summary.runId),
        configHash,
        machineId: (environment["machineId"] as string | undefined) ?? null,
        notes: null,
        environment,
        scenarios: [...scenarioIds].sort().map((scenarioId) => ({
            scenarioId,
            displayName: scenarioId,
        })),
        reps,
        files,
    };
}
