#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corpusRoot = join(packageRoot, "test", "corpus", "tsql-conformance");
const manifest = JSON.parse(await readFile(join(corpusRoot, "manifest.json"), "utf8"));
const service = new LezerSyntaxService();
const results = [];

for (const file of manifest.files) {
    const bytes = await readFile(join(corpusRoot, file.path));
    const text = decode(bytes, file.encoding);
    const started = performance.now();
    const snapshot = service.parse(new ImmutableTextSnapshot(`corpus:/${file.path}`, 1, text));
    const elapsedMs = performance.now() - started;
    results.push({
        path: file.path,
        expectation: file.expectation,
        flavorHint: file.flavorHint,
        versionHint: file.versionHint,
        bytes: file.bytes,
        elapsedMs,
        diagnostics: snapshot.diagnostics.length,
        rawErrors: snapshot.statistics.rawErrorNodeCount,
    });
}

const parseable = results.filter((result) => result.expectation === "parseable");
const recovery = results.filter((result) => result.expectation === "recovery");

// Fixture classes are reported separately so an expected error in an intentionally malformed
// fixture is never averaged into the valid-SQL total. Only the valid classes are required to
// reach zero raw recovery; profile-gated syntax must parse structurally even when a feature gate
// rejects it, so it is held to the same zero-recovery bar and tracked apart for review.
const fixtureClassOf = (result) =>
    result.expectation === "recovery"
        ? "intentionallyMalformed"
        : result.flavorHint && result.flavorHint !== "sql-server-or-common"
          ? "validProfileGated"
          : result.versionHint
            ? "validProfileGated"
            : "validSupported";
const byFixtureClass = Object.fromEntries(
    ["validSupported", "validProfileGated", "intentionallyMalformed"].map((name) => [
        name,
        summarize(results.filter((result) => fixtureClassOf(result) === name)),
    ]),
);

const report = {
    source: manifest.source,
    inventory: manifest.inventory,
    parseable: summarize(parseable),
    recovery: summarize(recovery),
    byFixtureClass,
    byFlavor: Object.fromEntries(
        [...new Set(parseable.map((result) => result.flavorHint))]
            .sort()
            .map((flavor) => [
                flavor,
                summarize(parseable.filter((result) => result.flavorHint === flavor)),
            ]),
    ),
    byVersionHint: Object.fromEntries(
        [...new Set(parseable.map((result) => result.versionHint ?? "unversioned"))]
            .sort(compareVersionHints)
            .map((version) => [
                String(version),
                summarize(
                    parseable.filter((result) => (result.versionHint ?? "unversioned") === version),
                ),
            ]),
    ),
    failures: parseable
        .filter((result) => result.rawErrors > 0)
        .sort(
            (left, right) =>
                right.rawErrors - left.rawErrors || left.path.localeCompare(right.path),
        ),
};

if (process.argv.includes("--write-baseline")) {
    const baseline = {
        schemaVersion: 1,
        sourceCommit: manifest.source.commit,
        parseableFiles: parseable.length,
        rawErrors: report.parseable.rawErrors,
        files: Object.fromEntries(parseable.map((result) => [result.path, result.rawErrors])),
    };
    await writeFile(
        join(corpusRoot, "baseline.json"),
        `${JSON.stringify(baseline, null, 2)}\n`,
        "utf8",
    );
}

if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    printSummary(report);
}

function summarize(items) {
    const clean = items.filter((item) => item.rawErrors === 0).length;
    const elapsedMs = items.reduce((total, item) => total + item.elapsedMs, 0);
    return {
        files: items.length,
        bytes: items.reduce((total, item) => total + item.bytes, 0),
        clean,
        failing: items.length - clean,
        cleanPercent: items.length === 0 ? 100 : (clean / items.length) * 100,
        diagnostics: items.reduce((total, item) => total + item.diagnostics, 0),
        rawErrors: items.reduce((total, item) => total + item.rawErrors, 0),
        elapsedMs,
        throughputMiBPerSecond:
            elapsedMs === 0
                ? 0
                : items.reduce((total, item) => total + item.bytes, 0) /
                  (1024 * 1024) /
                  (elapsedMs / 1000),
    };
}

function printSummary(value) {
    console.log("T-SQL corpus conformance (package-local fixtures)");
    console.log(
        `Parseable: ${value.parseable.clean}/${value.parseable.files} clean ` +
            `(${value.parseable.cleanPercent.toFixed(1)}%), ${value.parseable.rawErrors} raw errors, ` +
            `${value.parseable.elapsedMs.toFixed(1)} ms`,
    );
    console.log(
        `Recovery: ${value.recovery.files} fixtures, ${value.recovery.rawErrors} raw errors, ` +
            `${value.recovery.elapsedMs.toFixed(1)} ms`,
    );
    console.log("By fixture class (valid classes must reach zero raw recovery):");
    for (const [name, summary] of Object.entries(value.byFixtureClass)) {
        console.log(
            `  ${name}: ${summary.clean}/${summary.files} clean ` +
                `(${summary.cleanPercent.toFixed(1)}%), ${summary.rawErrors} raw errors`,
        );
    }
    for (const [flavor, summary] of Object.entries(value.byFlavor)) {
        console.log(
            `${flavor}: ${summary.clean}/${summary.files} clean ` +
                `(${summary.cleanPercent.toFixed(1)}%), ${summary.rawErrors} raw errors`,
        );
    }
    console.log("Highest-error parseable fixtures:");
    for (const failure of value.failures.slice(0, 20)) {
        console.log(`  ${failure.rawErrors.toString().padStart(4)}  ${failure.path}`);
    }
}

function decode(bytes, encoding) {
    if (encoding === "utf16le") return bytes.subarray(2).toString("utf16le");
    if (encoding === "utf16be") {
        const body = Buffer.from(bytes.subarray(2));
        for (let index = 0; index + 1 < body.length; index += 2) {
            [body[index], body[index + 1]] = [body[index + 1], body[index]];
        }
        return body.toString("utf16le");
    }
    if (encoding === "utf8-bom") return bytes.subarray(3).toString("utf8");
    return bytes.toString("utf8");
}

function compareVersionHints(left, right) {
    if (left === "unversioned") return -1;
    if (right === "unversioned") return 1;
    return left - right;
}
