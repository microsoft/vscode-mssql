/**
 * Generates consumable artifacts from the registry:
 *  - generated/markdown/EVENTS.md          (human docs, replaces hand lists)
 *  - generated/typescript/observabilityContract.generated.ts
 *      A DEPENDENCY-FREE snapshot (registry consts + name matcher +
 *      eligibility function) vendored into vscode-mssql at
 *      src/sharedInterfaces/observabilityContract.generated.ts.
 *      Regenerate + re-vendor whenever the registry changes; the extension's
 *      conformance test fails if emitted names drift from the snapshot.
 */

import * as fs from "fs";
import * as path from "path";
import { loadRegistry } from "./index";

const outRoot = path.join(__dirname, "..", "generated");

function generateMarkdown(): string {
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
    for (const e of reg.events) {
        const attrs =
            Object.entries(e.attrs)
                .map(([k, v]) => `${k}:${v}`)
                .join(", ") + (e.attrsComplete ? "" : " …");
        lines.push(
            `| \`${e.name ?? e.prefix + "*"}\` | ${e.kind} | ${e.phase ?? "—"} | ${e.pairsWith ? `\`${e.pairsWith}\`` : "—"} | ${e.feature} | ${e.processRoles.join(", ")} | ${e.timingClass} | ${e.measurementEligible ? "yes" : "no"} | ${attrs || "—"} |`,
        );
    }
    lines.push("", "## Derived metric names", "");
    lines.push("| Metric | Feature | Derived from |", "|---|---|---|");
    for (const m of reg.metrics) {
        lines.push(
            `| \`${m.name}\` | ${m.feature} | ${m.derivedFrom.map((d) => `\`${d}\``).join(" → ")} |`,
        );
    }
    lines.push("", "## Field classifications", "");
    lines.push("| Classification | Default behavior |", "|---|---|");
    for (const [id, c] of Object.entries(reg.classifications)) {
        lines.push(`| \`${id}\` | ${c.defaultBehavior} |`);
    }
    lines.push("", "## Timing classes", "");
    lines.push("| Class | Meaning | Rendering | Eligibility |", "|---|---|---|---|");
    for (const [id, t] of Object.entries(reg.timingClasses)) {
        lines.push(`| \`${id}\` | ${t.meaning} | ${t.rendering} | ${t.eligibility} |`);
    }
    lines.push("");
    return lines.join("\n");
}

function generateSnapshot(): string {
    const reg = loadRegistry();
    const indexSource = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");
    // Reuse the eligibility + matching implementations verbatim so the vendored
    // copy cannot drift semantically from the package.
    const from = indexSource.indexOf("// Name validation");
    const body = indexSource
        .slice(from)
        .replace(/registry \?\? loadRegistry\(\)/g, "registry ?? OBS_CONTRACT")
        .replace(/^\/\/ -+$/gm, "");
    return [
        "/*---------------------------------------------------------------------------------------------",
        " *  Copyright (c) Microsoft Corporation. All rights reserved.",
        " *  Licensed under the MIT License. See License.txt in the project root for license information.",
        " *--------------------------------------------------------------------------------------------*/",
        "",
        "/**",
        " * GENERATED — do not edit. Source of truth:",
        " * perftest/packages/observability-contracts (npm run generate, then vendor).",
        ` * Registry ${reg.schemaVersion}.`,
        " */",
        "",
        "/* eslint-disable */",
        "",
        'export type TimingClass = "sameProcessMonotonic" | "epochAligned" | "derived";',
        'export type EventKind = "marker" | "webviewMark" | "event" | "metric" | "richMetric" | "spanFamily";',
        'export type MarkerPhase = "begin" | "end" | "instant";',
        "export interface EventTypeEntry { name?: string; prefix?: string; kind: EventKind; phase?: MarkerPhase; pairsWith?: string; feature: string; processRoles: string[]; timingClass: TimingClass; measurementEligible: boolean; attrs: Record<string, string>; attrsComplete: boolean; notes?: string; deprecated?: boolean; }",
        "export interface MetricNameEntry { name: string; feature: string; derivedFrom: string[]; }",
        "export interface Registry { schemaVersion: string; events: EventTypeEntry[]; metrics: MetricNameEntry[]; classifications: Record<string, { examples: string[]; defaultBehavior: string }>; timingClasses: Record<string, { meaning: string; rendering: string; eligibility: string }>; }",
        "",
        `export const OBS_CONTRACT: Registry = ${JSON.stringify(reg, undefined, 4)};`,
        "",
        "export function loadRegistry(): Registry { return OBS_CONTRACT; }",
        "",
        body,
    ].join("\n");
}

fs.mkdirSync(path.join(outRoot, "markdown"), { recursive: true });
fs.mkdirSync(path.join(outRoot, "typescript"), { recursive: true });
fs.writeFileSync(path.join(outRoot, "markdown", "EVENTS.md"), generateMarkdown());
fs.writeFileSync(
    path.join(outRoot, "typescript", "observabilityContract.generated.ts"),
    generateSnapshot(),
);
console.log("generated: markdown/EVENTS.md, typescript/observabilityContract.generated.ts");
