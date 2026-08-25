/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure, importable generators for the tracked observability-contract artifacts. */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadRegistry } from "./index";

export function generateMarkdown(): string {
    const reg = loadRegistry();
    const lines: string[] = [
        "# Observability Contract — Event Vocabulary",
        "",
        `_Generated from registry ${reg.schemaVersion}. Do not edit by hand._`,
        "",
        "## Events and span families",
        "",
        "| Name / prefix | Kind | Phase | Pairs with | Feature | Roles | Timing | Measurable | Attrs (classified) |",
        "|---|---|---|---|---|---|---|---|---|",
    ];
    for (const event of reg.events) {
        const attrs =
            Object.entries(event.attrs)
                .map(([key, value]) => `${key}:${value}`)
                .join(", ") + (event.attrsComplete ? "" : " …");
        lines.push(
            `| \`${event.name ?? event.prefix + "*"}\` | ${event.kind} | ${event.phase ?? "—"} | ${event.pairsWith ? `\`${event.pairsWith}\`` : "—"} | ${event.feature} | ${event.processRoles.join(", ")} | ${event.timingClass} | ${event.measurementEligible ? "yes" : "no"} | ${attrs || "—"} |`,
        );
    }
    lines.push("", "## Derived metric names", "");
    lines.push("| Metric | Feature | Derived from |", "|---|---|---|");
    for (const metric of reg.metrics) {
        lines.push(
            `| \`${metric.name}\` | ${metric.feature} | ${metric.derivedFrom.map((source) => `\`${source}\``).join(" → ")} |`,
        );
    }
    lines.push("", "## Field classifications", "");
    lines.push("| Classification | Default behavior |", "|---|---|");
    for (const [id, classification] of Object.entries(reg.classifications)) {
        lines.push(`| \`${id}\` | ${classification.defaultBehavior} |`);
    }
    lines.push("", "## Timing classes", "");
    lines.push("| Class | Meaning | Rendering | Eligibility |", "|---|---|---|---|");
    for (const [id, timing] of Object.entries(reg.timingClasses)) {
        lines.push(
            `| \`${id}\` | ${timing.meaning} | ${timing.rendering} | ${timing.eligibility} |`,
        );
    }
    lines.push("");
    return lines.join("\n");
}

export function generateSnapshot(): string {
    const reg = loadRegistry();
    const indexSource = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");
    const typesStart = indexSource.indexOf("export type TimingClass");
    const loadRegistryStart = indexSource.indexOf("export function loadRegistry");
    const nameMatchStart = indexSource.indexOf("export interface NameMatch");
    if (typesStart < 0 || loadRegistryStart < 0 || nameMatchStart < 0) {
        throw new Error(
            "Cannot generate snapshot: expected type, loadRegistry, or NameMatch sentinel is missing from src/index.ts",
        );
    }
    const typePreamble = indexSource.slice(typesStart, loadRegistryStart).trim();
    const body = indexSource
        .slice(nameMatchStart)
        .replace(/registry \?\? loadRegistry\(\)/g, "registry ?? OBS_CONTRACT")
        .replace(/^\/\/ -+$/gm, "")
        .trim();
    return [
        "/*---------------------------------------------------------------------------------------------",
        " *  Copyright (c) Microsoft Corporation. All rights reserved.",
        " *  Licensed under the MIT License. See License.txt in the project root for license information.",
        " *--------------------------------------------------------------------------------------------*/",
        "",
        "/**",
        " * GENERATED — do not edit. Source of truth:",
        " * tools/perftest/packages/observability-contracts (npm run generate, then vendor).",
        ` * Registry ${reg.schemaVersion}.`,
        " */",
        "",
        "/* eslint-disable */",
        "",
        typePreamble,
        "",
        `export const OBS_CONTRACT: Registry = ${JSON.stringify(reg, undefined, 4)};`,
        "",
        "export function loadRegistry(): Registry { return OBS_CONTRACT; }",
        "",
        body,
        "",
    ].join("\n");
}
