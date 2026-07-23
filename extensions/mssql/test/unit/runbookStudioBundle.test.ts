/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

interface MetafileOutput {
    bytes: number;
    entryPoint?: string;
    inputs: Record<string, { bytesInOutput: number }>;
    imports?: { path: string; kind: string }[];
}

const ENTRY = "dist/views/runbookStudio.js";
const MONACO_SETUP_ENTRY = "src/webviews/common/monacoSetup.ts";

function loadMetafile(): { outputs: Record<string, MetafileOutput> } {
    const metafilePath = path.join(__dirname, "..", "..", "..", "webviews-metafile.json");
    expect(
        fs.existsSync(metafilePath),
        "webviews-metafile.json missing — run `npm run build:webviews-bundle` before the suite",
    ).to.equal(true);
    return JSON.parse(fs.readFileSync(metafilePath, "utf8"));
}

function staticClosure(outputs: Record<string, MetafileOutput>, entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (output: string) => {
        if (seen.has(output) || !outputs[output]) {
            return;
        }
        seen.add(output);
        for (const dependency of outputs[output].imports ?? []) {
            if (dependency.kind === "import-statement") {
                visit(dependency.path);
            }
        }
    };
    visit(entry);
    return seen;
}

suite("Runbook Studio webview bundle", () => {
    test("loads the local Monaco editor only when a hosted result requests it", () => {
        const { outputs } = loadMetafile();
        expect(outputs[ENTRY], `${ENTRY} missing from metafile`).to.not.equal(undefined);

        const setupOutput = Object.entries(outputs).find(
            ([, output]) => output.entryPoint === MONACO_SETUP_ENTRY,
        )?.[0];
        expect(setupOutput, "bundled Monaco setup entry missing").to.not.equal(undefined);

        const runbookStaticClosure = staticClosure(outputs, ENTRY);
        expect(
            runbookStaticClosure.has(setupOutput!),
            "Monaco must not increase normal Runbook Studio startup cost",
        ).to.equal(false);
        expect(
            outputs[ENTRY].imports?.some(
                (dependency) =>
                    dependency.kind === "dynamic-import" && dependency.path === setupOutput,
            ),
            "Runbook Studio must dynamically load the local Monaco setup before mounting the diff editor",
        ).to.equal(true);

        const monacoClosure = staticClosure(outputs, setupOutput!);
        const monacoInputs = [...monacoClosure].flatMap((output) =>
            Object.keys(outputs[output].inputs),
        );
        expect(monacoInputs).to.include(MONACO_SETUP_ENTRY);
        expect(
            monacoInputs.some((input) =>
                input.replaceAll("\\", "/").startsWith("node_modules/monaco-editor/"),
            ),
            "the lazy editor closure must contain the bundled Monaco implementation",
        ).to.equal(true);

        const manifestPath = path.join(
            __dirname,
            "..",
            "..",
            "..",
            "dist",
            "views",
            "preload-manifest.json",
        );
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
            string,
            string[]
        >;
        expect(manifest.runbookStudio).not.to.include(path.basename(setupOutput!));
    });
});
