/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensions = [
    { key: "mssql", prefix: "mssql", directory: "mssql", label: "vscode-mssql VSIX" },
    {
        key: "sql_database_projects",
        prefix: "sqlproj",
        directory: "sql-database-projects",
        label: "sql-database-projects VSIX",
    },
    {
        key: "data_workspace",
        prefix: "dataworkspace",
        directory: "data-workspace",
        label: "data-workspace VSIX",
    },
    {
        key: "keymap",
        prefix: "keymap",
        directory: "database-management-keymap",
        label: "keymap VSIX",
    },
];

// Query by commit with explicit pagination, then validate and sort locally rather than relying
// on the branch-only API query's ordering. Check artifacts before choosing a run.
export async function findBaselineRun(api, repository, baseSha, baseBranch) {
    const pages = await api(`repos/${repository}/actions/workflows/publish-baseline.yml/runs`, {
        head_sha: baseSha,
        status: "success",
        per_page: "100",
    });
    const runs = pages
        .flatMap((page) => page.workflow_runs)
        .filter(
            (run) =>
                run.head_sha === baseSha &&
                run.head_branch === baseBranch &&
                run.conclusion === "success" &&
                run.head_repository?.full_name === repository,
        )
        .sort((a, b) => b.id - a.id);

    for (const run of runs) {
        const artifactPages = await api(`repos/${repository}/actions/runs/${run.id}/artifacts`, {
            per_page: "100",
        });
        if (
            artifactPages.some((page) =>
                page.artifacts.some(
                    (artifact) => artifact.name === "baseline-sizes" && !artifact.expired,
                ),
            )
        ) {
            return run.id;
        }
    }
    return undefined;
}

export function isValidBaseline(baseline, baseSha) {
    return (
        baseline?.commit === baseSha &&
        extensions.every(
            ({ key }) => Number.isSafeInteger(baseline[key]?.vsix_kb) && baseline[key].vsix_kb > 0,
        )
    );
}

export function createSizeReport(prSizes, baseline, baseSha) {
    const available = isValidBaseline(baseline, baseSha);
    const rows = [
        "### PR Changes",
        "",
        `Base commit: \`${baseSha}\`.`,
        ...(available
            ? []
            : ["Baseline unavailable for this commit; size comparisons were skipped."]),
        "",
        "| Category | Target Branch | PR Branch | Difference |",
        "|----------|---------------|-----------|------------|",
    ];
    const environment = [];
    for (const { key, prefix, label } of extensions) {
        const prSize = prSizes[key];
        if (!Number.isSafeInteger(prSize) || prSize < 0) {
            throw new Error(`Invalid PR package size for ${key}`);
        }
        let percentage = "";
        if (available) {
            const target = baseline[key].vsix_kb;
            const difference = prSize - target;
            percentage = Math.trunc((100 * difference) / target);
            const icon = percentage > 0 ? "🔴" : percentage < 0 ? "🟢" : "⚪";
            rows.push(
                `| ${label} | ${target} KB | ${prSize} KB | ${icon} ${difference} KB ( ${percentage}% ) |`,
            );
        } else {
            rows.push(`| ${label} | Unavailable | ${prSize} KB | N/A |`);
        }
        // Leave the existing size gate unset when no trustworthy comparison can be made.
        environment.push(`${prefix}_vsix_percentage_change=${percentage}`);
    }
    return {
        markdown: `${rows.join("\n")}\n`,
        environment: `${environment.join("\n")}\n`,
        available,
    };
}

function githubApi(endpoint, parameters) {
    const args = ["api", endpoint, "--method", "GET", "--paginate", "--slurp"];
    for (const [key, value] of Object.entries(parameters)) {
        args.push("-f", `${key}=${value}`);
    }
    return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

async function main() {
    const baseSha = process.env.BASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(baseSha ?? "")) {
        throw new Error("BASE_SHA must be the PR's base commit SHA");
    }
    if (process.argv[2] === "select") {
        const repository = process.env.GITHUB_REPOSITORY;
        if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) {
            throw new Error("GITHUB_REPOSITORY must identify the current repository");
        }
        let runId;
        try {
            runId = await findBaselineRun(githubApi, repository, baseSha, process.env.BASE_BRANCH);
        } catch (error) {
            console.warn(`::warning::Baseline lookup failed: ${error.message}`);
        }
        if (!runId) {
            console.warn(`::warning::No downloadable baseline for base commit ${baseSha}`);
        } else {
            console.log(`Using baseline run ${runId} for base commit ${baseSha}`);
        }
        appendFileSync(process.env.GITHUB_OUTPUT, `run-id=${runId ?? ""}\n`);
    } else if (process.argv[2] === "compare") {
        let baseline;
        try {
            baseline = JSON.parse(readFileSync("baseline/baseline-sizes.json", "utf8"));
        } catch {
            // Missing or malformed metadata makes the comparison unavailable.
        }
        const prSizes = Object.fromEntries(
            extensions.map(({ key, directory }) => {
                const folder = path.join("extensions", directory);
                const files = readdirSync(folder).filter((file) => file.endsWith(".vsix"));
                if (files.length !== 1) {
                    throw new Error(
                        `Expected exactly one VSIX in ${folder}, found ${files.length}`,
                    );
                }
                return [key, Math.floor(statSync(path.join(folder, files[0])).size / 1024)];
            }),
        );
        const report = createSizeReport(prSizes, baseline, baseSha);
        if (!report.available) {
            console.warn(
                `::warning::Baseline missing or invalid for base commit ${baseSha}; skipping size comparisons`,
            );
        }
        writeFileSync("results.md", report.markdown);
        appendFileSync(process.env.GITHUB_ENV, report.environment);
        console.log(report.markdown);
    } else {
        throw new Error("Usage: node scripts/vsix-size-comparison.mjs <select|compare>");
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
