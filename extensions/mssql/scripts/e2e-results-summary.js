/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turns the Playwright JSON report of a quarantine run into a Markdown table of per-test
 * results, so it is easy to see which quarantined tests are ready to promote.
 *
 * Usage: node scripts/e2e-quarantine-summary.js <report.json> [<output.md>]
 * Without an output path, the Markdown is appended to $GITHUB_STEP_SUMMARY or printed.
 */

const fs = require("fs");
const path = require("path");

const STATUS_LABELS = {
    expected: "✅ Passed",
    unexpected: "❌ Failed",
    flaky: "⚠️ Flaky",
    skipped: "⏭️ Skipped",
};

/** Collects every test in the report along with its describe titles and spec file. */
function collectTests(suite, titlePath, output) {
    const nextPath =
        suite.title && !suite.title.endsWith(".ts") ? [...titlePath, suite.title] : titlePath;
    for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
            output.push({ file: spec.file, titlePath: [...nextPath, spec.title], test });
        }
    }
    for (const child of suite.suites ?? []) {
        collectTests(child, nextPath, output);
    }
    return output;
}

function escapeCell(value) {
    return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function firstErrorLine(test) {
    const failedResult = [...(test.results ?? [])].reverse().find((result) => result.error);
    const message = failedResult?.error?.message ?? "";
    // Strip ANSI color codes that Playwright embeds in assertion messages.
    const firstLine = message.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)[0] ?? "";
    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function buildSummary(report) {
    const rows = collectTests({ suites: report.suites ?? [] }, [], []);
    const counts = {};
    for (const { test } of rows) {
        counts[test.status] = (counts[test.status] ?? 0) + 1;
    }

    const order = { unexpected: 0, flaky: 1, skipped: 2, expected: 3 };
    rows.sort(
        (a, b) =>
            (order[a.test.status] ?? 9) - (order[b.test.status] ?? 9) ||
            a.file.localeCompare(b.file) ||
            a.titlePath.join(" › ").localeCompare(b.titlePath.join(" › ")),
    );

    const lines = [
        "## E2E quarantine results",
        "",
        "Tests that pass here consistently across runs are ready to promote: delete their `@quarantine` tag.",
        "",
        Object.entries(STATUS_LABELS)
            .filter(([status]) => counts[status])
            .map(([status, label]) => `${label}: ${counts[status]}`)
            .join(" · ") || "No quarantined tests ran.",
        "",
    ];

    if (rows.length > 0) {
        lines.push(
            "| Result | Test | File | Test cases | First error |",
            "| --- | --- | --- | --- | --- |",
        );
        for (const { file, titlePath, test } of rows) {
            const testCases = (test.annotations ?? [])
                .filter((annotation) => annotation.type === "testCase")
                .map((annotation) => annotation.description)
                .join(", ");
            lines.push(
                `| ${STATUS_LABELS[test.status] ?? test.status} | ${escapeCell(titlePath.join(" › "))} | ${escapeCell(path.basename(file))} | ${escapeCell(testCases)} | ${escapeCell(firstErrorLine(test))} |`,
            );
        }
    }
    return `${lines.join("\n")}\n`;
}

function main() {
    const [reportPath, outputPath] = process.argv.slice(2);
    if (!reportPath) {
        console.error("Usage: node scripts/e2e-quarantine-summary.js <report.json> [<output.md>]");
        process.exit(2);
    }
    const summary = fs.existsSync(reportPath)
        ? buildSummary(JSON.parse(fs.readFileSync(reportPath, "utf8")))
        : `## E2E quarantine results\n\nNo report was found at \`${reportPath}\`; the run did not finish.\n`;

    const destination = outputPath ?? process.env.GITHUB_STEP_SUMMARY;
    if (destination) {
        fs.appendFileSync(destination, summary);
    } else {
        process.stdout.write(summary);
    }
}

main();
