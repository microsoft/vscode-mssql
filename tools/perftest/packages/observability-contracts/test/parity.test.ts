/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scenario parity (Chunk 4): a workflow graduates from in-product self-test
 * to CLI without a semantic rewrite. For metric families both hosts measure,
 * the metric NAME and its begin/end marker pair must be identical — and must
 * agree with the registry's derivedFrom declaration.
 */

import { describe, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadRegistry } from "../src/index";

interface DeclaredMetric {
    name: string;
    beginMarker?: string;
    endMarker?: string;
}

/** Extract metric declarations {name, beginMarker, endMarker} from source text. */
function extractMetrics(source: string): DeclaredMetric[] {
    const out: DeclaredMetric[] = [];
    // Matches object literals containing name + beginMarker + endMarker keys in
    // any order within one braces block (registry + inproc styles both match).
    for (const block of source.matchAll(/\{[^{}]*name:\s*"([^"]+)"[^{}]*\}/g)) {
        const body = block[0];
        const name = block[1];
        const begin = body.match(/beginMarker:\s*"([^"]+)"/)?.[1];
        const end = body.match(/endMarker:\s*"([^"]+)"/)?.[1];
        if (begin && end) {
            out.push({ name, beginMarker: begin, endMarker: end });
        }
    }
    return out;
}

const CLI_REGISTRY = path.join(
    __dirname,
    "..",
    "..",
    "perftest-cli",
    "src",
    "scenarios",
    "registry.ts",
);
const INPROC_CATALOG = path.join(__dirname, "..", "..", "perftest-inproc", "src", "scenarios.ts");

describe("scenario parity across hosts", () => {
    test("shared metric families declare identical marker pairs in both hosts", () => {
        const cli = extractMetrics(fs.readFileSync(CLI_REGISTRY, "utf8"));
        const inproc = extractMetrics(fs.readFileSync(INPROC_CATALOG, "utf8"));
        expect(cli.length, "CLI declares no pair metrics — extractor broke?").toBeGreaterThan(0);
        expect(inproc.length, "inproc declares no pair metrics").toBeGreaterThan(0);
        const cliByName = new Map(cli.map((m) => [m.name, m]));
        const mismatches: string[] = [];
        for (const metric of inproc) {
            const cliMetric = cliByName.get(metric.name);
            if (!cliMetric) {
                continue; // not shared — allowed (hosts may have exclusive scenarios)
            }
            if (
                cliMetric.beginMarker !== metric.beginMarker ||
                cliMetric.endMarker !== metric.endMarker
            ) {
                mismatches.push(
                    `${metric.name}: cli=${cliMetric.beginMarker}→${cliMetric.endMarker} inproc=${metric.beginMarker}→${metric.endMarker}`,
                );
            }
        }
        expect(mismatches, mismatches.join("\n")).toEqual([]);
        // The designer family MUST be shared now (the whole point of the port).
        expect(cliByName.has("mssql.tableDesigner.init"), "CLI missing tableDesigner metric").toBe(
            true,
        );
        const inprocNames = new Set(inproc.map((m) => m.name));
        expect(
            inprocNames.has("mssql.tableDesigner.init"),
            "inproc missing tableDesigner metric",
        ).toBe(true);
    });

    test("shared pair metrics agree with the registry's derivedFrom", () => {
        const reg = loadRegistry();
        const all = [
            ...extractMetrics(fs.readFileSync(CLI_REGISTRY, "utf8")),
            ...extractMetrics(fs.readFileSync(INPROC_CATALOG, "utf8")),
        ];
        const problems: string[] = [];
        for (const metric of all) {
            const entry = reg.metrics.find((m) => m.name === metric.name);
            if (!entry) {
                continue; // registry covers the canonical families; extras allowed
            }
            const [begin, end] = entry.derivedFrom;
            if (metric.beginMarker !== begin || metric.endMarker !== end) {
                problems.push(
                    `${metric.name}: declared ${metric.beginMarker}→${metric.endMarker}, registry ${begin}→${end}`,
                );
            }
        }
        expect(problems, problems.join("\n")).toEqual([]);
    });
});
