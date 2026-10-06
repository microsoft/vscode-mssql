/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createSizeReport, findBaselineRun, isValidBaseline } from "./vsix-size-comparison.mjs";

const repository = "microsoft/vscode-mssql";
const baseSha = "a".repeat(40);
const sizes = { mssql: 1000, sql_database_projects: 100, data_workspace: 10, keymap: 7 };
const baseline = {
    commit: baseSha,
    ...Object.fromEntries(Object.entries(sizes).map(([key, size]) => [key, { vsix_kb: size }])),
};
const run = (id, overrides = {}) => ({
    id,
    head_sha: baseSha,
    head_branch: "main",
    conclusion: "success",
    head_repository: { full_name: repository },
    ...overrides,
});

test("selects the newest matching run even when API pages are out of order", async () => {
    const selected = await findBaselineRun(
        async (endpoint, parameters) => {
            if (endpoint.endsWith("/runs")) {
                assert.deepEqual(parameters, {
                    head_sha: baseSha,
                    status: "success",
                    per_page: "100",
                });
                return [
                    {
                        workflow_runs: [
                            run(1),
                            run(9, { head_sha: "old" }),
                            run(10, { head_branch: "release/1" }),
                        ],
                    },
                    {
                        workflow_runs: [
                            run(3),
                            run(11, { conclusion: "failure" }),
                            run(12, { head_repository: { full_name: "fork/repo" } }),
                        ],
                    },
                ];
            }
            assert.equal(endpoint, `repos/${repository}/actions/runs/3/artifacts`);
            return [{ artifacts: [{ name: "baseline-sizes", expired: false }] }];
        },
        repository,
        baseSha,
        "main",
    );
    assert.equal(selected, 3);
});

test("skips expired and missing artifacts while staying on the same base commit", async () => {
    const selected = await findBaselineRun(
        async (endpoint) => {
            if (endpoint.endsWith("/runs")) {
                return [{ workflow_runs: [run(3), run(2), run(1)] }];
            }
            if (endpoint.includes("/3/")) {
                return [{ artifacts: [{ name: "baseline-sizes", expired: true }] }];
            }
            if (endpoint.includes("/2/")) {
                return [{ artifacts: [{ name: "different-artifact", expired: false }] }];
            }
            return [{ artifacts: [] }, { artifacts: [{ name: "baseline-sizes", expired: false }] }];
        },
        repository,
        baseSha,
        "main",
    );
    assert.equal(selected, 1);
});

test("does not fall back to a successful run from an older commit", async () => {
    const selected = await findBaselineRun(
        async () => [{ workflow_runs: [run(1, { head_sha: "old" })] }],
        repository,
        baseSha,
        "main",
    );
    assert.equal(selected, undefined);
});

test("returns no baseline when all matching runs have unavailable artifacts", async () => {
    const selected = await findBaselineRun(
        async (endpoint) =>
            endpoint.endsWith("/runs")
                ? [{ workflow_runs: [run(1)] }]
                : [{ artifacts: [{ name: "baseline-sizes", expired: true }] }],
        repository,
        baseSha,
        "main",
    );
    assert.equal(selected, undefined);
});

test("selects a matching release-branch baseline", async () => {
    const selected = await findBaselineRun(
        async (endpoint) =>
            endpoint.endsWith("/runs")
                ? [{ workflow_runs: [run(1, { head_branch: "release/1.47" })] }]
                : [{ artifacts: [{ name: "baseline-sizes", expired: false }] }],
        repository,
        baseSha,
        "release/1.47",
    );
    assert.equal(selected, 1);
});

test("rejects mismatched commits and invalid package sizes", () => {
    assert.equal(isValidBaseline(baseline, baseSha), true);
    for (const invalid of [undefined, null, {}, { ...baseline, commit: "old" }]) {
        assert.equal(isValidBaseline(invalid, baseSha), false);
    }
    for (const size of [undefined, 0, -1, 0.5, "1000", Infinity, NaN]) {
        assert.equal(isValidBaseline({ ...baseline, mssql: { vsix_kb: size } }, baseSha), false);
    }
});

test("reports growth, reduction, and unchanged sizes using the existing integer percentages", () => {
    const report = createSizeReport(
        { ...sizes, mssql: 1060, sql_database_projects: 90 },
        baseline,
        baseSha,
    );
    assert.equal(report.available, true);
    assert.match(report.markdown, /Base commit: `a{40}`/);
    assert.match(report.markdown, /1000 KB \| 1060 KB \| 🔴 60 KB \( 6% \)/);
    assert.match(report.markdown, /100 KB \| 90 KB \| 🟢 -10 KB \( -10% \)/);
    assert.match(report.markdown, /10 KB \| 10 KB \| ⚪ 0 KB \( 0% \)/);
    assert.match(report.environment, /mssql_vsix_percentage_change=6\n/);
    assert.match(report.environment, /sqlproj_vsix_percentage_change=-10\n/);
});

test("unavailable baselines report PR sizes without a misleading percentage or size gate", () => {
    for (const invalid of [
        undefined,
        { ...baseline, commit: "old" },
        { ...baseline, keymap: { vsix_kb: 0 } },
    ]) {
        const report = createSizeReport(sizes, invalid, baseSha);
        assert.equal(report.available, false);
        assert.match(report.markdown, /Baseline unavailable/);
        assert.match(report.markdown, /Unavailable \| 1000 KB \| N\/A/);
        assert.doesNotMatch(report.markdown, /%/);
        assert.equal(
            report.environment,
            "mssql_vsix_percentage_change=\nsqlproj_vsix_percentage_change=\ndataworkspace_vsix_percentage_change=\nkeymap_vsix_percentage_change=\n",
        );
    }
});

test("comparison CLI handles missing, malformed, and valid metadata", (t) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vsix-comparison-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const folder of [
        "mssql",
        "sql-database-projects",
        "data-workspace",
        "database-management-keymap",
    ]) {
        mkdirSync(path.join(directory, "extensions", folder), { recursive: true });
        writeFileSync(
            path.join(directory, "extensions", folder, "extension.vsix"),
            Buffer.alloc(1024),
        );
    }
    const envFile = path.join(directory, "environment");
    const invoke = () =>
        execFileSync(
            process.execPath,
            [fileURLToPath(new URL("./vsix-size-comparison.mjs", import.meta.url)), "compare"],
            {
                cwd: directory,
                env: { ...process.env, BASE_SHA: baseSha, GITHUB_ENV: envFile },
                stdio: "pipe",
            },
        );
    invoke();
    assert.match(readFileSync(path.join(directory, "results.md"), "utf8"), /Baseline unavailable/);
    mkdirSync(path.join(directory, "baseline"));
    writeFileSync(path.join(directory, "baseline", "baseline-sizes.json"), "not JSON");
    invoke();
    assert.match(readFileSync(path.join(directory, "results.md"), "utf8"), /Baseline unavailable/);
    writeFileSync(
        path.join(directory, "baseline", "baseline-sizes.json"),
        JSON.stringify(baseline),
    );
    invoke();
    assert.doesNotMatch(readFileSync(path.join(directory, "results.md"), "utf8"), /Unavailable/);
    writeFileSync(path.join(directory, "extensions", "mssql", "second.vsix"), "");
    assert.throws(invoke, /Expected exactly one VSIX/);
});
