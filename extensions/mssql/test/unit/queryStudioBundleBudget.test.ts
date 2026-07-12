/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * BOOT-3 (QS_BOOTSTRAP_PERF_PLAN): the Query Studio init-load budget. The
 * entry's STATIC import closure is what the webview fetches/parses before
 * the editor can paint — anyone who adds a heavy dependency to that path
 * fails HERE by name, not in a dogfood session three weeks later. Reads
 * webviews-metafile.json (emitted on EVERY bundle) and FAILS if it is
 * missing: run `npm run build:webviews-bundle` first.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

interface MetafileOutput {
    bytes: number;
    entryPoint?: string;
    inputs: Record<string, { bytesInOutput: number }>;
    imports?: { path: string; kind: string }[];
}

const ENTRY = "dist/views/queryStudio.js";
const ENTRY_CSS = "dist/views/queryStudio.css";

/**
 * Heavy packages that must NEVER ride the init render (P1/P2 chunks only).
 * Forward-looking names included so the spatial/vector result tabs
 * (coding-docs/query-result-tabs) are born lazy — 0-cost for the queries
 * that don't use them.
 */
const DENYLIST = [
    "azdataGraph",
    "@slickgrid-universal",
    "slickgrid-react",
    "sortablejs",
    "multiple-select-vanilla",
    "vanilla-calendar-pro",
    // future heavy tab/viz libraries — grow this list, never shrink it
    "maplibre-gl",
    "leaflet",
    "deck.gl",
    "@deck.gl",
    "plotly",
    "chart.js",
    "echarts",
    "three",
    "cesium",
    "@arcgis",
    "d3",
];

/** Init closure code-byte ceiling: 10.4MB measured post-split + headroom. */
const CLOSURE_CODE_BYTES_CEILING = 11.5 * 1024 * 1024;
/** Chunk-count ceiling — silent graph growth shows up here. */
const CLOSURE_CHUNK_CEILING = 20;
/** Entry stylesheet is parsed before first paint; keep feature CSS growth visible. */
const ENTRY_CSS_BYTES_CEILING = 560 * 1024;

function loadMetafile(): { outputs: Record<string, MetafileOutput> } {
    const metafilePath = path.join(__dirname, "..", "..", "..", "webviews-metafile.json");
    expect(
        fs.existsSync(metafilePath),
        "webviews-metafile.json missing — run `npm run build:webviews-bundle` before the suite " +
            "(the bundle-budget guard cannot pass by absence)",
    ).to.equal(true);
    return JSON.parse(fs.readFileSync(metafilePath, "utf8"));
}

function staticClosure(outputs: Record<string, MetafileOutput>): string[] {
    const seen = new Set<string>();
    const walk = (name: string) => {
        if (seen.has(name) || !outputs[name]) {
            return;
        }
        seen.add(name);
        for (const imp of outputs[name].imports ?? []) {
            if (imp.kind === "import-statement") {
                walk(imp.path);
            }
        }
    };
    walk(ENTRY);
    return [...seen];
}

function packageOf(rawInput: string): string {
    const name = rawInput.split("\\").join("/");
    const nm = name.lastIndexOf("node_modules/");
    if (nm < 0) {
        return name;
    }
    const rest = name.slice(nm + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

suite("Query Studio bundle budget (BOOT-3)", () => {
    test("the init-load closure contains NO denylisted heavy package", () => {
        const { outputs } = loadMetafile();
        expect(outputs[ENTRY], `${ENTRY} missing from metafile`).to.not.equal(undefined);
        const closure = staticClosure(outputs);
        const offenders = new Map<string, string>();
        for (const chunk of closure) {
            for (const input of Object.keys(outputs[chunk].inputs)) {
                if (input.endsWith(".css")) {
                    // CSS-only inputs (e.g. the statically-hoisted slickgrid
                    // THEME stylesheet — cascade order demands it precede our
                    // overrides) carry no JS parse/exec weight; the denylist
                    // guards CODE on the init path.
                    continue;
                }
                const pkg = packageOf(input);
                for (const banned of DENYLIST) {
                    if (pkg === banned || pkg.startsWith(`${banned}/`)) {
                        offenders.set(banned, chunk);
                    }
                }
            }
        }
        expect(
            [...offenders.keys()],
            "heavy packages found in the Query Studio INIT path — load them via a dynamic " +
                "import (see lazyResults.tsx / QS_BOOTSTRAP_PERF_PLAN): " +
                JSON.stringify([...offenders.entries()]),
        ).to.deep.equal([]);
    });

    test("the init-load closure stays inside its code-byte and chunk ceilings", () => {
        const { outputs } = loadMetafile();
        const closure = staticClosure(outputs);
        let codeBytes = 0;
        for (const chunk of closure) {
            for (const input of Object.values(outputs[chunk].inputs)) {
                codeBytes += input.bytesInOutput;
            }
        }
        expect(
            codeBytes,
            `init closure grew to ${(codeBytes / 1024 / 1024).toFixed(1)}MB — something new ` +
                "is riding the bootstrap. Move it to a lazy chunk or, if it truly belongs on " +
                "the critical path, raise the ceiling in the SAME review that justifies it.",
        ).to.be.lessThan(CLOSURE_CODE_BYTES_CEILING);
        expect(closure.length, "static chunk count grew").to.be.lessThan(CLOSURE_CHUNK_CEILING);
    });

    test("the entry stylesheet stays inside its byte ceiling", () => {
        const { outputs } = loadMetafile();
        const css = outputs[ENTRY_CSS];
        expect(css, `${ENTRY_CSS} missing from metafile`).to.not.equal(undefined);
        expect(
            css.bytes,
            `entry CSS grew to ${(css.bytes / 1024).toFixed(1)}KiB — move optional pane ` +
                "styles behind a linked lazy stylesheet or justify the ceiling change in review.",
        ).to.be.lessThan(ENTRY_CSS_BYTES_CEILING);
    });

    test("the preload manifest exists and covers the Query Studio entry", () => {
        const manifestPath = path.join(
            __dirname,
            "..",
            "..",
            "..",
            "dist",
            "views",
            "preload-manifest.json",
        );
        expect(fs.existsSync(manifestPath), "preload-manifest.json missing").to.equal(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
            string,
            string[]
        >;
        expect(manifest.queryStudio, "queryStudio preload entry").to.not.equal(undefined);
        expect(manifest.queryStudio.length).to.be.greaterThan(0);
    });
});
