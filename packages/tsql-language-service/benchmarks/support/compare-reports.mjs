#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const latencyPolicies = {
    p50Ms: { relative: 1.35, absolute: 5 },
    p95Ms: { relative: 1.5, absolute: 10 },
    heartbeatP95Ms: { relative: 1.5, absolute: 10 },
};
const memoryPolicy = { relative: 1.25, absolute: 10 };

export function compareBenchmarkReports(baselineValue, candidateValue) {
    const baseline = benchmarkReport(baselineValue, "baseline");
    const candidate = benchmarkReport(candidateValue, "candidate");
    assertEquivalentEnvironment(baseline, candidate);

    const comparisons = [
        comparison(
            "catalogBuildMs",
            baseline.catalogBuildMs,
            candidate.catalogBuildMs,
            latencyPolicies.p50Ms,
        ),
    ];
    compareRows(comparisons, "feature", baseline.featureLanes, candidate.featureLanes);
    compareRows(comparisons, "host", baseline.hostHeartbeat.rows, candidate.hostHeartbeat.rows);
    if (baseline.worker || candidate.worker) {
        if (!baseline.worker || !candidate.worker) {
            throw new Error(
                "Baseline and candidate must either both collect worker metrics or skip them.",
            );
        }
        compareRows(comparisons, "worker", baseline.worker.rows, candidate.worker.rows);
    }
    compareMemory(comparisons, baseline.memory, candidate.memory);

    return {
        comparisons,
        regressions: comparisons.filter((comparison) => comparison.regression),
    };
}

export function benchmarkTableRows(baselineValue, candidateValue) {
    if (baselineValue !== undefined) {
        return compareBenchmarkReports(baselineValue, candidateValue).comparisons.map((item) => ({
            metric: item.name,
            baseline: item.baseline,
            candidate: item.candidate,
            delta: item.delta,
            ratio: item.ratio,
            result: item.regression ? "REGRESSION" : "pass",
        }));
    }

    const candidate = benchmarkReport(candidateValue, "candidate");
    return measurements(candidate).map(({ name, value }) => ({
        metric: name,
        baseline: undefined,
        candidate: value,
        delta: undefined,
        ratio: undefined,
        result: "N/A",
    }));
}

export function formatBenchmarkMarkdown(baselineValue, candidateValue) {
    const rows = benchmarkTableRows(baselineValue, candidateValue);
    return [
        "## T-SQL language service benchmark",
        "",
        "| Metric | Main | Candidate | Delta | Ratio | Result |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
        ...rows.map(
            (row) =>
                `| ${row.metric} | ${formatValue(row.baseline)} | ${formatValue(row.candidate)} | ${formatDelta(row.delta)} | ${formatRatio(row.ratio)} | ${row.result} |`,
        ),
        "",
    ].join("\n");
}

function measurements(report) {
    const result = [{ name: "catalogBuildMs", value: report.catalogBuildMs }];
    appendRowMeasurements(result, "feature", report.featureLanes);
    appendRowMeasurements(result, "host", report.hostHeartbeat.rows);
    if (report.worker) appendRowMeasurements(result, "worker", report.worker.rows);
    if (report.memory.state === "collected") {
        for (const metric of ["sharedCatalogMiB", "perDocumentCatalogMiB"]) {
            result.push({ name: `memory/${metric}`, value: report.memory[metric] });
        }
    }
    return result;
}

function appendRowMeasurements(result, group, reportRows) {
    for (const row of reportRows) {
        for (const metric of Object.keys(latencyPolicies)) {
            if (row[metric] !== undefined) {
                result.push({ name: `${group}/${row.lane}/${metric}`, value: row[metric] });
            }
        }
    }
}

function formatValue(value) {
    return value === undefined ? "N/A" : String(Math.round(value * 1000) / 1000);
}

function formatDelta(value) {
    if (value === undefined) return "N/A";
    const rounded = Math.round(value * 1000) / 1000;
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatRatio(value) {
    return value === undefined ? "N/A" : `${Math.round(value * 100)}%`;
}

function compareRows(comparisons, group, baselineRows, candidateRows) {
    const baselineByLane = new Map(baselineRows.map((row) => [row.lane, row]));
    const candidateByLane = new Map(candidateRows.map((row) => [row.lane, row]));
    assertSameKeys(`${group} lanes`, baselineByLane, candidateByLane);
    for (const [lane, baseline] of baselineByLane) {
        const candidate = candidateByLane.get(lane);
        for (const [metric, policy] of Object.entries(latencyPolicies)) {
            if (baseline[metric] === undefined && candidate[metric] === undefined) continue;
            if (baseline[metric] === undefined || candidate[metric] === undefined) {
                throw new Error(`${group}/${lane}/${metric} is missing from one report.`);
            }
            comparisons.push(
                comparison(
                    `${group}/${lane}/${metric}`,
                    baseline[metric],
                    candidate[metric],
                    policy,
                ),
            );
        }
    }
}

function compareMemory(comparisons, baseline, candidate) {
    if (baseline.state !== candidate.state) {
        throw new Error(
            `Memory collection state differs: ${baseline.state} versus ${candidate.state}.`,
        );
    }
    if (baseline.state !== "collected") return;
    for (const metric of ["sharedCatalogMiB", "perDocumentCatalogMiB"]) {
        comparisons.push(
            comparison(`memory/${metric}`, baseline[metric], candidate[metric], memoryPolicy),
        );
    }
}

function comparison(name, baseline, candidate, policy) {
    const delta = candidate - baseline;
    const ratio =
        baseline === 0 ? (candidate === 0 ? 1 : Number.POSITIVE_INFINITY) : candidate / baseline;
    return {
        name,
        baseline,
        candidate,
        delta,
        ratio,
        regression: delta >= policy.absolute && ratio >= policy.relative,
    };
}

function assertEquivalentEnvironment(baseline, candidate) {
    for (const key of ["node", "platform", "arch", "cpu", "logicalCpus"]) {
        if (baseline.runtime[key] !== candidate.runtime[key]) {
            throw new Error(
                `Runtime ${key} differs: ${baseline.runtime[key]} versus ${candidate.runtime[key]}.`,
            );
        }
    }
    const baselineConfiguration = JSON.stringify(baseline.configuration);
    const candidateConfiguration = JSON.stringify(candidate.configuration);
    if (baselineConfiguration !== candidateConfiguration) {
        throw new Error(
            `Benchmark configuration differs.\nBaseline: ${baselineConfiguration}\nCandidate: ${candidateConfiguration}`,
        );
    }
}

function assertSameKeys(name, baseline, candidate) {
    const baselineKeys = [...baseline.keys()].sort();
    const candidateKeys = [...candidate.keys()].sort();
    if (JSON.stringify(baselineKeys) !== JSON.stringify(candidateKeys)) {
        throw new Error(
            `${name} differ.\nBaseline: ${baselineKeys.join(", ")}\nCandidate: ${candidateKeys.join(", ")}`,
        );
    }
}

function benchmarkReport(value, name) {
    const report = record(value, `${name} report`);
    if (report.schemaVersion !== 2)
        throw new Error(`${name} report has unsupported schemaVersion.`);
    return {
        catalogBuildMs: finiteNumber(report.catalogBuildMs, `${name}.catalogBuildMs`),
        runtime: record(report.runtime, `${name}.runtime`),
        configuration: record(report.configuration, `${name}.configuration`),
        featureLanes: rows(report.featureLanes, `${name}.featureLanes`),
        hostHeartbeat: rowGroup(report.hostHeartbeat, `${name}.hostHeartbeat`),
        worker: report.worker === undefined ? undefined : rowGroup(report.worker, `${name}.worker`),
        memory: memory(report.memory, `${name}.memory`),
    };
}

function rowGroup(value, name) {
    const group = record(value, name);
    return { rows: rows(group.rows, `${name}.rows`) };
}

function rows(value, name) {
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
    return value.map((value, index) => {
        const row = record(value, `${name}[${index}]`);
        if (typeof row.lane !== "string")
            throw new TypeError(`${name}[${index}].lane must be a string.`);
        const result = { lane: row.lane };
        for (const metric of Object.keys(latencyPolicies)) {
            if (row[metric] !== undefined)
                result[metric] = finiteNumber(row[metric], `${name}[${index}].${metric}`);
        }
        return result;
    });
}

function memory(value, name) {
    const result = record(value, name);
    if (result.state === "skipped" || result.state === "notCollected")
        return { state: result.state };
    if (result.state !== "collected") throw new TypeError(`${name}.state is invalid.`);
    return {
        state: "collected",
        sharedCatalogMiB: finiteNumber(result.sharedCatalogMiB, `${name}.sharedCatalogMiB`),
        perDocumentCatalogMiB: finiteNumber(
            result.perDocumentCatalogMiB,
            `${name}.perDocumentCatalogMiB`,
        ),
    };
}

function record(value, name) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object.`);
    }
    return value;
}

function finiteNumber(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError(`${name} must be finite.`);
    return value;
}

async function main(args) {
    const markdownIndex = args.indexOf("--markdown");
    const markdownPath = markdownIndex < 0 ? undefined : args.splice(markdownIndex, 2)[1];
    if ((markdownIndex >= 0 && !markdownPath) || (args.length !== 1 && args.length !== 2)) {
        throw new Error(
            "Usage: compare-reports.mjs [<baseline.json>] <candidate.json> [--markdown <output.md>]",
        );
    }
    const [baselinePath, candidatePath] = args.length === 2 ? args : [undefined, args[0]];
    const [baseline, candidate] = await Promise.all([
        baselinePath ? readFile(baselinePath, "utf8").then(JSON.parse) : undefined,
        readFile(candidatePath, "utf8").then(JSON.parse),
    ]);
    const rows = benchmarkTableRows(baseline, candidate);
    console.table(rows);
    if (markdownPath) {
        await writeFile(markdownPath, formatBenchmarkMarkdown(baseline, candidate), "utf8");
    }
    const regressions = rows.filter((row) => row.result === "REGRESSION");
    if (regressions.length > 0) {
        throw new Error(
            `Major benchmark regressions:\n${regressions.map((item) => `- ${item.metric}`).join("\n")}`,
        );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main(process.argv.slice(2));
}
