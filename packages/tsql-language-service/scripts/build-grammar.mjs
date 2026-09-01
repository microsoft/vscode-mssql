#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildParserFile } from "@lezer/generator";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const grammarPath = new URL("../src/syntax/lezer/grammar/tsql.grammar", import.meta.url);
const outputDirectory = new URL("../src/syntax/lezer/generated/", import.meta.url);
const parserPath = new URL("tsqlParser.js", outputDirectory);
const termsPath = new URL("tsqlParser.terms.js", outputDirectory);
const stampPath = new URL("grammar-build.json", outputDirectory);
const mode = process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--if-stale")
      ? "if-stale"
      : "force";
const grammar = await readFile(grammarPath, "utf8");
const inputHash = await grammarInputHash(grammar);
const freshness = await generatedFreshness(inputHash);

if (mode === "check") {
    if (!freshness.fresh) {
        console.error(`Generated T-SQL parser is stale: ${freshness.reason}.`);
        process.exit(1);
    }
    console.log("Generated T-SQL parser is current.");
    process.exit(0);
}

if (mode === "if-stale" && freshness.fresh) {
    console.log("Generated T-SQL parser is current; generation skipped.");
    process.exit(0);
}

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
        [
            `--max-old-space-size=${HEAP_MB}`,
            fileURLToPath(import.meta.url),
            ...process.argv.slice(2),
        ],
        { stdio: "inherit" },
    );
    if (error) throw error;
    process.exit(status ?? 1);
}

const generated = buildParserFile(grammar, {
    fileName: "tsql.grammar",
    moduleStyle: "cjs",
    includeNames: true,
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(parserPath, generated.parser, "utf8"),
    writeFile(termsPath, generated.terms, "utf8"),
]);
await writeFile(
    stampPath,
    `${JSON.stringify(
        {
            inputHash,
            parserHash: digest(generated.parser),
            termsHash: digest(generated.terms),
        },
        undefined,
        2,
    )}\n`,
    "utf8",
);

async function grammarInputHash(grammarSource) {
    const [script, generatorPackage, generatorEntry] = await Promise.all([
        readFile(new URL(import.meta.url), "utf8"),
        readFile(new URL("../node_modules/@lezer/generator/package.json", import.meta.url), "utf8"),
        readFile(new URL(import.meta.resolve("@lezer/generator")), "utf8"),
    ]);
    const generatorVersion = JSON.parse(generatorPackage).version;
    return digest(
        [
            "tsql-language-service-grammar-v1",
            generatorVersion,
            digest(generatorPackage),
            digest(generatorEntry),
            "moduleStyle=cjs;includeNames=true",
            script,
            grammarSource,
        ].join("\u0000"),
    );
}

async function generatedFreshness(expectedInputHash) {
    try {
        const [stampText, parser, terms] = await Promise.all([
            readFile(stampPath, "utf8"),
            readFile(parserPath, "utf8"),
            readFile(termsPath, "utf8"),
        ]);
        const stamp = JSON.parse(stampText);
        if (stamp.inputHash !== expectedInputHash)
            return { fresh: false, reason: "inputs changed" };
        if (stamp.parserHash !== digest(parser)) {
            return { fresh: false, reason: "parser output changed" };
        }
        if (stamp.termsHash !== digest(terms)) {
            return { fresh: false, reason: "term output changed" };
        }
        return { fresh: true };
    } catch {
        return { fresh: false, reason: "output or build stamp is missing" };
    }
}

function digest(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
