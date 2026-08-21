/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { test } from "node:test";

interface ReportOptions {
    readonly catalogBuildMs?: number;
    readonly p50Ms?: number;
    readonly p95Ms?: number;
    readonly heartbeatP95Ms?: number;
    readonly sharedCatalogMiB?: number;
    readonly perDocumentCatalogMiB?: number;
    readonly samples?: number;
}

test("benchmark comparison tolerates percentage noise below the absolute latency threshold", async () => {
    const { compareBenchmarkReports } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );
    const result = compareBenchmarkReports(
        report({ p50Ms: 2, p95Ms: 4 }),
        report({ p50Ms: 4, p95Ms: 8 }),
    );

    assert.equal(result.regressions.length, 0);
});

test("benchmark comparison requires both relative and absolute latency regressions", async () => {
    const { compareBenchmarkReports } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );
    const relativeOnly = compareBenchmarkReports(
        report({ p50Ms: 100, p95Ms: 100 }),
        report({ p50Ms: 130, p95Ms: 140 }),
    );
    const absoluteOnly = compareBenchmarkReports(
        report({ p50Ms: 100, p95Ms: 100 }),
        report({ p50Ms: 110, p95Ms: 120 }),
    );
    const major = compareBenchmarkReports(
        report({ p50Ms: 100, p95Ms: 100 }),
        report({ p50Ms: 135, p95Ms: 150 }),
    );

    assert.equal(relativeOnly.regressions.length, 0);
    assert.equal(absoluteOnly.regressions.length, 0);
    assert.deepEqual(
        major.regressions.map((item) => item.name),
        ["feature/corpus/open/p50Ms", "feature/corpus/open/p95Ms"],
    );
});

test("benchmark comparison detects major heartbeat and retained-memory regressions", async () => {
    const { compareBenchmarkReports } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );
    const result = compareBenchmarkReports(
        report({ heartbeatP95Ms: 20, sharedCatalogMiB: 20, perDocumentCatalogMiB: 40 }),
        report({ heartbeatP95Ms: 30, sharedCatalogMiB: 30, perDocumentCatalogMiB: 49 }),
    );

    assert.deepEqual(
        result.regressions.map((item) => item.name),
        ["host/extension-host/open/heartbeatP95Ms", "memory/sharedCatalogMiB"],
    );
});

test("benchmark comparison rejects different configurations", async () => {
    const { compareBenchmarkReports } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );

    assert.throws(
        () => compareBenchmarkReports(report({ samples: 10 }), report({ samples: 11 })),
        /Benchmark configuration differs/u,
    );
});

test("benchmark table uses N/A until a main report exists", async () => {
    const { benchmarkTableRows, formatBenchmarkMarkdown } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );
    const candidate = report({ p50Ms: 12 });
    const rows = benchmarkTableRows(undefined, candidate);

    assert.equal(rows[0]?.baseline, undefined);
    assert.equal(rows[0]?.result, "N/A");
    assert.match(
        formatBenchmarkMarkdown(undefined, candidate),
        /\| catalogBuildMs \| N\/A \| 100 \| N\/A \| N\/A \| N\/A \|/u,
    );
});

test("benchmark table renders the main comparison", async () => {
    const { formatBenchmarkMarkdown } = await import(
        "../../benchmarks/support/compare-reports.mjs"
    );
    const markdown = formatBenchmarkMarkdown(report({ p50Ms: 10 }), report({ p50Ms: 12 }));

    assert.match(
        markdown,
        /\| feature\/corpus\/open\/p50Ms \| 10 \| 12 \| \+2 \| 120% \| pass \|/u,
    );
});

function report(options: ReportOptions): unknown {
    return {
        schemaVersion: 2,
        runtime: {
            node: "v24.0.0",
            platform: "linux",
            arch: "x64",
            cpu: "test cpu",
            logicalCpus: 4,
        },
        configuration: {
            samples: options.samples ?? 10,
            warmups: 3,
            seed: 1,
            documentBytes: 64 * 1024,
            catalogObjectCount: 1_000,
            memoryDocuments: 4,
            corpora: ["realistic"],
        },
        catalogBuildMs: options.catalogBuildMs ?? 100,
        featureLanes: [
            {
                lane: "corpus/open",
                p50Ms: options.p50Ms ?? 10,
                p95Ms: options.p95Ms ?? 20,
            },
        ],
        hostHeartbeat: {
            rows: [
                {
                    lane: "extension-host/open",
                    p50Ms: 10,
                    p95Ms: 20,
                    heartbeatP95Ms: options.heartbeatP95Ms ?? 10,
                },
            ],
        },
        worker: undefined,
        memory: {
            state: "collected",
            sharedCatalogMiB: options.sharedCatalogMiB ?? 20,
            perDocumentCatalogMiB: options.perDocumentCatalogMiB ?? 40,
        },
    };
}
