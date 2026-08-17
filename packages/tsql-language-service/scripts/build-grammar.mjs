#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildParserFile } from "@lezer/generator";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Generating this parser peaks around 5.25 GB, above V8's ~4 GB default old-space. Without the
// larger heap the run dies with "Ineffective mark-compacts near heap limit" and exit 134 after
// about 95 seconds, which looks like a grammar ambiguity but is not one. Re-exec once with the
// flag rather than relying on every caller to set NODE_OPTIONS.
const HEAP_MB = 12288;
const hasHeapFlag = [...process.execArgv, process.env.NODE_OPTIONS ?? ""].some((value) =>
    value.includes("--max-old-space-size"),
);
if (!hasHeapFlag) {
    const { status, error } = spawnSync(
        process.execPath,
        [`--max-old-space-size=${HEAP_MB}`, fileURLToPath(import.meta.url)],
        { stdio: "inherit" },
    );
    if (error) throw error;
    process.exit(status ?? 1);
}

const grammarPath = new URL("../src/syntax/lezer/grammar/tsql.grammar", import.meta.url);
const outputDirectory = new URL("../src/syntax/lezer/generated/", import.meta.url);
const grammar = await readFile(grammarPath, "utf8");
const generated = buildParserFile(grammar, {
    fileName: "tsql.grammar",
    moduleStyle: "cjs",
    includeNames: true,
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(new URL("tsqlParser.js", outputDirectory), generated.parser, "utf8"),
    writeFile(new URL("tsqlParser.terms.js", outputDirectory), generated.terms, "utf8"),
]);
